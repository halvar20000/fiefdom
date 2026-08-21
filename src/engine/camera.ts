import * as THREE from 'three';
import {
  ELEVATION, PIXELS_PER_WORLD_UNIT, ZOOM_LEVELS, ROTATIONS,
  cameraDirection, type RotationIndex,
} from './iso';

/**
 * Stronghold's camera: orthographic, four fixed 90-degree rotations, a couple of
 * zoom steps, pan by dragging or shoving the pointer at a screen edge.
 * No free rotation -- the sprites only exist from four angles.
 */
export class IsoCamera {
  readonly camera: THREE.OrthographicCamera;
  rotation: RotationIndex = 0;
  zoomIndex = 0;

  /** Point on the ground the view is centred on. */
  target = new THREE.Vector3(0, 0, 0);

  private viewW = 1;
  private viewH = 1;
  private bounds = { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity };

  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 4000);
    this.apply();
  }

  get pixelsPerUnit(): number {
    return PIXELS_PER_WORLD_UNIT * ZOOM_LEVELS[this.zoomIndex];
  }

  setViewport(width: number, height: number): void {
    this.viewW = Math.max(1, width);
    this.viewH = Math.max(1, height);
    this.apply();
  }

  /** Keep the centre inside the map so you cannot pan off into the void. */
  setBounds(minX: number, maxX: number, minZ: number, maxZ: number): void {
    this.bounds = { minX, maxX, minZ, maxZ };
    this.clampTarget();
  }

  rotateBy(steps: number): void {
    this.rotation = (((this.rotation + steps) % 4) + 4) % 4 as RotationIndex;
    this.apply();
  }

  zoomBy(steps: number): void {
    this.zoomIndex = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, this.zoomIndex + steps));
    this.apply();
  }

  /**
   * Pan by a screen-pixel delta, converted into world movement along the
   * current view's ground axes. Dragging right must move the map right no
   * matter which of the four rotations we are in.
   */
  panByPixels(dxPx: number, dyPx: number): void {
    const ppu = this.pixelsPerUnit;
    const az = (ROTATIONS[this.rotation] * Math.PI) / 180;

    // ground-plane basis of the current view
    const rightX = Math.cos(az), rightZ = -Math.sin(az);
    const upX = Math.sin(az), upZ = Math.cos(az);

    // vertical screen movement is foreshortened by the camera elevation
    const dWorldRight = dxPx / ppu;
    const dWorldUp = dyPx / (ppu * Math.sin(ELEVATION));

    this.target.x += rightX * dWorldRight + upX * dWorldUp;
    this.target.z += rightZ * dWorldRight + upZ * dWorldUp;
    this.clampTarget();
    this.apply();
  }

  private clampTarget(): void {
    const b = this.bounds;
    this.target.x = Math.min(b.maxX, Math.max(b.minX, this.target.x));
    this.target.z = Math.min(b.maxZ, Math.max(b.minZ, this.target.z));
  }

  apply(): void {
    const ppu = this.pixelsPerUnit;
    const halfW = this.viewW / 2 / ppu;
    const halfH = this.viewH / 2 / ppu;

    const cam = this.camera;
    cam.left = -halfW; cam.right = halfW;
    cam.top = halfH; cam.bottom = -halfH;
    cam.near = 0.1; cam.far = 4000;

    const [dx, dy, dz] = cameraDirection(this.rotation);
    const dist = 1200;
    cam.position.set(
      this.target.x + dx * dist,
      this.target.y + dy * dist,
      this.target.z + dz * dist,
    );
    cam.up.set(0, 1, 0);
    cam.lookAt(this.target);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  /**
   * Screen pixel for a world point -- the inverse of screenToGround.
   *
   * Needed for box selection. A rectangle dragged on SCREEN is a rotated
   * diamond in world space, so testing a world-space axis-aligned box built
   * from its two corners selects the wrong region entirely (usually nothing).
   * Project each unit instead and test in the space the player actually drew in.
   */
  worldToScreen(x: number, y: number, z: number): [number, number] {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return [(v.x * 0.5 + 0.5) * this.viewW, (-v.y * 0.5 + 0.5) * this.viewH];
  }

  /** Ground point under a screen pixel, assuming flat ground at y = height. */
  screenToGround(px: number, py: number, height = 0): THREE.Vector3 {
    const ndc = new THREE.Vector3(
      (px / this.viewW) * 2 - 1,
      -(py / this.viewH) * 2 + 1,
      -1,
    );
    ndc.unproject(this.camera);
    const dir = new THREE.Vector3(...cameraDirection(this.rotation)).negate();
    const t = (height - ndc.y) / dir.y;
    return new THREE.Vector3(ndc.x + dir.x * t, height, ndc.z + dir.z * t);
  }
}
