import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import NodeGraphView from "./NodeGraphView";
import {
  type PathNode,
  type Vec3,
  buildNavPath,
  computeArcLengths,
  samplePath,
  nearestNodeId,
  v3dist,
} from "./pathfinding";

/** Shelf is now just a camera pose + panorama data. Routing is handled by path nodes. */
type Shelf = {
  id: string;
  barcode: string;
  cameraPosition: Vec3;
  cameraLookAt: Vec3 | null;
  panoramaUrl: string | null;
  panoramaYaw: number;
  panoramaPitch: number;
  panoramaFov: number;
  markerYaw: number | null;
  markerPitch: number | null;
};

type Transform = {
  position: Vec3;
  rotation: Vec3; // degrees
  scale: Vec3;
};

type SceneObject = {
  id: string;
  name: string;
  url: string;
  transform: Transform;
};

type Config = {
  glbUrl: string | null;
  splatUrl: string | null;          // Gaussian splat scene URL
  glbTransform: Transform;
  objects: SceneObject[];
  homePosition: Vec3;
  homeLookAt: Vec3;
  homeNodeId: string | null;        // path node linked to home position
  pathNodes: Record<string, PathNode>;
  cameraSpeed: number;              // units per second (default 3)
  shelves: Record<string, Shelf>;
};

type AppMode = "admin-free" | "admin-node-edit" | "admin-pano-edit" | "navigating" | "panorama";

type SelectionId = "scene" | string | null;
type TransformTool = "translate" | "rotate" | "scale";
type TransformAxis = "x" | "y" | "z" | null;

const STORAGE_KEY = "warehouse-router-config";

// When running on Pi, the API is served from the same origin.
// In Replit dev, the proxy routes /api to the backend.
const API_BASE = "/api";

async function uploadFile(file: File, type: "glb" | "photo"): Promise<string> {
  const endpoint = `${API_BASE}/upload`;
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(endpoint, { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "Upload failed");
  }
  const data = await res.json();
  return data.url as string;
}

const identityTransform = (): Transform => ({
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
});

const defaultConfig: Config = {
  glbUrl: null,
  splatUrl: null,
  glbTransform: identityTransform(),
  objects: [],
  homePosition: { x: 0, y: 2, z: 5 },
  homeLookAt: { x: 0, y: 1, z: 0 },
  homeNodeId: null,
  pathNodes: {},
  cameraSpeed: 3,
  shelves: {},
};

function loadConfig(): Config {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const merged = { ...defaultConfig, ...parsed };

      // Migrate old shelf format (had waypoints[]) to new cameraPosition/cameraLookAt
      merged.shelves = Object.fromEntries(
        Object.entries(merged.shelves || {}).map(([k, s]) => {
          const old = s as Record<string, unknown>;
          // If it's already new format, keep it
          if (old.cameraPosition) {
            return [k, { panoramaYaw: 0, panoramaPitch: 0, panoramaFov: 75, markerYaw: null, markerPitch: null, cameraLookAt: null, ...old } as Shelf];
          }
          // Migrate from old waypoints-based format
          const wps = (old.waypoints as Vec3[] | undefined) ?? [];
          const lastWp = wps[wps.length - 1] ?? { x: 0, y: 2, z: 0 };
          const migrated: Shelf = {
            id: String(old.id ?? k),
            barcode: String(old.barcode ?? ""),
            cameraPosition: lastWp,
            cameraLookAt: (old.lookAt as Vec3 | null) ?? null,
            panoramaUrl: (old.panoramaUrl as string | null) ?? null,
            panoramaYaw: Number(old.panoramaYaw ?? 0),
            panoramaPitch: Number(old.panoramaPitch ?? 0),
            panoramaFov: Number(old.panoramaFov ?? 75),
            markerYaw: (old.markerYaw as number | null) ?? null,
            markerPitch: (old.markerPitch as number | null) ?? null,
          };
          return [k, migrated];
        }),
      );

      // Backfill new Config fields
      if (!merged.glbTransform) merged.glbTransform = identityTransform();
      if (!Array.isArray(merged.objects)) merged.objects = [];
      if (!merged.pathNodes) merged.pathNodes = {};
      if (!merged.cameraSpeed || merged.cameraSpeed <= 0) merged.cameraSpeed = 3;
      if (!merged.homeNodeId) merged.homeNodeId = null;
      if (!merged.splatUrl) merged.splatUrl = null;

      return merged;
    }
  } catch (e) {
    console.warn("Failed to load config", e);
  }
  return defaultConfig;
}

function saveConfig(cfg: Config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch (e) {
    console.warn("Failed to save config", e);
  }
}

