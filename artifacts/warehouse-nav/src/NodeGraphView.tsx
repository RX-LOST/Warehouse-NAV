import { useEffect, useRef, useState, useCallback } from "react";
import type { PathNode, Vec3 } from "./pathfinding";

interface NodeGraphViewProps {
  nodes: Record<string, PathNode>;
  homeNodeId: string | null;
  onClose: () => void;
  onAddLink: (fromId: string, toId: string) => void;
  onRemoveLink: (fromId: string, toId: string) => void;
  onRemoveNode: (id: string) => void;
  onSetHomeNode: (id: string) => void;
}

type CanvasPos = { cx: number; cy: number };

const NODE_R = 10;
const HOME_COLOR = "#f59e0b";
const NODE_COLOR = "#3b82f6";
const NODE_SEL_COLOR = "#60a5fa";
const LINK_COLOR = "#475569";
const LINK_SEL_COLOR = "#00d4ff";
const GRID_COLOR = "#1e293b";
const BG_COLOR = "#0f1217";
const TEXT_COLOR = "#94a3b8";

export default function NodeGraphView({
  nodes,
  homeNodeId,
  onClose,
  onAddLink,
  onRemoveLink,
  onRemoveNode,
  onSetHomeNode,
}: NodeGraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredLink, setHoveredLink] = useState<[string, string] | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  // Pan & zoom
  const viewRef = useRef({ ox: 0, oy: 0, scale: 40 });
  const draggingViewRef = useRef(false);
  const lastDragRef = useRef({ x: 0, y: 0 });

  // World-to-canvas
  const w2c = useCallback(
    (pos: Vec3): CanvasPos => {
      const v = viewRef.current;
      return {
        cx: pos.x * v.scale + v.ox,
        cy: -pos.z * v.scale + v.oy, // flip Z for top-down view
      };
    },
    [],
  );

  const c2w = useCallback((cx: number, cy: number): Vec3 => {
    const v = viewRef.current;
    return {
      x: (cx - v.ox) / v.scale,
      y: 0,
      z: -(cy - v.oy) / v.scale,
    };
  }, []);

  const nodeList = Object.values(nodes);

  // Auto-fit on first open
  useEffect(() => {
    if (nodeList.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    const xs = nodeList.map((n) => n.position.x);
    const zs = nodeList.map((n) => n.position.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const rangeX = maxX - minX || 10, rangeZ = maxZ - minZ || 10;
    const scale = Math.min(cw / (rangeX + 4), ch / (rangeZ + 4), 80);
    viewRef.current = {
      scale,
      ox: cw / 2 - ((minX + maxX) / 2) * scale,
      oy: ch / 2 + ((minZ + maxZ) / 2) * scale,
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width: cw, height: ch } = canvas;
    const v = viewRef.current;

    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, cw, ch);

    // Grid
    const gridStep = v.scale >= 20 ? 1 : 5;
    const startX = Math.floor(-v.ox / v.scale / gridStep) * gridStep;
    const endX = Math.ceil((cw - v.ox) / v.scale / gridStep) * gridStep;
    const startZ = Math.floor((v.oy - ch) / v.scale / gridStep) * gridStep;
    const endZ = Math.ceil(v.oy / v.scale / gridStep) * gridStep;
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 0.5;
    for (let wx = startX; wx <= endX; wx += gridStep) {
      const cx = wx * v.scale + v.ox;
      ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, ch); ctx.stroke();
    }
    for (let wz = startZ; wz <= endZ; wz += gridStep) {
      const cy = -wz * v.scale + v.oy;
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(cw, cy); ctx.stroke();
    }

    // Draw links
    const drawnLinks = new Set<string>();
    for (const node of nodeList) {
      for (const toId of node.links) {
        const key = [node.id, toId].sort().join("|");
        if (drawnLinks.has(key)) continue;
        drawnLinks.add(key);
        const to = nodes[toId];
        if (!to) continue;
        const a = w2c(node.position), b = w2c(to.position);
        const isHovLink =
          (hoveredLink?.[0] === node.id && hoveredLink?.[1] === toId) ||
          (hoveredLink?.[0] === toId && hoveredLink?.[1] === node.id);
        const isSelLink =
          (selectedNode === node.id || selectedNode === toId) && isHovLink;
        ctx.strokeStyle = isSelLink ? LINK_SEL_COLOR : isHovLink ? "#94a3b8" : LINK_COLOR;
        ctx.lineWidth = isHovLink ? 2 : 1.5;
        ctx.beginPath();
        ctx.moveTo(a.cx, a.cy);
        ctx.lineTo(b.cx, b.cy);
        ctx.stroke();

        // Midpoint × for remove on hover
        if (isHovLink) {
          const mx = (a.cx + b.cx) / 2, my = (a.cy + b.cy) / 2;
          ctx.fillStyle = "#ef4444";
          ctx.beginPath(); ctx.arc(mx, my, 6, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.font = "bold 10px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("×", mx, my);
        }
      }
    }

    // Draw nodes
    for (const node of nodeList) {
      const { cx, cy } = w2c(node.position);
      const isHome = node.id === homeNodeId;
      const isSel = node.id === selectedNode;
      const isHov = node.id === hoveredNode;
      const r = NODE_R + (isSel ? 3 : isHov ? 2 : 0);

      // Glow for selected
      if (isSel) {
        ctx.shadowColor = NODE_SEL_COLOR;
        ctx.shadowBlur = 12;
      }

      ctx.fillStyle = isHome ? HOME_COLOR : isSel ? NODE_SEL_COLOR : NODE_COLOR;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = 0;

      // Link mode indicator
      if (linkMode && isSel) {
        ctx.strokeStyle = "#00ff88";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Label
      ctx.fillStyle = TEXT_COLOR;
      ctx.font = `${Math.max(9, Math.min(12, v.scale / 4))}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(node.id, cx, cy + r + 2);

      // Home badge
      if (isHome) {
        ctx.fillStyle = "#fff";
        ctx.font = "bold 8px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("H", cx, cy);
      }
    }

    // Legend
    ctx.fillStyle = "rgba(15,18,23,0.8)";
    ctx.fillRect(8, ch - 56, 200, 50);
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = "10px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const lines = [
      "Click = select  |  Scroll = zoom",
      linkMode ? "LINK MODE: click target node" : "Drag bg = pan",
    ];
    lines.forEach((l, i) => ctx.fillText(l, 12, ch - 52 + i * 16));
  }, [nodeList, nodes, homeNodeId, selectedNode, hoveredNode, hoveredLink, linkMode, w2c]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    draw();
  }, [draw]);

  // Hit-test
  const hitNode = useCallback(
    (cx: number, cy: number): string | null => {
      for (const node of nodeList) {
        const p = w2c(node.position);
        if (Math.hypot(cx - p.cx, cy - p.cy) <= NODE_R + 4) return node.id;
      }
      return null;
    },
    [nodeList, w2c],
  );

  const hitLink = useCallback(
    (cx: number, cy: number): [string, string] | null => {
      const drawnLinks = new Set<string>();
      for (const node of nodeList) {
        for (const toId of node.links) {
          const key = [node.id, toId].sort().join("|");
          if (drawnLinks.has(key)) continue;
          drawnLinks.add(key);
          const to = nodes[toId];
          if (!to) continue;
          const a = w2c(node.position), b = w2c(to.position);
          const mx = (a.cx + b.cx) / 2, my = (a.cy + b.cy) / 2;
          if (Math.hypot(cx - mx, cy - my) <= 8) return [node.id, toId];
          // Also check along the line segment
          const dx = b.cx - a.cx, dy = b.cy - a.cy;
          const len2 = dx * dx + dy * dy;
          if (len2 === 0) continue;
          const t = Math.max(0, Math.min(1, ((cx - a.cx) * dx + (cy - a.cy) * dy) / len2));
          const px = a.cx + t * dx, py = a.cy + t * dy;
          if (Math.hypot(cx - px, cy - py) <= 5) return [node.id, toId];
        }
      }
      return null;
    },
    [nodeList, nodes, w2c],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      if (draggingViewRef.current) {
        const dx = cx - lastDragRef.current.x, dy = cy - lastDragRef.current.y;
        viewRef.current.ox += dx;
        viewRef.current.oy += dy;
        lastDragRef.current = { x: cx, y: cy };
        draw();
        return;
      }
      const hn = hitNode(cx, cy);
      setHoveredNode(hn);
      const hl = hn ? null : hitLink(cx, cy);
      setHoveredLink(hl);
    },
    [hitNode, hitLink, draw],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      const hn = hitNode(cx, cy);
      if (hn) {
        if (linkMode && selectedNode && selectedNode !== hn) {
          // Check if link exists
          const existing = nodes[selectedNode]?.links.includes(hn);
          if (!existing) {
            onAddLink(selectedNode, hn);
          }
          setLinkMode(false);
          setSelectedNode(hn);
        } else {
          setSelectedNode(hn === selectedNode ? null : hn);
        }
        return;
      }
      const hl = hitLink(cx, cy);
      if (hl) {
        onRemoveLink(hl[0], hl[1]);
        setHoveredLink(null);
        return;
      }
      // Drag background
      draggingViewRef.current = true;
      lastDragRef.current = { x: cx, y: cy };
      setSelectedNode(null);
    },
    [hitNode, hitLink, linkMode, selectedNode, nodes, onAddLink, onRemoveLink],
  );

  const handleMouseUp = useCallback(() => {
    draggingViewRef.current = false;
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      const v = viewRef.current;
      const factor = e.deltaY < 0 ? 1.12 : 0.88;
      const newScale = Math.max(5, Math.min(200, v.scale * factor));
      v.ox = cx - (cx - v.ox) * (newScale / v.scale);
      v.oy = cy - (cy - v.oy) * (newScale / v.scale);
      v.scale = newScale;
      draw();
    },
    [draw],
  );

  const selNode = selectedNode ? nodes[selectedNode] : null;

  return (
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
    >
      <div
        style={{
          width: "min(900px, 94vw)",
          height: "min(620px, 90vh)",
          background: "#0f1217",
          border: "1px solid #2a3038",
          borderRadius: 8,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            borderBottom: "1px solid #1e293b",
            background: "#141820",
            flexShrink: 0,
          }}
        >
          <span style={{ color: "#e6e8eb", fontWeight: 700, fontSize: 13 }}>
            Path Node Graph — Top-Down View
          </span>
          <span style={{ color: "#64748b", fontSize: 11, flex: 1 }}>
            scroll = zoom · drag bg = pan · click node = select · click link midpoint = remove
          </span>
          {selNode && (
            <span
              style={{
                background: "#1e293b",
                border: "1px solid #334155",
                borderRadius: 4,
                padding: "2px 8px",
                fontSize: 11,
                color: "#94a3b8",
              }}
            >
              Selected: <strong style={{ color: "#e2e8f0" }}>{selNode.id}</strong>{" "}
              ({selNode.links.length} links)
            </span>
          )}
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid #374151",
              color: "#9ca3af",
              padding: "3px 10px",
              borderRadius: 4,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Close ✕
          </button>
        </div>

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Canvas */}
          <canvas
            ref={canvasRef}
            style={{ flex: 1, cursor: linkMode ? "crosshair" : "default" }}
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
          />

          {/* Sidebar */}
          <div
            style={{
              width: 200,
              borderLeft: "1px solid #1e293b",
              background: "#141820",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: 10,
              fontSize: 12,
              flexShrink: 0,
              overflowY: "auto",
            }}
          >
            {selNode ? (
              <>
                <div style={{ color: "#e2e8f0", fontWeight: 700, marginBottom: 4 }}>
                  Node: {selNode.id}
                </div>
                <div style={{ color: "#64748b", fontSize: 10 }}>
                  X:{selNode.position.x.toFixed(2)} Y:{selNode.position.y.toFixed(2)}{" "}
                  Z:{selNode.position.z.toFixed(2)}
                </div>
                <div style={{ color: "#64748b", fontSize: 10, marginBottom: 4 }}>
                  Links: {selNode.links.join(", ") || "—"}
                </div>

                <button
                  onClick={() => {
                    setLinkMode((v) => !v);
                  }}
                  style={{
                    background: linkMode ? "#064e3b" : "#1e293b",
                    border: `1px solid ${linkMode ? "#10b981" : "#334155"}`,
                    color: linkMode ? "#34d399" : "#94a3b8",
                    padding: "5px 8px",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {linkMode ? "◉ Linking — click target" : "Link to Node"}
                </button>

                {selNode.id !== homeNodeId && (
                  <button
                    onClick={() => onSetHomeNode(selNode.id)}
                    style={{
                      background: "#1e293b",
                      border: "1px solid #334155",
                      color: "#f59e0b",
                      padding: "5px 8px",
                      borderRadius: 4,
                      cursor: "pointer",
                      fontSize: 11,
                    }}
                  >
                    Set as Home Node
                  </button>
                )}

                {selNode.links.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <div style={{ color: "#64748b", fontSize: 10, marginBottom: 4 }}>
                      Links (click to remove):
                    </div>
                    {selNode.links.map((lid) => (
                      <div
                        key={lid}
                        onClick={() => onRemoveLink(selNode.id, lid)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "3px 6px",
                          borderRadius: 3,
                          cursor: "pointer",
                          color: "#94a3b8",
                          fontSize: 11,
                          background: "#1a2030",
                          marginBottom: 2,
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#2d1a1a")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "#1a2030")}
                      >
                        <span style={{ color: "#ef4444" }}>✕</span>
                        {lid}
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => {
                    onRemoveNode(selNode.id);
                    setSelectedNode(null);
                  }}
                  style={{
                    background: "#2d1414",
                    border: "1px solid #7f1d1d",
                    color: "#ef4444",
                    padding: "5px 8px",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontSize: 11,
                    marginTop: "auto",
                  }}
                >
                  Delete Node
                </button>
              </>
            ) : (
              <div style={{ color: "#475569", fontSize: 11, textAlign: "center", marginTop: 20 }}>
                Click a node to select it
              </div>
            )}

            {/* Node list */}
            {nodeList.length > 0 && (
              <div style={{ marginTop: 8, borderTop: "1px solid #1e293b", paddingTop: 8 }}>
                <div style={{ color: "#475569", fontSize: 10, marginBottom: 4 }}>
                  All nodes ({nodeList.length}):
                </div>
                {nodeList.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => setSelectedNode(n.id === selectedNode ? null : n.id)}
                    style={{
                      padding: "3px 6px",
                      borderRadius: 3,
                      cursor: "pointer",
                      fontSize: 10,
                      background: n.id === selectedNode ? "#1e3a5f" : "transparent",
                      color: n.id === homeNodeId ? HOME_COLOR : "#94a3b8",
                      marginBottom: 1,
                    }}
                  >
                    {n.id === homeNodeId ? "⌂ " : ""}{n.id}{" "}
                    <span style={{ color: "#475569" }}>({n.links.length})</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
