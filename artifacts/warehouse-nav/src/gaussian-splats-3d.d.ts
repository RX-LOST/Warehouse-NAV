declare module "@mkkellogg/gaussian-splats-3d" {
  import * as THREE from "three";

  interface ViewerOptions {
    renderer?: THREE.WebGLRenderer;
    camera?: THREE.PerspectiveCamera;
    threeScene?: THREE.Scene;
    selfDrivenMode?: boolean;
    useBuiltInControls?: boolean;
    [key: string]: unknown;
  }

  interface AddSplatSceneOptions {
    showLoadingUI?: boolean;
    [key: string]: unknown;
  }

  class Viewer {
    constructor(options: ViewerOptions);
    addSplatScene(path: string, options?: AddSplatSceneOptions): Promise<void>;
    update(): void;
    dispose(): void;
  }
}