function v3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function toV3(v: THREE.Vector3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

function fromV3(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const panoMountRef = useRef<HTMLDivElement | null>(null);

  const [config, setConfig] = useState<Config>(() => loadConfig());
  const [mode, setMode] = useState<AppMode>("admin-free");
  const [activeShelfId, setActiveShelfId] = useState<string | null>(null);
  const [newShelfId, setNewShelfId] = useState("");
  const [newShelfBarcode, setNewShelfBarcode] = useState("");
  const [runtimeQuery, setRuntimeQuery] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [panel, setPanel] = useState<"admin" | "runtime">("runtime");
  const [fadeAlpha, setFadeAlpha] = useState(0);
  const [selectedObjectId, setSelectedObjectId] = useState<SelectionId>(null);
  const [transformHud, setTransformHud] = useState<string>("");
  const [webglError, setWebglError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [serverConfigs, setServerConfigs] = useState<string[]>([]);
  const [serverConfigName, setServerConfigName] = useState("default");
  const [adminToken, setAdminToken] = useState<string | null>(() => sessionStorage.getItem("admin-token"));
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isRightDragging, setIsRightDragging] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [newPasswordInput, setNewPasswordInput] = useState("");
  const [showNodeGraph, setShowNodeGraph] = useState(false);
  const newNodeIdRef = useRef<string>("n1");

  // Three.js refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const glbRootRef = useRef<THREE.Object3D | null>(null);
  const splineLineRef = useRef<THREE.Line | null>(null);
  const waypointMarkersRef = useRef<THREE.Group | null>(null);
  const lookAtMarkerRef = useRef<THREE.Object3D | null>(null);
  // Selectable scene objects: id -> root Object3D
  const objectsMapRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const selectionBoxRef = useRef<THREE.BoxHelper | null>(null);
  const selectedObjectIdRef = useRef<SelectionId>(null);
  // Active transform gesture (Blender-style G/R/S)
  const transformRef = useRef<{
    active: boolean;
    tool: TransformTool;
    axis: TransformAxis;
    startMouseX: number;
    startMouseY: number;
    targetId: SelectionId;
    original: Transform;
  }>({
    active: false,
    tool: "translate",
    axis: null,
    startMouseX: 0,
    startMouseY: 0,
    targetId: null,
    original: identityTransform(),
  });

  // Free-fly state
  const keysRef = useRef<Record<string, boolean>>({});
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const isPointerLockedRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const virtualMouseRef = useRef({ x: 0, y: 0 });
  const cameraRotateRef = useRef(false);

  // New arc-length navigation ref (replaces playbackRef)
  const navRef = useRef<{
    active: boolean;
    path: Vec3[];               // full world-space path
    arcLengths: number[];       // cumulative arc lengths
    totalLength: number;        // total path length
    traversed: number;          // distance covered so far
    speed: number;              // units / second
    currentQuat: THREE.Quaternion; // smoothed camera orientation
    endLookAt: THREE.Vector3 | null;
    onComplete: (() => void) | null;
    lastTimestamp: number;
    pathLineRef: THREE.Mesh | null; // glow tube (scene object)
  }>({
    active: false,
    path: [],
    arcLengths: [],
    totalLength: 0,
    traversed: 0,
    speed: 3,
    currentQuat: new THREE.Quaternion(),
    endLookAt: null,
    onComplete: null,
    lastTimestamp: 0,
    pathLineRef: null,
  });

  // Panorama state
  const panoSceneRef = useRef<THREE.Scene | null>(null);
  const panoCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const panoRendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const panoYawRef = useRef(0);
  const panoPitchRef = useRef(0);
  const panoFovRef = useRef(75);
  const panoMarkerRef = useRef<THREE.Sprite | null>(null);
  const panoSphereRef = useRef<THREE.Mesh | null>(null);

  const modeRef = useRef<AppMode>(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const activeShelfIdRef = useRef<string | null>(activeShelfId);
  useEffect(() => {
    activeShelfIdRef.current = activeShelfId;
  }, [activeShelfId]);

  useEffect(() => {
    selectedObjectIdRef.current = selectedObjectId;
    updateSelectionBox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedObjectId]);

  // Persist config
  useEffect(() => {
    saveConfig(config);
  }, [config]);

  // ---------- Three.js Setup ----------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Pre-flight WebGL check
    const testCanvas = document.createElement("canvas");
    const gl = testCanvas.getContext("webgl2") || testCanvas.getContext("webgl");
    if (!gl) {
      setWebglError("WebGL is not available in this environment. Please open the app in a full browser tab — click the ↗ button in the preview toolbar above.");
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1d22);
    scene.fog = new THREE.Fog(0x1a1d22, 30, 200);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      60,
      mount.clientWidth / mount.clientHeight,
      0.05,
      1000,
    );
    camera.position.set(
      config.homePosition.x,
      config.homePosition.y,
      config.homePosition.z,
    );
    cameraRef.current = camera;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch (e) {
      setWebglError("WebGL is not available in this environment. Please open the app in a full browser tab (click the external link icon in the preview toolbar).");
      return;
    }
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(10, 20, 10);
    scene.add(dir);

    // Grid
    const grid = new THREE.GridHelper(50, 50, 0x444444, 0x222222);
    scene.add(grid);

    // Path node markers group (only visible in admin modes)
    const nodeGroup = new THREE.Group();
    scene.add(nodeGroup);
    waypointMarkersRef.current = nodeGroup; // reuse ref name for now

    // Initial camera orientation derived from homeLookAt
    {
      const lookDir = new THREE.Vector3()
        .subVectors(fromV3(config.homeLookAt), fromV3(config.homePosition))
        .normalize();
      yawRef.current = Math.atan2(-lookDir.x, -lookDir.z);
      pitchRef.current = Math.asin(lookDir.y);
      applyCameraRotation();
    }

    // Resize
    const onResize = () => {
      if (!mount || !rendererRef.current || !cameraRef.current) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      rendererRef.current.setSize(w, h);
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    // Render loop
    let lastTime = performance.now();
    let raf = 0;
    const render = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      updateCamera(dt);
      updateNavigation(dt);
      if (selectionBoxRef.current) {
        (selectionBoxRef.current as THREE.BoxHelper).update();
      }
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
      raf = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Load GLB scene ----------
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (glbRootRef.current) {
      scene.remove(glbRootRef.current);
      glbRootRef.current = null;
    }
    if (!config.glbUrl) return;
    const loader = new GLTFLoader();
    setStatusMsg("Loading GLB...");
    loader.load(
      config.glbUrl,
      (gltf) => {
        glbRootRef.current = gltf.scene;
        applyTransformToObject(gltf.scene, config.glbTransform);
        scene.add(gltf.scene);
        updateSelectionBox();
        setStatusMsg("GLB loaded.");
      },
      undefined,
      (err) => {
        console.error(err);
        setStatusMsg("Failed to load GLB.");
      },
    );
    // Intentionally only re-run on glbUrl change (transform handled separately)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.glbUrl]);

  // ---------- Gaussian splat loading ----------
  const splatRootRef = useRef<THREE.Object3D | null>(null);
  const splatViewerRef = useRef<{ dispose?: () => void } | null>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!scene || !renderer || !camera) return;

    // Cleanup previous splat
    if (splatRootRef.current) {
      scene.remove(splatRootRef.current);
      splatRootRef.current = null;
    }
    if (splatViewerRef.current?.dispose) {
      splatViewerRef.current.dispose();
      splatViewerRef.current = null;
    }
    if (!config.splatUrl) return;

    // Device capability check: require WebGL2 + reasonable GPU
    const canvas = renderer.domElement;
    const gl = canvas.getContext("webgl2");
    if (!gl) {
      setStatusMsg("Gaussian splats require WebGL2 (not supported on this device).");
      return;
    }

    setStatusMsg("Loading Gaussian splat scene…");

    // Dynamic import to avoid breaking low-end devices at bundle time
    import("@mkkellogg/gaussian-splats-3d").then((GS) => {
      const viewer = new GS.Viewer({
        renderer,
        camera,
        useBuiltInControls: false,
        selfDrivenMode: false,
        threeScene: scene,
      });
      splatViewerRef.current = viewer;
      viewer.addSplatScene(config.splatUrl!, { showLoadingUI: false })
        .then(() => {
          setStatusMsg("Gaussian splat loaded.");
        })
        .catch((err: unknown) => {
          console.error("Splat load error", err);
          setStatusMsg("Failed to load Gaussian splat.");
        });
    }).catch(() => {
      setStatusMsg("Gaussian splat library not available on this device.");
    });

    return () => {
      if (splatViewerRef.current?.dispose) splatViewerRef.current.dispose();
      splatViewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.splatUrl]);

  // Apply scene GLB transform when it changes
  useEffect(() => {
    if (glbRootRef.current) {
      applyTransformToObject(glbRootRef.current, config.glbTransform);
      updateSelectionBox();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.glbTransform]);

  // ---------- Load extra scene objects ----------
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const map = objectsMapRef.current;
    const wantedIds = new Set(config.objects.map((o) => o.id));
    // Remove objects no longer in config
    for (const [id, obj] of map.entries()) {
      if (!wantedIds.has(id)) {
        scene.remove(obj);
        map.delete(id);
      }
    }
    // Load/refresh each object
    config.objects.forEach((spec) => {
      const existing = map.get(spec.id);
      if (existing) {
        // Already loaded — just sync the transform
        applyTransformToObject(existing, spec.transform);
        return;
      }
      const loader = new GLTFLoader();
      loader.load(
        spec.url,
        (gltf) => {
          gltf.scene.userData.objectId = spec.id;
          applyTransformToObject(gltf.scene, spec.transform);
          scene.add(gltf.scene);
          map.set(spec.id, gltf.scene);
          updateSelectionBox();
        },
        undefined,
        (err) => {
          console.error(err);
          setStatusMsg(`Failed to load object "${spec.name}".`);
        },
      );
    });
    updateSelectionBox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.objects]);

  function applyTransformToObject(obj: THREE.Object3D, t: Transform) {
    obj.position.set(t.position.x, t.position.y, t.position.z);
    obj.rotation.set(
      THREE.MathUtils.degToRad(t.rotation.x),
      THREE.MathUtils.degToRad(t.rotation.y),
      THREE.MathUtils.degToRad(t.rotation.z),
    );
    obj.scale.set(t.scale.x, t.scale.y, t.scale.z);
  }

  function getSelectedObject3D(): THREE.Object3D | null {
    const id = selectedObjectIdRef.current;
    if (!id) return null;
    if (id === "scene") return glbRootRef.current;
    return objectsMapRef.current.get(id) ?? null;
  }

  function getSelectedTransformConfig(): Transform | null {
    const id = selectedObjectIdRef.current;
    if (!id) return null;
    if (id === "scene") return config.glbTransform;
    const o = config.objects.find((x) => x.id === id);
    return o ? o.transform : null;
  }

  function updateSelectionBox() {
    const scene = sceneRef.current;
    if (!scene) return;
    if (selectionBoxRef.current) {
      scene.remove(selectionBoxRef.current);
      (selectionBoxRef.current as THREE.BoxHelper).dispose?.();
      selectionBoxRef.current = null;
    }
    const obj = getSelectedObject3D();
    if (!obj) return;
    const helper = new THREE.BoxHelper(obj, 0xffaa00);
    helper.material.depthTest = false;
    helper.renderOrder = 999;
    scene.add(helper);
    selectionBoxRef.current = helper;
  }

  // ---------- Update path node visualization (admin only) ----------
  useEffect(() => {
    renderNodeVisualization();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.pathNodes, config.homeNodeId, mode, activeShelfId]);

  function renderNodeVisualization() {
    const scene = sceneRef.current;
    const nodeGroup = waypointMarkersRef.current;
    if (!scene || !nodeGroup) return;

    // Clear previous markers
    while (nodeGroup.children.length) nodeGroup.remove(nodeGroup.children[0]);
    // Also clear any old spline line
    if (splineLineRef.current) {
      scene.remove(splineLineRef.current);
      (splineLineRef.current as THREE.Line).geometry?.dispose();
      splineLineRef.current = null;
    }
    if (lookAtMarkerRef.current) {
      scene.remove(lookAtMarkerRef.current);
      lookAtMarkerRef.current = null;
    }

    const isAdmin =
      modeRef.current === "admin-free" ||
      modeRef.current === "admin-node-edit" ||
      modeRef.current === "admin-pano-edit";
    if (!isAdmin) return;

    const nodes = config.pathNodes;
    const sphereGeo = new THREE.SphereGeometry(0.14, 12, 12);
    const drawnLinks = new Set<string>();

    for (const node of Object.values(nodes)) {
      const isHome = node.id === config.homeNodeId;
      const mat = new THREE.MeshBasicMaterial({
        color: isHome ? 0xf59e0b : 0x3b82f6,
        transparent: true,
        opacity: 0.85,
      });
      const mesh = new THREE.Mesh(sphereGeo, mat);
      mesh.position.set(node.position.x, node.position.y, node.position.z);
      nodeGroup.add(mesh);

      // Draw links
      for (const toId of node.links) {
        const key = [node.id, toId].sort().join("|");
        if (drawnLinks.has(key)) continue;
        drawnLinks.add(key);
        const to = nodes[toId];
        if (!to) continue;
        const pts = [fromV3(node.position), fromV3(to.position)];
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const lineMat = new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.6 });
        const line = new THREE.Line(geo, lineMat);
        nodeGroup.add(line);
      }
    }

    // Show active shelf camera position marker
    if (activeShelfId) {
      const shelf = config.shelves[activeShelfId];
      if (shelf?.cameraPosition) {
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(0.2, 12, 12),
          new THREE.MeshBasicMaterial({ color: 0x22c55e, wireframe: true }),
        );
        m.position.set(shelf.cameraPosition.x, shelf.cameraPosition.y, shelf.cameraPosition.z);
        nodeGroup.add(m);
      }
    }
  }

  // ---------- Camera control (free-fly) ----------
  const addWaypointRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't trap keys when typing in an input/textarea
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }
      keysRef.current[e.code] = true;
      const m = modeRef.current;
      const inAdmin = m === "admin-free" || m === "admin-node-edit";
      // 'M' shortcut to save shelf pose
      if (e.code === "KeyM" && !e.repeat && inAdmin) {
        addWaypointRef.current();
        return;
      }
      if (!inAdmin) return;
      // Blender-style transforms (only when something is selected & not pointer-locked)
      const tr = transformRef.current;
      if (tr.active) {
        if (e.code === "Escape") {
          e.preventDefault();
          cancelTransform();
          return;
        }
        if (e.code === "Enter" || e.code === "Space") {
          e.preventDefault();
          commitTransform();
          return;
        }
        if (e.code === "KeyX" || e.code === "KeyY" || e.code === "KeyZ") {
          e.preventDefault();
          tr.axis = e.code === "KeyX" ? "x" : e.code === "KeyY" ? "y" : "z";
          // Reset target to original then re-apply with new axis
          updateTransformGesture(tr.startMouseX, tr.startMouseY);
          // Force a refresh by re-emitting current mouse, but startMouse=>delta=0
          updateHud();
          return;
        }
        return;
      }
      if (
        !e.repeat &&
        !isPointerLockedRef.current &&
        selectedObjectIdRef.current &&
        (e.code === "KeyG" || e.code === "KeyR" || e.code === "KeyS")
      ) {
        e.preventDefault();
        const tool: TransformTool =
          e.code === "KeyG"
            ? "translate"
            : e.code === "KeyR"
              ? "rotate"
              : "scale";
        startTransform(tool);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.code] = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  function applyCameraRotation() {
    const cam = cameraRef.current;
    if (!cam) return;
    const euler = new THREE.Euler(pitchRef.current, yawRef.current, 0, "YXZ");
    cam.quaternion.setFromEuler(euler);
  }

  function updateCamera(dt: number) {
    const cam = cameraRef.current;
    if (!cam) return;
    if (navRef.current.active) return;
    const m = modeRef.current;
    const adminFree = m === "admin-free" || m === "admin-node-edit";
    if (!adminFree) return;

    const speed = (keysRef.current["ShiftLeft"] ? 8 : 3) * dt;

    // Movement vectors based on yaw only (so WASD is horizontal)
    const forward = new THREE.Vector3(
      -Math.sin(yawRef.current),
      0,
      -Math.cos(yawRef.current),
    );
    const right = new THREE.Vector3(
      Math.cos(yawRef.current),
      0,
      -Math.sin(yawRef.current),
    );

    if (keysRef.current["KeyW"]) cam.position.addScaledVector(forward, speed);
    if (keysRef.current["KeyS"]) cam.position.addScaledVector(forward, -speed);
    if (keysRef.current["KeyA"]) cam.position.addScaledVector(right, -speed);
    if (keysRef.current["KeyD"]) cam.position.addScaledVector(right, speed);
    if (keysRef.current["KeyE"]) cam.position.y += speed;
    if (keysRef.current["KeyQ"]) cam.position.y -= speed;
  }

  // ---------- Pointer lock for mouse look ----------
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const dom = renderer.domElement;
    const onMouseDown = (e: MouseEvent) => {
      const m = modeRef.current;
      if (m !== "admin-free" && m !== "admin-node-edit") return;
      // While a transform gesture is active: LMB confirms, RMB cancels
      if (transformRef.current.active) {
        e.preventDefault();
        if (e.button === 0) commitTransform();
        else if (e.button === 2) cancelTransform();
        return;
      }
      // Right-button drag: rotate camera with edge wrap (via pointer lock)
      if (e.button === 2) {
        e.preventDefault();
        cameraRotateRef.current = true;
        setIsRightDragging(true);
        dom.requestPointerLock();
        return;
      }
      if (e.button !== 0) return;
      // Left-click: try selection raycast against scene objects
      const hit = raycastObjects(e);
      if (hit) {
        setSelectedObjectId(hit);
        setStatusMsg(
          hit === "scene" ? "Selected: Scene" : `Selected: ${objectName(hit)}`,
        );
        return;
      }
      // Empty space: clear selection
      if (selectedObjectIdRef.current) {
        setSelectedObjectId(null);
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2 && cameraRotateRef.current) {
        cameraRotateRef.current = false;
        setIsRightDragging(false);
        if (document.pointerLockElement === dom) document.exitPointerLock();
      }
    };
    const onContextMenu = (e: MouseEvent) => {
      // Always block native right-click menu over the canvas so RMB can drive camera/cancel
      e.preventDefault();
    };
    const onLockChange = () => {
      isPointerLockedRef.current = document.pointerLockElement === dom;
      // If lock was lost externally (Esc), clean up state
      if (!isPointerLockedRef.current) {
        if (cameraRotateRef.current) cameraRotateRef.current = false;
      }
    };
    const onMouseMove = (e: MouseEvent) => {
      // Always track real cursor position when not locked
      if (!isPointerLockedRef.current) {
        lastMouseRef.current.x = e.clientX;
        lastMouseRef.current.y = e.clientY;
        virtualMouseRef.current.x = e.clientX;
        virtualMouseRef.current.y = e.clientY;
      }
      // Camera rotate via right-mouse drag (pointer-locked for edge wrap)
      if (cameraRotateRef.current && isPointerLockedRef.current) {
        yawRef.current -= e.movementX * 0.0025;
        pitchRef.current -= e.movementY * 0.0025;
        pitchRef.current = Math.max(
          -Math.PI / 2 + 0.01,
          Math.min(Math.PI / 2 - 0.01, pitchRef.current),
        );
        applyCameraRotation();
        return;
      }
      // Transform gesture: accumulate movement into virtual cursor
      if (transformRef.current.active) {
        if (isPointerLockedRef.current) {
          virtualMouseRef.current.x += e.movementX;
          virtualMouseRef.current.y += e.movementY;
        }
        updateTransformGesture(
          virtualMouseRef.current.x,
          virtualMouseRef.current.y,
        );
      }
    };
    const onWheel = (e: WheelEvent) => {
      const m = modeRef.current;
      if (m !== "admin-free" && m !== "admin-node-edit") return;
      const cam = cameraRef.current;
      if (!cam) return;
      e.preventDefault();
      cam.fov = Math.max(20, Math.min(110, cam.fov + e.deltaY * 0.05));
      cam.updateProjectionMatrix();
    };
    dom.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mouseup", onMouseUp);
    dom.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("mousemove", onMouseMove);
    dom.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      dom.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mouseup", onMouseUp);
      dom.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("mousemove", onMouseMove);
      dom.removeEventListener("wheel", onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startTransform(tool: TransformTool) {
    const targetId = selectedObjectIdRef.current;
    if (!targetId) return;
    // Read original from the live Object3D so consecutive transforms compose
    const obj = getSelectedObject3D();
    if (!obj) return;
    const original = readTransformFromObject(obj);
    // Reset virtual cursor to physical cursor location, then lock pointer for edge wrap
    virtualMouseRef.current.x = lastMouseRef.current.x;
    virtualMouseRef.current.y = lastMouseRef.current.y;
    transformRef.current = {
      active: true,
      tool,
      axis: null,
      startMouseX: virtualMouseRef.current.x,
      startMouseY: virtualMouseRef.current.y,
      targetId,
      original: {
        position: { ...original.position },
        rotation: { ...original.rotation },
        scale: { ...original.scale },
      },
    };
    const dom = rendererRef.current?.domElement;
    if (dom && document.pointerLockElement !== dom) {
      dom.requestPointerLock();
    }
    updateHud();
    setStatusMsg(
      `${tool.toUpperCase()}: move mouse · X/Y/Z lock axis · LMB/Enter confirm · RMB/Esc cancel`,
    );
  }

  function updateHud() {
    const tr = transformRef.current;
    if (!tr.active) {
      setTransformHud("");
      return;
    }
    const obj = getSelectedObject3D();
    if (!obj) return;
    const t = readTransformFromObject(obj);
    const axis = tr.axis ? ` (${tr.axis.toUpperCase()})` : "";
    let body = "";
    if (tr.tool === "translate") {
      body = `pos ${fmt(t.position.x)}, ${fmt(t.position.y)}, ${fmt(t.position.z)}`;
    } else if (tr.tool === "rotate") {
      body = `rot ${fmt(t.rotation.x)}°, ${fmt(t.rotation.y)}°, ${fmt(t.rotation.z)}°`;
    } else {
      body = `scale ${fmt(t.scale.x)}, ${fmt(t.scale.y)}, ${fmt(t.scale.z)}`;
    }
    setTransformHud(`${tr.tool.toUpperCase()}${axis} — ${body}`);
  }

  function fmt(n: number) {
    return n.toFixed(2);
  }

  function readTransformFromObject(obj: THREE.Object3D): Transform {
    return {
      position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
      rotation: {
        x: THREE.MathUtils.radToDeg(obj.rotation.x),
        y: THREE.MathUtils.radToDeg(obj.rotation.y),
        z: THREE.MathUtils.radToDeg(obj.rotation.z),
      },
      scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
    };
  }

  function updateTransformGesture(mouseX: number, mouseY: number) {
    const tr = transformRef.current;
    if (!tr.active) return;
    const obj = getSelectedObject3D();
    if (!obj) return;
    const dx = mouseX - tr.startMouseX;
    const dy = mouseY - tr.startMouseY;
    // Reset to original each frame, then apply delta from there
    const t: Transform = {
      position: { ...tr.original.position },
      rotation: { ...tr.original.rotation },
      scale: { ...tr.original.scale },
    };
    // Axis-key mapping: world is Y-up. The user-pressed axis key maps to:
    //   X key -> world X (horizontal)
    //   Y key -> world Z (horizontal depth)
    //   Z key -> world Y (vertical / up)
    if (tr.tool === "translate") {
      const speed = 0.02;
      if (tr.axis === "x") {
        t.position.x = tr.original.position.x + dx * speed;
      } else if (tr.axis === "y") {
        t.position.z = tr.original.position.z + dx * speed;
      } else if (tr.axis === "z") {
        t.position.y = tr.original.position.y - dy * speed;
      } else {
        // No axis lock: drag on the horizontal XZ plane
        t.position.x = tr.original.position.x + dx * speed;
        t.position.z = tr.original.position.z + dy * speed;
      }
    } else if (tr.tool === "rotate") {
      const degPerPx = 0.5;
      const v = dx * degPerPx;
      if (tr.axis === "x") t.rotation.x = tr.original.rotation.x + v;
      else if (tr.axis === "y") t.rotation.z = tr.original.rotation.z + v;
      else if (tr.axis === "z") t.rotation.y = tr.original.rotation.y + v;
      else t.rotation.y = tr.original.rotation.y + v; // default: around vertical
    } else {
      const factor = 1 + dx * 0.005;
      const safe = Math.max(0.01, factor);
      if (!tr.axis) {
        t.scale.x = tr.original.scale.x * safe;
        t.scale.y = tr.original.scale.y * safe;
        t.scale.z = tr.original.scale.z * safe;
      } else if (tr.axis === "x") t.scale.x = tr.original.scale.x * safe;
      else if (tr.axis === "y") t.scale.z = tr.original.scale.z * safe;
      else if (tr.axis === "z") t.scale.y = tr.original.scale.y * safe;
    }
    applyTransformToObject(obj, t);
    updateHud();
  }

  function commitTransform() {
    const tr = transformRef.current;
    if (!tr.active) return;
    const dom = rendererRef.current?.domElement;
    if (dom && document.pointerLockElement === dom) document.exitPointerLock();
    const obj = getSelectedObject3D();
    if (!obj) {
      tr.active = false;
      setTransformHud("");
      return;
    }
    const finalT = readTransformFromObject(obj);
    const targetId = tr.targetId;
    tr.active = false;
    setTransformHud("");
    if (targetId === "scene") {
      setConfig((c) => ({ ...c, glbTransform: finalT }));
    } else if (targetId) {
      setConfig((c) => ({
        ...c,
        objects: c.objects.map((o) =>
          o.id === targetId ? { ...o, transform: finalT } : o,
        ),
      }));
    }
    setStatusMsg("Transform applied.");
  }

  function cancelTransform() {
    const tr = transformRef.current;
    if (!tr.active) return;
    const dom = rendererRef.current?.domElement;
    if (dom && document.pointerLockElement === dom) document.exitPointerLock();
    const obj = getSelectedObject3D();
    if (obj) applyTransformToObject(obj, tr.original);
    tr.active = false;
    setTransformHud("");
    setStatusMsg("Transform cancelled.");
  }

  function objectName(id: string): string {
    const o = config.objects.find((x) => x.id === id);
    return o ? o.name : id;
  }

  function raycastObjects(e: MouseEvent): SelectionId {
    const renderer = rendererRef.current;
    const cam = cameraRef.current;
    if (!renderer || !cam) return null;
    const dom = renderer.domElement;
    const rect = dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, cam);
    const targets: THREE.Object3D[] = [];
    for (const obj of objectsMapRef.current.values()) targets.push(obj);
    if (targets.length === 0) return null;
    const hits = raycaster.intersectObjects(targets, true);
    if (!hits.length) return null;
    // Walk up to find which object root this is
    let node: THREE.Object3D | null = hits[0].object;
    while (node) {
      const id = node.userData?.objectId as string | undefined;
      if (id) return id;
      node = node.parent;
    }
    return null;
  }

  // ---------- Navigation: constant-speed arc-length traversal ----------

  function easeInOutCubic(x: number) {
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }

  /** Create and show the glowing path tube in the scene */
  function showPathLine(path: Vec3[]) {
    const scene = sceneRef.current;
    if (!scene || path.length < 2) return;
    // Remove old
    const nav = navRef.current;
    if (nav.pathLineRef) {
      scene.remove(nav.pathLineRef);
      nav.pathLineRef.geometry.dispose();
      nav.pathLineRef = null;
    }
    try {
      const points = path.map(fromV3);
      const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.5);
      const tubeGeo = new THREE.TubeGeometry(curve, Math.max(20, path.length * 8), 0.03, 6, false);
      // Outer glow: additive blending, low opacity
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0x00c8ff,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const tube = new THREE.Mesh(tubeGeo, glowMat);
      scene.add(tube);
      nav.pathLineRef = tube;
    } catch {
      // Ignore tube creation errors (very short paths)
    }
  }

  function hidePathLine() {
    const nav = navRef.current;
    const scene = sceneRef.current;
    if (nav.pathLineRef && scene) {
      scene.remove(nav.pathLineRef);
      nav.pathLineRef.geometry.dispose();
      nav.pathLineRef = null;
    }
  }

  function updateNavigation(dt: number) {
    const nav = navRef.current;
    const cam = cameraRef.current;
    if (!nav.active || !cam || nav.path.length < 2) return;

    const prevTraversed = nav.traversed;
    nav.traversed = Math.min(nav.totalLength, nav.traversed + nav.speed * dt);
    const progress = nav.totalLength > 0 ? nav.traversed / nav.totalLength : 1;

    // --- Position ---
    const { pos } = samplePath(nav.path, nav.arcLengths, nav.traversed);
    cam.position.set(pos.x, pos.y, pos.z);

    // --- Rotation: smoothly faces direction of travel, independent from position ---
    const up = new THREE.Vector3(0, 1, 0);
    const ahead = nav.traversed + 0.5; // look 0.5 units ahead
    const { pos: aheadPos } = samplePath(nav.path, nav.arcLengths, Math.min(nav.totalLength, ahead));
    const lookDir = new THREE.Vector3(aheadPos.x - pos.x, aheadPos.y - pos.y, aheadPos.z - pos.z);
    lookDir.y *= 0.3; // dampen vertical component so camera stays mostly level

    let targetQuat: THREE.Quaternion;
    if (lookDir.length() > 0.001) {
      lookDir.normalize();
      const lookMat = new THREE.Matrix4().lookAt(new THREE.Vector3(), lookDir, up);
      targetQuat = new THREE.Quaternion().setFromRotationMatrix(lookMat);
    } else {
      targetQuat = nav.currentQuat.clone();
    }

    // Override final 20%: blend toward endLookAt
    if (nav.endLookAt && progress > 0.8) {
      const k = easeInOutCubic((progress - 0.8) / 0.2);
      const curPos = new THREE.Vector3(pos.x, pos.y, pos.z);
      const dist = curPos.distanceTo(nav.endLookAt);
      if (dist > 0.01) {
        const endLookMat = new THREE.Matrix4().lookAt(curPos, nav.endLookAt, up);
        const endQ = new THREE.Quaternion().setFromRotationMatrix(endLookMat);
        targetQuat.slerp(endQ, k);
      }
    }

    // Smooth rotation: slerp currentQuat toward targetQuat at ~4 rad/s
    const rotSpeed = Math.min(1, 4 * dt);
    nav.currentQuat.slerp(targetQuat, rotSpeed);
    cam.quaternion.copy(nav.currentQuat);

    if (nav.traversed >= nav.totalLength || (prevTraversed === nav.traversed)) {
      // Arrived
      nav.active = false;
      if (nav.endLookAt) {
        const finalPos = new THREE.Vector3(pos.x, pos.y, pos.z);
        if (finalPos.distanceTo(nav.endLookAt) > 0.01) {
          const m = new THREE.Matrix4().lookAt(finalPos, nav.endLookAt, up);
          cam.quaternion.setFromRotationMatrix(m);
        }
      }
      const e = new THREE.Euler().setFromQuaternion(cam.quaternion, "YXZ");
      yawRef.current = e.y;
      pitchRef.current = e.x;
      hidePathLine();
      const cb = nav.onComplete;
      nav.onComplete = null;
      if (cb) cb();
    }
  }

  /**
   * Start navigating from the camera's current position to toPos via the path graph.
   * The speed comes from config.cameraSpeed (units/sec).
   */
  function startNavigation(
    toPos: Vec3,
    endLookAt: Vec3 | null,
    onDone: () => void,
    fromNodeOverride?: string | null,
    toNodeOverride?: string | null,
  ) {
    const cam = cameraRef.current;
    if (!cam) { onDone(); return; }

    const fromPos = toV3(cam.position);
    const path = buildNavPath(fromPos, toPos, config.pathNodes, fromNodeOverride, toNodeOverride);

    if (path.length < 2) {
      // Teleport directly
      cam.position.set(toPos.x, toPos.y, toPos.z);
      if (endLookAt) {
        const la = fromV3(endLookAt);
        const m = new THREE.Matrix4().lookAt(cam.position, la, new THREE.Vector3(0, 1, 0));
        cam.quaternion.setFromRotationMatrix(m);
        const e = new THREE.Euler().setFromQuaternion(cam.quaternion, "YXZ");
        yawRef.current = e.y;
        pitchRef.current = e.x;
      }
      onDone();
      return;
    }

    const arcLengths = computeArcLengths(path);
    const totalLength = arcLengths[arcLengths.length - 1];
    const speed = Math.max(0.5, config.cameraSpeed);

    navRef.current = {
      active: true,
      path,
      arcLengths,
      totalLength,
      traversed: 0,
      speed,
      currentQuat: cam.quaternion.clone(),
      endLookAt: endLookAt ? fromV3(endLookAt) : null,
      onComplete: onDone,
      lastTimestamp: performance.now(),
      pathLineRef: navRef.current.pathLineRef,
    };

    showPathLine(path);
    setMode("navigating");
  }

  // ---------- Admin actions ----------
  function createShelf() {
    const id = newShelfId.trim();
    if (!id) { setStatusMsg("Enter a shelf ID."); return; }
    if (config.shelves[id]) {
      setStatusMsg(`Shelf ${id} already exists.`);
      setActiveShelfId(id);
      return;
    }
    const cam = cameraRef.current;
    const pos = cam ? toV3(cam.position) : { x: 0, y: 1.6, z: 0 };
    const dir = new THREE.Vector3();
    cam?.getWorldDirection(dir);
    const lookAt = cam ? toV3(cam.position.clone().add(dir.multiplyScalar(3))) : { x: 0, y: 1.6, z: -3 };
    const shelf: Shelf = {
      id,
      barcode: newShelfBarcode.trim(),
      cameraPosition: pos,
      cameraLookAt: lookAt,
      panoramaUrl: null,
      panoramaYaw: 0,
      panoramaPitch: 0,
      panoramaFov: 75,
      markerYaw: null,
      markerPitch: null,
    };
    setConfig((c) => ({ ...c, shelves: { ...c.shelves, [id]: shelf } }));
    setActiveShelfId(id);
    setNewShelfId("");
    setNewShelfBarcode("");
    setStatusMsg(`Created shelf ${id}.`);
  }

  function deleteShelf(id: string) {
    setConfig((c) => {
      const next = { ...c.shelves };
      delete next[id];
      return { ...c, shelves: next };
    });
    if (activeShelfId === id) setActiveShelfId(null);
  }

  /** Save current camera pose as this shelf's position. */
  function saveShelfPose() {
    const id = activeShelfIdRef.current;
    if (!id) { setStatusMsg("Select a shelf first."); return; }
    const cam = cameraRef.current;
    if (!cam) return;
    const pos = toV3(cam.position);
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const lookAt = toV3(cam.position.clone().add(dir.multiplyScalar(3)));
    setConfig((c) => {
      const shelf = c.shelves[id];
      if (!shelf) return c;
      return {
        ...c,
        shelves: { ...c.shelves, [id]: { ...shelf, cameraPosition: pos, cameraLookAt: lookAt } },
      };
    });
    setStatusMsg(`Shelf "${id}" pose saved.`);
  }
  // keep addWaypointRef compat (now saves shelf pose)
  addWaypointRef.current = saveShelfPose;

  function teleportToShelf(shelfId: string) {
    const shelf = config.shelves[shelfId];
    if (!shelf?.cameraPosition) return;
    const cam = cameraRef.current;
    if (!cam) return;
    cam.position.set(shelf.cameraPosition.x, shelf.cameraPosition.y, shelf.cameraPosition.z);
    if (shelf.cameraLookAt) {
      const dir = new THREE.Vector3()
        .subVectors(fromV3(shelf.cameraLookAt), fromV3(shelf.cameraPosition))
        .normalize();
      yawRef.current = Math.atan2(-dir.x, -dir.z);
      pitchRef.current = Math.asin(Math.max(-1, Math.min(1, dir.y)));
      applyCameraRotation();
    }
    setStatusMsg(`Teleported to shelf "${shelfId}".`);
  }

  function duplicateShelf(id: string) {
    const shelf = config.shelves[id];
    if (!shelf) return;
    let newId = `${id}_copy`;
    let attempt = 1;
    while (config.shelves[newId]) newId = `${id}_copy${attempt++}`;
    setConfig((c) => ({ ...c, shelves: { ...c.shelves, [newId]: { ...shelf, id: newId } } }));
    setActiveShelfId(newId);
    setStatusMsg(`Shelf duplicated as "${newId}".`);
  }

  function renameShelf(oldId: string, newId: string, barcode: string) {
    newId = newId.trim();
    barcode = barcode.trim();
    if (!newId) { setStatusMsg("Shelf ID cannot be empty."); return; }
    setConfig((c) => {
      const shelf = c.shelves[oldId];
      if (!shelf) return c;
      const next = { ...c.shelves };
      if (newId !== oldId) {
        if (next[newId]) { setStatusMsg(`Shelf "${newId}" already exists.`); return c; }
        delete next[oldId];
      }
      next[newId] = { ...shelf, id: newId, barcode };
      return { ...c, shelves: next };
    });
    if (newId !== oldId) setActiveShelfId(newId);
    setStatusMsg(`Shelf updated.`);
  }

  // ---------- Path node management ----------
  function addPathNodeAtCamera() {
    const cam = cameraRef.current;
    if (!cam) return;
    const pos = toV3(cam.position);
    const id = newNodeIdRef.current;
    newNodeIdRef.current = `n${parseInt(newNodeIdRef.current.slice(1), 10) + 1}`;
    const node: PathNode = { id, position: pos, links: [] };
    setConfig((c) => ({
      ...c,
      pathNodes: { ...c.pathNodes, [id]: node },
      homeNodeId: c.homeNodeId ?? id,
    }));
    setStatusMsg(`Node "${id}" placed at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}).`);
    return id;
  }

  function deletePathNode(id: string) {
    setConfig((c) => {
      const next = { ...c.pathNodes };
      delete next[id];
      // Remove links pointing to this node
      for (const nid of Object.keys(next)) {
        next[nid] = { ...next[nid], links: next[nid].links.filter((l) => l !== id) };
      }
      return {
        ...c,
        pathNodes: next,
        homeNodeId: c.homeNodeId === id ? null : c.homeNodeId,
      };
    });
    setStatusMsg(`Node "${id}" deleted.`);
  }

  function setHomeNode(id: string) {
    setConfig((c) => ({ ...c, homeNodeId: id }));
    setStatusMsg(`Home node set to "${id}".`);
  }

  // ---------- Home helpers ----------
  function setHomeFromCamera() {
    const cam = cameraRef.current;
    if (!cam) return;
    const pos = toV3(cam.position);
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const lookAt = toV3(cam.position.clone().add(dir.multiplyScalar(3)));
    setConfig((c) => ({ ...c, homePosition: pos, homeLookAt: lookAt }));
    setStatusMsg("Home position updated.");
  }

  function gotoHome() {
    const cam = cameraRef.current;
    if (!cam) return;
    const from = toV3(cam.position);
    const to = config.homePosition;
    const dist = v3dist(from, to);
    if (dist < 0.05) {
      const dir = new THREE.Vector3()
        .subVectors(fromV3(config.homeLookAt), fromV3(config.homePosition))
        .normalize();
      yawRef.current = Math.atan2(-dir.x, -dir.z);
      pitchRef.current = Math.asin(dir.y);
      applyCameraRotation();
      return;
    }
    startNavigation(to, config.homeLookAt, () => setMode("admin-free"),
      null, config.homeNodeId ?? null);
  }

  // ---------- File handling ----------
  function fetchServerConfigs() {
    fetch(`${API_BASE}/configs`)
      .then((r) => r.json())
      .then((d) => setServerConfigs(Array.isArray(d) ? d : d.configs ?? []))
      .catch(() => {});
  }

  useEffect(() => {
    fetchServerConfigs();
  }, []);

  function onGlbUpload(file: File) {
    setUploading(true);
    setStatusMsg("Uploading GLB...");
    uploadFile(file, "glb")
      .then((url) => {
        setConfig((c) => ({ ...c, glbUrl: url }));
        setStatusMsg("GLB uploaded and loaded.");
      })
      .catch((e) => {
        // Fall back to blob URL if server unavailable
        const url = URL.createObjectURL(file);
        setConfig((c) => ({ ...c, glbUrl: url }));
        setStatusMsg(`Server upload failed (${e.message}), loaded locally.`);
      })
      .finally(() => setUploading(false));
  }

  function onPanoUpload(file: File) {
    if (!activeShelfId) return;
    const shelfId = activeShelfId;
    setUploading(true);
    setStatusMsg("Uploading panorama...");
    uploadFile(file, "photo")
      .then((url) => {
        setConfig((c) => {
          const shelf = c.shelves[shelfId];
          if (!shelf) return c;
          return { ...c, shelves: { ...c.shelves, [shelfId]: { ...shelf, panoramaUrl: url } } };
        });
        setStatusMsg("Panorama uploaded and loaded.");
      })
      .catch((e) => {
        const url = URL.createObjectURL(file);
        setConfig((c) => {
          const shelf = c.shelves[shelfId];
          if (!shelf) return c;
          return { ...c, shelves: { ...c.shelves, [shelfId]: { ...shelf, panoramaUrl: url } } };
        });
        setStatusMsg(`Server upload failed (${e.message}), loaded locally.`);
      })
      .finally(() => setUploading(false));
  }

  function onObjectUpload(file: File) {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `obj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const baseName = file.name.replace(/\.(glb|gltf)$/i, "");
    setUploading(true);
    setStatusMsg("Uploading object...");
    uploadFile(file, "glb")
      .then((url) => {
        const newObj: SceneObject = {
          id, name: baseName || "Object", url,
          transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        };
        setConfig((c) => ({ ...c, objects: [...c.objects, newObj] }));
        setSelectedObjectId(id);
        setStatusMsg(`Imported "${newObj.name}".`);
      })
      .catch((e) => {
        const url = URL.createObjectURL(file);
        const newObj: SceneObject = {
          id, name: baseName || "Object", url,
          transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        };
        setConfig((c) => ({ ...c, objects: [...c.objects, newObj] }));
        setSelectedObjectId(id);
        setStatusMsg(`Server upload failed (${e.message}), loaded locally.`);
      })
      .finally(() => setUploading(false));
  }

  // ---------- Auth ----------
  async function loginAdmin() {
    setPasswordError("");
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPasswordError(data.error ?? "Login failed");
        return;
      }
      const tok: string = data.token;
      sessionStorage.setItem("admin-token", tok);
      setAdminToken(tok);
      setShowPasswordModal(false);
      setPasswordInput("");
      setPanel("admin");
    } catch {
      setPasswordError("Network error");
    }
  }

  async function logoutAdmin() {
    if (adminToken) {
      fetch(`${API_BASE}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: adminToken }),
      }).catch(() => {});
    }
    sessionStorage.removeItem("admin-token");
    setAdminToken(null);
    setPanel("runtime");
  }

  async function changePassword() {
    if (!adminToken) return;
    try {
      const res = await fetch(`${API_BASE}/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: adminToken, newPassword: newPasswordInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPasswordError(data.error ?? "Failed");
        return;
      }
      setShowChangePassword(false);
      setNewPasswordInput("");
      setStatusMsg("Password changed successfully.");
    } catch {
      setPasswordError("Network error");
    }
  }

  function saveConfigToServer() {
    const name = serverConfigName.trim() || "default";
    const cleaned: Config = {
      ...config,
      glbUrl: config.glbUrl?.startsWith("blob:") ? null : config.glbUrl,
      shelves: Object.fromEntries(
        Object.entries(config.shelves).map(([k, s]) => [k, { ...s, panoramaUrl: s.panoramaUrl?.startsWith("blob:") ? null : s.panoramaUrl }])
      ),
      objects: config.objects.map((o) => ({ ...o, url: o.url.startsWith("blob:") ? "" : o.url })),
    };
    fetch(`${API_BASE}/configs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, config: cleaned }),
    })
      .then((r) => r.json())
      .then((d) => {
        setStatusMsg(`Config saved as "${d.name}".`);
        fetchServerConfigs();
      })
      .catch((e) => setStatusMsg(`Save failed: ${e.message}`));
  }

  function loadConfigFromServer(name: string) {
    fetch(`${API_BASE}/configs/${encodeURIComponent(name)}`)
      .then((r) => r.json())
      .then((data) => {
        setConfig({ ...defaultConfig, ...data });
        setStatusMsg(`Config "${name}" loaded from server.`);
      })
      .catch((e) => setStatusMsg(`Load failed: ${e.message}`));
  }

  function removeObject(id: string) {
    setConfig((c) => ({ ...c, objects: c.objects.filter((o) => o.id !== id) }));
    if (selectedObjectId === id) setSelectedObjectId(null);
  }

  function renameObject(id: string, name: string) {
    setConfig((c) => ({
      ...c,
      objects: c.objects.map((o) => (o.id === id ? { ...o, name } : o)),
    }));
  }

  function updateObjectTransform(id: SelectionId, t: Transform) {
    if (id === "scene") {
      setConfig((c) => ({ ...c, glbTransform: t }));
    } else if (id) {
      setConfig((c) => ({
        ...c,
        objects: c.objects.map((o) =>
          o.id === id ? { ...o, transform: t } : o,
        ),
      }));
    }
  }

  function resetObjectTransform(id: SelectionId) {
    const reset: Transform = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    updateObjectTransform(id, reset);
  }

  function exportConfig() {
    // Strip blob: URLs since they aren't portable
    const cleaned: Config = {
      ...config,
      glbUrl: config.glbUrl?.startsWith("blob:") ? null : config.glbUrl,
      shelves: Object.fromEntries(
        Object.entries(config.shelves).map(([k, s]) => [
          k,
          {
            ...s,
            panoramaUrl: s.panoramaUrl?.startsWith("blob:") ? null : s.panoramaUrl,
          },
        ]),
      ),
      objects: config.objects.map((o) => ({
        ...o,
        url: o.url.startsWith("blob:") ? "" : o.url,
      })),
    };
    const blob = new Blob([JSON.stringify(cleaned, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "warehouse-config.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importConfig(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        setConfig({ ...defaultConfig, ...parsed });
        setStatusMsg("Config loaded.");
      } catch (e) {
        setStatusMsg("Failed to parse config JSON.");
      }
    };
    reader.readAsText(file);
  }

  // ---------- Runtime: navigate to shelf via path graph ----------
  function runRuntime(query: string) {
    const q = query.trim().toLowerCase();
    if (!q) return;
    const match = Object.values(config.shelves).find(
      (s) => s.id.toLowerCase() === q || s.barcode.toLowerCase() === q,
    );
    if (!match) {
      setStatusMsg(`No shelf found for "${query}".`);
      return;
    }
    if (!match.cameraPosition) {
      setStatusMsg(`Shelf "${match.id}" has no saved camera position yet.`);
      return;
    }
    setActiveShelfId(match.id);
    startNavigation(
      match.cameraPosition,
      match.cameraLookAt ?? null,
      () => {
        if (match.panoramaUrl) {
          enterPanorama(match);
        } else {
          setMode("admin-free");
          setStatusMsg(`Arrived at ${match.id}.`);
        }
      },
    );
  }

  function returnHome() {
    const wasPano =
      modeRef.current === "panorama" || modeRef.current === "admin-pano-edit";
    const cam = cameraRef.current;
    const atHome =
      !!cam &&
      cam.position.distanceTo(fromV3(config.homePosition)) < 0.1 &&
      !wasPano;
    if (atHome) {
      setStatusMsg("Already at home.");
      return;
    }
    if (wasPano) {
      runFade(() => {
        setMode("admin-free");
        gotoHome();
      });
    } else {
      gotoHome();
    }
  }

  // Quick fade-to-black overlay that runs `cb` at peak black
  function runFade(cb: () => void) {
    const fadeMs = 280;
    const start = performance.now();
    let didCb = false;
    const tick = () => {
      const t = (performance.now() - start) / fadeMs;
      if (t < 0.5) {
        setFadeAlpha(t * 2);
        requestAnimationFrame(tick);
      } else if (t < 1) {
        if (!didCb) {
          didCb = true;
          cb();
        }
        setFadeAlpha((1 - t) * 2);
        requestAnimationFrame(tick);
      } else {
        setFadeAlpha(0);
      }
    };
    requestAnimationFrame(tick);
  }

  // ---------- Panorama ----------
  useEffect(() => {
    const mount = panoMountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    panoSceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(
      75,
      mount.clientWidth / mount.clientHeight,
      0.1,
      1100,
    );
    camera.position.set(0, 0, 0);
    panoCameraRef.current = camera;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (e) {
      return; // Main setup already set webglError
    }
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    panoRendererRef.current = renderer;

    const geo = new THREE.SphereGeometry(500, 60, 40);
    geo.scale(-1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    const sphere = new THREE.Mesh(geo, mat);
    scene.add(sphere);
    panoSphereRef.current = sphere;

    // Marker sprite — map-pin shape (teardrop with circle)
    const markerCanvas = document.createElement("canvas");
    markerCanvas.width = 128;
    markerCanvas.height = 192;
    const ctx = markerCanvas.getContext("2d")!;
    // Drop shadow
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;
    // Pin body (teardrop)
    ctx.beginPath();
    const cx = 64;
    const headY = 64;
    const headR = 44;
    ctx.moveTo(cx, 180); // tip
    ctx.bezierCurveTo(cx + 38, 128, cx + headR, headY + 24, cx + headR, headY);
    ctx.arc(cx, headY, headR, 0, Math.PI, true);
    ctx.bezierCurveTo(cx - headR, headY + 24, cx - 38, 128, cx, 180);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 20, 0, 180);
    grad.addColorStop(0, "#f87171");
    grad.addColorStop(1, "#b91c1c");
    ctx.fillStyle = grad;
    ctx.fill();
    // Outline
    ctx.shadowColor = "transparent";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#7f1d1d";
    ctx.stroke();
    // Inner white circle
    ctx.beginPath();
    ctx.arc(cx, headY, 18, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#7f1d1d";
    ctx.stroke();
    const mTex = new THREE.CanvasTexture(markerCanvas);
    mTex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: mTex, depthTest: false, depthWrite: false, transparent: true }),
    );
    // Anchor sprite at the tip (bottom-center) so the pin "points" at the marker location
    sprite.center.set(0.5, 0);
    sprite.scale.set(40, 60, 1);
    sprite.visible = false;
    scene.add(sprite);
    panoMarkerRef.current = sprite;

    const onResize = () => {
      if (!mount || !panoRendererRef.current || !panoCameraRef.current) return;
      panoRendererRef.current.setSize(mount.clientWidth, mount.clientHeight);
      panoCameraRef.current.aspect = mount.clientWidth / mount.clientHeight;
      panoCameraRef.current.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    let raf = 0;
    const render = () => {
      const m = modeRef.current;
      if (m === "panorama" || m === "admin-pano-edit") {
        const cam = panoCameraRef.current!;
        cam.fov = panoFovRef.current;
        cam.updateProjectionMatrix();
        const euler = new THREE.Euler(
          panoPitchRef.current,
          panoYawRef.current,
          0,
          "YXZ",
        );
        cam.quaternion.setFromEuler(euler);
        panoRendererRef.current!.render(panoSceneRef.current!, cam);
      }
      raf = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Force pano renderer resize whenever we enter a pano mode
  useEffect(() => {
    if (mode !== "panorama" && mode !== "admin-pano-edit") return;
    const mount = panoMountRef.current;
    const renderer = panoRendererRef.current;
    const cam = panoCameraRef.current;
    if (!mount || !renderer || !cam) return;
    const w = mount.clientWidth || window.innerWidth;
    const h = mount.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }, [mode]);

  // Drag-to-look on panorama
  useEffect(() => {
    const mount = panoMountRef.current;
    if (!mount) return;
    let dragging = false;
    let lx = 0;
    let ly = 0;

    const onDown = (e: MouseEvent) => {
      // Pano editor: Shift+click places marker, plain drag rotates
      if (modeRef.current === "admin-pano-edit" && e.button === 0 && e.shiftKey) {
        placeMarkerAtScreen(e);
        return;
      }
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      panoYawRef.current -= dx * 0.005;
      panoPitchRef.current -= dy * 0.005;
      panoPitchRef.current = Math.max(
        -Math.PI / 2 + 0.01,
        Math.min(Math.PI / 2 - 0.01, panoPitchRef.current),
      );
    };
    const onUp = () => {
      dragging = false;
    };
    const onWheel = (e: WheelEvent) => {
      const m = modeRef.current;
      if (m !== "panorama" && m !== "admin-pano-edit") return;
      e.preventDefault();
      panoFovRef.current = Math.max(
        20,
        Math.min(110, panoFovRef.current + e.deltaY * 0.05),
      );
    };
    mount.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    mount.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      mount.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      mount.removeEventListener("wheel", onWheel);
    };
  }, []);

  function placeMarkerAtScreen(e: MouseEvent) {
    const mount = panoMountRef.current;
    const cam = panoCameraRef.current;
    if (!mount || !cam) return;
    const rect = mount.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, cam);
    const dir = raycaster.ray.direction.clone().normalize();
    // Convert to yaw/pitch relative to sphere center
    const pitch = Math.asin(dir.y);
    const yaw = Math.atan2(-dir.x, -dir.z);
    if (!activeShelfIdRef.current) return;
    const id = activeShelfIdRef.current;
    setConfig((c) => {
      const shelf = c.shelves[id];
      if (!shelf) return c;
      return {
        ...c,
        shelves: {
          ...c.shelves,
          [id]: { ...shelf, markerYaw: yaw, markerPitch: pitch },
        },
      };
    });
    updateMarkerSprite(yaw, pitch);
    setStatusMsg("Marker placed.");
  }

  function updateMarkerSprite(yaw: number | null, pitch: number | null) {
    const sprite = panoMarkerRef.current;
    if (!sprite) return;
    if (yaw === null || pitch === null) {
      sprite.visible = false;
      return;
    }
    const r = 480;
    const x = -r * Math.cos(pitch) * Math.sin(yaw);
    const y = r * Math.sin(pitch);
    const z = -r * Math.cos(pitch) * Math.cos(yaw);
    sprite.position.set(x, y, z);
    sprite.visible = true;
  }

  // Load panorama texture when active shelf or pano url changes (and we are in pano modes)
  useEffect(() => {
    if (!panoSphereRef.current) return;
    const sphere = panoSphereRef.current;
    const oldMat = sphere.material as THREE.MeshBasicMaterial;
    if (!activeShelfId) {
      oldMat.color.set(0x222222);
      oldMat.map = null;
      oldMat.needsUpdate = true;
      updateMarkerSprite(null, null);
      return;
    }
    const shelf = config.shelves[activeShelfId];
    if (!shelf || !shelf.panoramaUrl) {
      oldMat.color.set(0x222222);
      oldMat.map = null;
      oldMat.needsUpdate = true;
      updateMarkerSprite(null, null);
      return;
    }
    const loader = new THREE.TextureLoader();
    loader.load(shelf.panoramaUrl, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      oldMat.map = tex;
      oldMat.color.set(0xffffff);
      oldMat.needsUpdate = true;
    });
    updateMarkerSprite(shelf.markerYaw, shelf.markerPitch);
  }, [activeShelfId, config.shelves]);

  function enterPanorama(shelf: Shelf) {
    panoYawRef.current = shelf.panoramaYaw;
    panoPitchRef.current = shelf.panoramaPitch;
    panoFovRef.current = shelf.panoramaFov || 75;
    updateMarkerSprite(shelf.markerYaw, shelf.markerPitch);
    runFade(() => {
      setMode("panorama");
      setStatusMsg(`Viewing panorama for ${shelf.id}.`);
    });
  }

  function exitPanorama() {
    if (modeRef.current === "panorama" || modeRef.current === "admin-pano-edit") {
      setMode("admin-free");
    }
  }

  function setRotationPreset() {
    if (!activeShelfId) return;
    const yaw = panoYawRef.current;
    const pitch = panoPitchRef.current;
    const fov = panoFovRef.current;
    setConfig((c) => {
      const shelf = c.shelves[activeShelfId];
      if (!shelf) return c;
      return {
        ...c,
        shelves: {
          ...c.shelves,
          [activeShelfId]: {
            ...shelf,
            panoramaYaw: yaw,
            panoramaPitch: pitch,
            panoramaFov: fov,
          },
        },
      };
    });
    setStatusMsg("Rotation preset saved.");
  }

  function startPanoEdit() {
    if (!activeShelfId) {
      setStatusMsg("Select or create a shelf first.");
      return;
    }
    const shelf = config.shelves[activeShelfId];
    if (shelf) {
      panoYawRef.current = shelf.panoramaYaw;
      panoPitchRef.current = shelf.panoramaPitch;
      panoFovRef.current = shelf.panoramaFov || 75;
    }
    setMode("admin-pano-edit");
  }

  // ---------- UI ----------
  const activeShelf = activeShelfId ? config.shelves[activeShelfId] : null;
  const showPano = mode === "panorama" || mode === "admin-pano-edit";

  if (webglError) {
    return (
      <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0b0d10", color: "#e6e8eb", fontFamily: "inherit", padding: 32, textAlign: "center", gap: 16 }}>
        <div style={{ fontSize: 40 }}>⚠️</div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>WebGL Not Available</div>
        <div style={{ fontSize: 13, color: "#9ca3af", maxWidth: 480, lineHeight: 1.6 }}>
          {webglError}
        </div>
        <div style={{ fontSize: 12, color: "#6b7280" }}>
          This 3D warehouse tool requires WebGL. Try opening it in a new browser tab using the <strong>↗</strong> button in the preview toolbar.
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* 3D Scene */}
      <div
        ref={mountRef}
        style={{
          position: "absolute",
          inset: 0,
          opacity: showPano ? 0 : 1,
          pointerEvents: showPano ? "none" : "auto",
          zIndex: showPano ? 0 : 1,
        }}
      />
      {/* Panorama */}
      <div
        ref={panoMountRef}
        style={{
          position: "absolute",
          inset: 0,
          opacity: showPano ? 1 : 0,
          pointerEvents: showPano ? "auto" : "none",
          zIndex: showPano ? 1 : 0,
          display: "block",
          cursor: mode === "admin-pano-edit" ? "grab" : "grab",
        }}
      />

      {/* Top bar */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          right: 12,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          pointerEvents: "none",
          zIndex: 10,
        }}
      >
        <div
          className="panel"
          style={{
            pointerEvents: "auto",
            minWidth: 280,
            maxHeight: "calc(100vh - 100px)",
            overflowY: "auto",
            opacity: isRightDragging ? 0.08 : 1,
            transition: "opacity 0.25s ease",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 6,
              marginBottom: 10,
              padding: 4,
              background: "#1a1d22",
              borderRadius: 6,
              border: "1px solid #2a3038",
            }}
          >
            <button
              onClick={() => setPanel("runtime")}
              style={{
                padding: "8px 12px",
                fontSize: 13,
                fontWeight: 600,
                background: panel === "runtime" ? "#2563eb" : "transparent",
                borderColor: panel === "runtime" ? "#2563eb" : "transparent",
                color: panel === "runtime" ? "#fff" : "#9ca3af",
              }}
            >
              Runtime
            </button>
            <button
              onClick={() => {
                if (adminToken) {
                  setPanel("admin");
                } else {
                  setPasswordError("");
                  setPasswordInput("");
                  setShowPasswordModal(true);
                }
              }}
              style={{
                padding: "8px 12px",
                fontSize: 13,
                fontWeight: 600,
                background: panel === "admin" ? "#2563eb" : "transparent",
                borderColor: panel === "admin" ? "#2563eb" : "transparent",
                color: panel === "admin" ? "#fff" : "#9ca3af",
              }}
            >
              Admin{adminToken ? "" : " 🔒"}
            </button>
          </div>
          <div className="muted" style={{ marginBottom: 8, fontSize: 10 }}>
            Mode: <strong style={{ color: "#e6e8eb" }}>{mode}</strong>
          </div>

          {panel === "admin" && adminToken && (
            <AdminPanel
              config={config}
              activeShelf={activeShelf}
              activeShelfId={activeShelfId}
              setActiveShelfId={setActiveShelfId}
              newShelfId={newShelfId}
              setNewShelfId={setNewShelfId}
              newShelfBarcode={newShelfBarcode}
              setNewShelfBarcode={setNewShelfBarcode}
              createShelf={createShelf}
              deleteShelf={deleteShelf}
              duplicateShelf={duplicateShelf}
              renameShelf={renameShelf}
              saveShelfPose={saveShelfPose}
              teleportToShelf={teleportToShelf}
              addPathNodeAtCamera={addPathNodeAtCamera}
              deletePathNode={deletePathNode}
              setHomeNode={setHomeNode}
              setHomeFromCamera={setHomeFromCamera}
              gotoHome={gotoHome}
              startPanoEdit={startPanoEdit}
              showNodeGraph={showNodeGraph}
              setShowNodeGraph={setShowNodeGraph}
              setRotationPreset={setRotationPreset}
              onGlbUpload={onGlbUpload}
              onPanoUpload={onPanoUpload}
              exportConfig={exportConfig}
              importConfig={importConfig}
              mode={mode}
              setMode={setMode}
              selectedObjectId={selectedObjectId}
              setSelectedObjectId={setSelectedObjectId}
              onObjectUpload={onObjectUpload}
              removeObject={removeObject}
              renameObject={renameObject}
              updateObjectTransform={updateObjectTransform}
              resetObjectTransform={resetObjectTransform}
              setConfig={setConfig}
              uploading={uploading}
              serverConfigs={serverConfigs}
              serverConfigName={serverConfigName}
              setServerConfigName={setServerConfigName}
              saveConfigToServer={saveConfigToServer}
              loadConfigFromServer={loadConfigFromServer}
              logoutAdmin={logoutAdmin}
              showChangePassword={showChangePassword}
              setShowChangePassword={setShowChangePassword}
              newPasswordInput={newPasswordInput}
              setNewPasswordInput={setNewPasswordInput}
              changePassword={changePassword}
              passwordError={passwordError}
              setPasswordError={setPasswordError}
            />
          )}

          {panel === "runtime" && (
            <RuntimePanel
              query={runtimeQuery}
              setQuery={setRuntimeQuery}
              run={runRuntime}
              shelves={Object.values(config.shelves)}
              returnHome={returnHome}
              mode={mode}
            />
          )}
        </div>

        <div className="panel" style={{ pointerEvents: "auto", maxWidth: 320 }}>
          <h3>Controls</h3>
          {mode === "admin-free" || mode === "admin-node-edit" ? (
            <div className="muted" style={{ lineHeight: 1.6 }}>
              Right-click drag = look (mouse wraps at edges) · WASD = move ·
              Q/E = down/up · Shift = sprint · Wheel = FOV · Left-click = select
            </div>
          ) : mode === "admin-pano-edit" ? (
            <div className="muted" style={{ lineHeight: 1.6 }}>
              Drag = rotate view · Shift+Click = place marker · Wheel = zoom
            </div>
          ) : mode === "panorama" ? (
            <div className="muted" style={{ lineHeight: 1.6 }}>
              Drag = look around · Wheel = zoom
            </div>
          ) : (
            <div className="muted">Camera in motion...</div>
          )}
        </div>
      </div>

      {/* Status bar */}
      {statusMsg && (
        <div
          style={{
            position: "absolute",
            bottom: 12,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(15,17,21,0.92)",
            border: "1px solid #2a3038",
            padding: "8px 14px",
            borderRadius: 6,
            fontSize: 12,
            pointerEvents: "auto",
            zIndex: 10,
          }}
        >
          {statusMsg}
        </div>
      )}

      {/* Transform HUD */}
      {transformHud && (
        <div
          style={{
            position: "absolute",
            top: 70,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(37,99,235,0.95)",
            color: "#fff",
            padding: "6px 12px",
            borderRadius: 4,
            fontSize: 12,
            fontFamily: "monospace",
            pointerEvents: "none",
            zIndex: 10,
          }}
        >
          {transformHud}
        </div>
      )}

      {/* Center crosshair in admin 3D modes */}
      {(mode === "admin-free" || mode === "admin-node-edit") && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: 12,
            height: 12,
            border: "1px solid rgba(255,255,255,0.5)",
            borderRadius: "50%",
            pointerEvents: "none",
          }}
        />
      )}

      {/* Node Graph Editor overlay */}
      {showNodeGraph && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowNodeGraph(false); }}
        >
          <NodeGraphView
            nodes={config.pathNodes}
            homeNodeId={config.homeNodeId}
            onClose={() => setShowNodeGraph(false)}
            onAddLink={(fromId, toId) =>
              setConfig((c) => {
                const nodes = { ...c.pathNodes };
                const from = nodes[fromId];
                const to = nodes[toId];
                if (!from || !to) return c;
                const fl = from.links.includes(toId) ? from.links : [...from.links, toId];
                const tl = to.links.includes(fromId) ? to.links : [...to.links, fromId];
                nodes[fromId] = { ...from, links: fl };
                nodes[toId] = { ...to, links: tl };
                return { ...c, pathNodes: nodes };
              })
            }
            onRemoveLink={(fromId, toId) =>
              setConfig((c) => {
                const nodes = { ...c.pathNodes };
                const from = nodes[fromId];
                const to = nodes[toId];
                if (from) nodes[fromId] = { ...from, links: from.links.filter((l) => l !== toId) };
                if (to) nodes[toId] = { ...to, links: to.links.filter((l) => l !== fromId) };
                return { ...c, pathNodes: nodes };
              })
            }
            onRemoveNode={deletePathNode}
            onSetHomeNode={setHomeNode}
          />
        </div>
      )}

      {/* Admin password modal */}
      {showPasswordModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowPasswordModal(false); }}
        >
          <div
            className="panel"
            style={{ width: 280, pointerEvents: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h4 style={{ marginTop: 0, marginBottom: 12 }}>Admin Login</h4>
            <input
              type="password"
              placeholder="Password"
              value={passwordInput}
              autoFocus
              onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(""); }}
              onKeyDown={(e) => e.key === "Enter" && loginAdmin()}
              style={{ width: "100%", marginBottom: 8 }}
            />
            {passwordError && (
              <div style={{ fontSize: 11, color: "#f87171", marginBottom: 8 }}>{passwordError}</div>
            )}
            <div className="row">
              <button className="primary" onClick={loginAdmin}>Login</button>
              <button onClick={() => setShowPasswordModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Admin panel ----------------
function AdminPanel(props: {
  config: Config;
  activeShelf: Shelf | null;
  activeShelfId: string | null;
  setActiveShelfId: (id: string | null) => void;
  newShelfId: string;
  setNewShelfId: (s: string) => void;
  newShelfBarcode: string;
  setNewShelfBarcode: (s: string) => void;
  createShelf: () => void;
  deleteShelf: (id: string) => void;
  duplicateShelf: (id: string) => void;
  renameShelf: (oldId: string, newId: string, barcode: string) => void;
  saveShelfPose: () => void;
  teleportToShelf: (shelfId: string) => void;
  addPathNodeAtCamera: () => void;
  deletePathNode: (id: string) => void;
  setHomeNode: (id: string) => void;
  setHomeFromCamera: () => void;
  gotoHome: () => void;
  startPanoEdit: () => void;
  showNodeGraph: boolean;
  setShowNodeGraph: (v: boolean) => void;
  setRotationPreset: () => void;
  onGlbUpload: (f: File) => void;
  onPanoUpload: (f: File) => void;
  exportConfig: () => void;
  importConfig: (f: File) => void;
  mode: AppMode;
  setMode: (m: AppMode) => void;
  selectedObjectId: SelectionId;
  setSelectedObjectId: (id: SelectionId) => void;
  onObjectUpload: (f: File) => void;
  removeObject: (id: string) => void;
  renameObject: (id: string, name: string) => void;
  updateObjectTransform: (id: SelectionId, t: Transform) => void;
  resetObjectTransform: (id: SelectionId) => void;
  setConfig: React.Dispatch<React.SetStateAction<Config>>;
  uploading: boolean;
  serverConfigs: string[];
  serverConfigName: string;
  setServerConfigName: (s: string) => void;
  saveConfigToServer: () => void;
  loadConfigFromServer: (name: string) => void;
  logoutAdmin: () => void;
  showChangePassword: boolean;
  setShowChangePassword: (v: boolean) => void;
  newPasswordInput: string;
  setNewPasswordInput: (v: string) => void;
  changePassword: () => void;
  passwordError: string;
  setPasswordError: (v: string) => void;
}) {
  const {
    config,
    activeShelf,
    activeShelfId,
    setActiveShelfId,
    newShelfId,
    setNewShelfId,
    newShelfBarcode,
    setNewShelfBarcode,
    createShelf,
    deleteShelf,
    duplicateShelf,
    renameShelf,
    saveShelfPose,
    teleportToShelf,
    addPathNodeAtCamera,
    deletePathNode,
    setHomeNode,
    setHomeFromCamera,
    gotoHome,
    startPanoEdit,
    showNodeGraph,
    setShowNodeGraph,
    setRotationPreset,
    onGlbUpload,
    onPanoUpload,
    exportConfig,
    importConfig,
    mode,
    setMode,
    selectedObjectId,
    setSelectedObjectId,
    onObjectUpload,
    removeObject,
    renameObject,
    updateObjectTransform,
    resetObjectTransform,
    setConfig,
    uploading,
    serverConfigs,
    serverConfigName,
    setServerConfigName,
    saveConfigToServer,
    loadConfigFromServer,
    logoutAdmin,
    showChangePassword,
    setShowChangePassword,
    newPasswordInput,
    setNewPasswordInput,
    changePassword,
    passwordError,
    setPasswordError,
  } = props;
  const [renameShelfId, setRenameShelfId] = useState("");
  const [renameShelfBarcode, setRenameShelfBarcode] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const shelfList = Object.values(config.shelves);
  const selectedTransform: Transform | null =
    selectedObjectId === "scene"
      ? config.glbTransform
      : selectedObjectId
        ? config.objects.find((o) => o.id === selectedObjectId)?.transform ?? null
        : null;

  return (
    <div className="col">
      <h4>Warehouse Model</h4>
      <div className="row">
        <label
          className="primary"
          style={{
            display: "inline-block",
            color: "#fff",
            background: "#2563eb",
            padding: "6px 10px",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 12,
            textTransform: "none",
            letterSpacing: 0,
            fontWeight: 500,
          }}
        >
          Upload GLB
          <input
            type="file"
            accept=".glb,.gltf"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onGlbUpload(f);
            }}
          />
        </label>
        <span className="muted" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {config.glbUrl ? "Loaded" : "No model"}
        </span>
      </div>

      {/* Gaussian splat URL */}
      <div style={{ marginTop: 6 }}>
        <div className="muted" style={{ fontSize: 11, marginBottom: 3 }}>Gaussian Splat URL (.ksplat / .splat)</div>
        <div className="row" style={{ gap: 4 }}>
          <input
            style={{ flex: 1, fontSize: 11 }}
            placeholder="https://…/scene.ksplat"
            value={config.splatUrl ?? ""}
            onChange={(e) =>
              setConfig((c) => ({ ...c, splatUrl: e.target.value || null }))
            }
          />
          {config.splatUrl && (
            <button
              style={{ fontSize: 11, padding: "3px 7px" }}
              className="danger"
              onClick={() => setConfig((c) => ({ ...c, splatUrl: null }))}
            >✕</button>
          )}
        </div>
      </div>

      <div className="divider" />

      <h4>Scene Objects</h4>
      <div className="col" style={{ gap: 4 }}>
        {config.glbUrl && (
          <button
            onClick={() =>
              setSelectedObjectId(selectedObjectId === "scene" ? null : "scene")
            }
            style={{
              textAlign: "left",
              background: selectedObjectId === "scene" ? "#2563eb" : undefined,
              borderColor: selectedObjectId === "scene" ? "#2563eb" : undefined,
            }}
          >
            🏢 Warehouse Scene
          </button>
        )}
        {config.objects.map((o) => (
          <div key={o.id} className="row" style={{ gap: 4 }}>
            <button
              onClick={() =>
                setSelectedObjectId(selectedObjectId === o.id ? null : o.id)
              }
              style={{
                flex: 1,
                textAlign: "left",
                background: selectedObjectId === o.id ? "#2563eb" : undefined,
                borderColor: selectedObjectId === o.id ? "#2563eb" : undefined,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={o.name}
            >
              📦 {o.name}
            </button>
            <button
              className="danger"
              onClick={() => removeObject(o.id)}
              title="Remove"
              style={{ padding: "4px 8px" }}
            >
              ×
            </button>
          </div>
        ))}
        <label
          style={{
            display: "inline-block",
            background: "#2a3038",
            border: "1px solid #3a414b",
            padding: "6px 10px",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 12,
            textTransform: "none",
            letterSpacing: 0,
            fontWeight: 500,
            textAlign: "center",
          }}
        >
          + Import Object (.glb)
          <input
            type="file"
            accept=".glb,.gltf"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onObjectUpload(f);
              e.target.value = "";
            }}
          />
        </label>
        {selectedObjectId && selectedTransform && (
          <TransformEditor
            label={
              selectedObjectId === "scene"
                ? "Warehouse Scene"
                : config.objects.find((o) => o.id === selectedObjectId)?.name ?? ""
            }
            transform={selectedTransform}
            onChange={(t) => updateObjectTransform(selectedObjectId, t)}
            onReset={() => resetObjectTransform(selectedObjectId)}
            onRename={
              selectedObjectId !== "scene"
                ? (name) => renameObject(selectedObjectId, name)
                : undefined
            }
          />
        )}
        <div className="muted" style={{ fontSize: 10, lineHeight: 1.5 }}>
          Click an object in 3D to select · G/R/S = move/rotate/scale ·
          X/Y/Z = lock axis · LMB confirm · RMB or Esc cancel
        </div>
      </div>

      <div className="divider" />

      <h4>Home Position</h4>
      <div className="row">
        <button onClick={setHomeFromCamera}>Set From Camera</button>
        <button onClick={gotoHome}>Go to Home</button>
      </div>

      <div className="divider" />

      <h4>Path Nodes ({Object.keys(config.pathNodes).length})</h4>
      <div className="col" style={{ gap: 4 }}>
        <div className="row">
          <button onClick={addPathNodeAtCamera}>+ Place Node Here</button>
          <button onClick={() => setShowNodeGraph(true)}>Edit Graph</button>
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          Home node: {config.homeNodeId ?? "none"}
        </div>
        {/* Speed slider */}
        <label className="muted" style={{ display: "block" }}>
          Travel speed: {config.cameraSpeed.toFixed(1)} u/s
          <input
            type="range"
            min={0.5}
            max={15}
            step={0.5}
            value={config.cameraSpeed}
            onChange={(e) =>
              setConfig((c) => ({ ...c, cameraSpeed: parseFloat(e.target.value) }))
            }
            style={{ width: "100%" }}
          />
        </label>
        {/* Node list */}
        {Object.values(config.pathNodes).length > 0 && (
          <div className="col" style={{ gap: 2, maxHeight: 120, overflowY: "auto" }}>
            {Object.values(config.pathNodes).map((n) => (
              <div key={n.id} className="row" style={{ gap: 4, fontSize: 11 }}>
                <span style={{ flex: 1, fontFamily: "monospace" }}>
                  {n.id === config.homeNodeId ? "⌂ " : ""}{n.id}
                  {" "}({n.position.x.toFixed(1)},{n.position.y.toFixed(1)},{n.position.z.toFixed(1)})
                  {" · "}{n.links.length} links
                </span>
                <button
                  style={{ fontSize: 10, padding: "2px 5px" }}
                  onClick={() => setHomeNode(n.id)}
                  title="Set as home node"
                >⌂</button>
                <button
                  style={{ fontSize: 10, padding: "2px 5px" }}
                  className="danger"
                  onClick={() => deletePathNode(n.id)}
                >✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="divider" />

      <h4>Shelves</h4>
      <div className="col">
        <input
          placeholder="Shelf ID (e.g. A12)"
          value={newShelfId}
          onChange={(e) => setNewShelfId(e.target.value)}
        />
        <input
          placeholder="Barcode (optional)"
          value={newShelfBarcode}
          onChange={(e) => setNewShelfBarcode(e.target.value)}
        />
        <button className="primary" onClick={createShelf}>
          Create / Select Shelf
        </button>
      </div>

      {shelfList.length > 0 && (
        <select
          value={activeShelfId ?? ""}
          onChange={(e) => setActiveShelfId(e.target.value || null)}
        >
          <option value="">— Select shelf —</option>
          {shelfList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id} {s.barcode ? `(${s.barcode})` : ""}
            </option>
          ))}
        </select>
      )}

      {activeShelf && (
        <>
          <div className="divider" />
          <h4>
            Editing: {activeShelf.id}
            {activeShelf.barcode ? ` · ${activeShelf.barcode}` : ""}
          </h4>

          <div className="row">
            <button
              className={mode === "admin-node-edit" ? "primary" : ""}
              onClick={() => setMode("admin-node-edit")}
            >
              3D Editor
            </button>
            <button
              className={mode === "admin-pano-edit" ? "primary" : ""}
              onClick={startPanoEdit}
            >
              360° Editor
            </button>
          </div>

          {/* Rename / Duplicate shelf */}
          <div className="col" style={{ gap: 4 }}>
            <h4>Shelf Identity</h4>
            {renamingId === activeShelf.id ? (
              <>
                <input
                  placeholder="New shelf ID"
                  value={renameShelfId}
                  onChange={(e) => setRenameShelfId(e.target.value)}
                />
                <input
                  placeholder="Barcode"
                  value={renameShelfBarcode}
                  onChange={(e) => setRenameShelfBarcode(e.target.value)}
                />
                <div className="row">
                  <button className="primary" onClick={() => { renameShelf(activeShelf.id, renameShelfId, renameShelfBarcode); setRenamingId(null); }}>Save</button>
                  <button onClick={() => setRenamingId(null)}>Cancel</button>
                </div>
              </>
            ) : (
              <div className="row">
                <button onClick={() => { setRenameShelfId(activeShelf.id); setRenameShelfBarcode(activeShelf.barcode); setRenamingId(activeShelf.id); }}>Rename / Barcode</button>
                <button onClick={() => duplicateShelf(activeShelf.id)}>Duplicate</button>
              </div>
            )}
          </div>

          {(mode === "admin-node-edit" || mode === "admin-free") && (
            <div className="col">
              <h4>Shelf Pose</h4>
              <div className="row">
                <button onClick={saveShelfPose}>Save Camera Here [M]</button>
                <button
                  disabled={!activeShelf.cameraPosition}
                  onClick={() => teleportToShelf(activeShelfId!)}
                >
                  Teleport
                </button>
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                {activeShelf.cameraPosition
                  ? `Pos: (${activeShelf.cameraPosition.x.toFixed(1)}, ${activeShelf.cameraPosition.y.toFixed(1)}, ${activeShelf.cameraPosition.z.toFixed(1)})`
                  : "No pose saved yet"}
              </div>
            </div>
          )}

          {mode === "admin-pano-edit" && (
            <div className="col">
              <h4>Panorama Tools</h4>
              <label
                style={{
                  display: "inline-block",
                  background: "#2a3038",
                  border: "1px solid #3a414b",
                  padding: "6px 10px",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontSize: 12,
                  textTransform: "none",
                  letterSpacing: 0,
                  fontWeight: 500,
                  textAlign: "center",
                }}
              >
                Upload 360° Image
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onPanoUpload(f);
                  }}
                />
              </label>
              <button onClick={setRotationPreset}>Save Rotation Preset</button>
              <div className="muted">
                Image: {activeShelf.panoramaUrl ? "loaded" : "—"} · Marker:{" "}
                {activeShelf.markerYaw !== null ? "placed" : "—"}
              </div>
              <button onClick={() => setMode("admin-free")}>← Back to 3D</button>
            </div>
          )}

          <button
            className="danger"
            onClick={() => deleteShelf(activeShelf.id)}
          >
            Delete Shelf
          </button>
        </>
      )}

      <div className="divider" />

      <h4>Config</h4>

      <div className="col" style={{ gap: 4 }}>
        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}>Save / load on this device</div>
        <div className="row" style={{ gap: 4 }}>
          <input
            value={serverConfigName}
            onChange={(e) => setServerConfigName(e.target.value)}
            placeholder="Config name"
            style={{ flex: 1, fontSize: 12 }}
          />
          <button
            className="primary"
            style={{ fontSize: 12, padding: "4px 10px" }}
            onClick={saveConfigToServer}
          >
            Save
          </button>
        </div>
        {serverConfigs.length > 0 && (
          <div className="row" style={{ gap: 4 }}>
            <select
              style={{ flex: 1, fontSize: 12 }}
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) loadConfigFromServer(e.target.value);
                e.target.value = "";
              }}
            >
              <option value="">— Load saved config —</option>
              {serverConfigs.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="divider" />

      <div className="col" style={{ gap: 4 }}>
        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}>Import / export JSON file</div>
        <div className="row">
          <button onClick={exportConfig}>Download JSON</button>
          <label
            style={{
              display: "inline-block",
              background: "#2a3038",
              border: "1px solid #3a414b",
              padding: "6px 10px",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 12,
              textTransform: "none",
              letterSpacing: 0,
              fontWeight: 500,
            }}
          >
            Load JSON
            <input
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importConfig(f);
              }}
            />
          </label>
        </div>
      </div>

      {uploading && (
        <div style={{ fontSize: 11, color: "#60a5fa", textAlign: "center", marginTop: 4 }}>
          Uploading…
        </div>
      )}

      <div className="divider" />
      <div className="col" style={{ gap: 4 }}>
        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}>Admin Account</div>
        {showChangePassword ? (
          <>
            <input
              type="password"
              placeholder="New password"
              value={newPasswordInput}
              onChange={(e) => { setNewPasswordInput(e.target.value); setPasswordError(""); }}
              onKeyDown={(e) => e.key === "Enter" && changePassword()}
            />
            {passwordError && <div style={{ fontSize: 11, color: "#f87171" }}>{passwordError}</div>}
            <div className="row">
              <button className="primary" onClick={changePassword}>Save</button>
              <button onClick={() => { setShowChangePassword(false); setNewPasswordInput(""); setPasswordError(""); }}>Cancel</button>
            </div>
          </>
        ) : (
          <div className="row">
            <button onClick={() => setShowChangePassword(true)}>Change Password</button>
            <button className="danger" onClick={logoutAdmin}>Log Out</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- Runtime panel ----------------
function TransformEditor(props: {
  label: string;
  transform: Transform;
  onChange: (t: Transform) => void;
  onReset: () => void;
  onRename?: (name: string) => void;
}) {
  const { label, transform, onChange, onReset, onRename } = props;
  const num = (v: string) => {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  };
  const Field = (props: {
    val: number;
    onSet: (n: number) => void;
    step?: number;
  }) => (
    <input
      type="number"
      step={props.step ?? 0.1}
      value={Number(props.val.toFixed(3))}
      onChange={(e) => props.onSet(num(e.target.value))}
      style={{ width: "100%", fontSize: 11, padding: "2px 4px" }}
    />
  );
  return (
    <div
      style={{
        background: "#1a1f27",
        border: "1px solid #2a3038",
        borderRadius: 4,
        padding: 8,
        marginTop: 6,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {onRename ? (
        <input
          value={label}
          onChange={(e) => onRename(e.target.value)}
          style={{ fontSize: 12, fontWeight: 600 }}
        />
      ) : (
        <div style={{ fontSize: 12, fontWeight: 600 }}>{label}</div>
      )}
      {(["position", "rotation", "scale"] as const).map((key) => (
        <div key={key}>
          <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>
            {key}
            {key === "rotation" ? " (deg)" : ""}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
            <Field
              val={transform[key].x}
              step={key === "scale" ? 0.05 : key === "rotation" ? 1 : 0.1}
              onSet={(n) =>
                onChange({ ...transform, [key]: { ...transform[key], x: n } })
              }
            />
            <Field
              val={transform[key].y}
              step={key === "scale" ? 0.05 : key === "rotation" ? 1 : 0.1}
              onSet={(n) =>
                onChange({ ...transform, [key]: { ...transform[key], y: n } })
              }
            />
            <Field
              val={transform[key].z}
              step={key === "scale" ? 0.05 : key === "rotation" ? 1 : 0.1}
              onSet={(n) =>
                onChange({ ...transform, [key]: { ...transform[key], z: n } })
              }
            />
          </div>
        </div>
      ))}
      <button onClick={onReset} style={{ fontSize: 11 }}>
        Reset Transform
      </button>
    </div>
  );
}

function RuntimePanel(props: {
  query: string;
  setQuery: (s: string) => void;
  run: (q: string) => void;
  shelves: Shelf[];
  returnHome: () => void;
  mode: AppMode;
}) {
  const { query, setQuery, run, shelves, returnHome, mode } = props;
  return (
    <div className="col">
      <h4>Find Shelf</h4>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(query);
        }}
        style={{ display: "flex", gap: 6 }}
      >
        <input
          placeholder="Shelf ID or barcode"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <button className="primary" type="submit" disabled={mode === "navigating"}>
          Go
        </button>
      </form>
      <div className="muted">
        {shelves.length} shelves available
      </div>

      {shelves.length > 0 && (
        <>
          <h4>Quick Pick</h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {shelves.map((s) => (
              <button
                key={s.id}
                onClick={() => run(s.id)}
                disabled={mode === "navigating" || !s.cameraPosition}
                title={!s.cameraPosition ? "No pose saved" : `Go to ${s.id}`}
              >
                {s.id}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="divider" />
      <button onClick={returnHome} disabled={mode === "navigating"}>
        ← Return Home
      </button>
    </div>
  );
}
