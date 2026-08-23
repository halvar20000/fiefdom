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
    this.clampTarget();
    this.apply();
  }

  /** Keep the whole VIEW inside the map, not merely its centre. */
  setBounds(minX: number, maxX: number, minZ: number, maxZ: number): void {
    this.bounds = { minX, maxX, minZ, maxZ };
    this.clampTarget();
  }

  rotateBy(steps: number): void {
    this.rotation = (((this.rotation + steps) % 4) + 4) % 4 as RotationIndex;
    // Rotating changes the view's footprint on the ground, so a target that
    // was legal a moment ago may now hang the edge of the map into shot.
    this.clampTarget();
    this.apply();
  }

  zoomBy(steps: number): void {
    this.zoomIndex = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, this.zoomIndex + steps));
    this.clampTarget();
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

  /** Ground-space bounding box of what is currently on screen. */
  private viewBox(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    const c = [
      this.screenToGround(0, 0, 0),
      this.screenToGround(this.viewW, 0, 0),
      this.screenToGround(this.viewW, this.viewH, 0),
      this.screenToGround(0, this.viewH, 0),
    ];
    return {
      minX: Math.min(...c.map(p => p.x)), maxX: Math.max(...c.map(p => p.x)),
      minZ: Math.min(...c.map(p => p.z)), maxZ: Math.max(...c.map(p => p.z)),
    };
  }

  /**
   * Keep the whole view on the map, not merely its centre.
   *
   * Measured from the four screen corners rather than worked out from the zoom
   * and rotation. An analytic reach looked right and left two tiles of void at
   * the top corner, because the target is not exactly the centre of what you
   * can see -- it projects 32px below it. Projecting the corners cannot
   * disagree with what is actually drawn, whatever that offset turns out to be.
   *
   * The correction is a single pass because moving the target translates the
   * whole view by the same amount: the second pass only confirms.
   */
  private clampTarget(): void {
    const b = this.bounds;
    if (!Number.isFinite(b.minX)) return;   // unbounded, e.g. before setBounds

    for (let pass = 0; pass < 2; pass++) {
      this.apply();                          // viewBox needs current matrices
      const v = this.viewBox();
      // Wider than the map: no legal position exists, so centre it and stop.
      const dx = (v.maxX - v.minX) >= (b.maxX - b.minX)
        ? (b.minX + b.maxX) / 2 - (v.minX + v.maxX) / 2
        : v.minX < b.minX ? b.minX - v.minX
        : v.maxX > b.maxX ? b.maxX - v.maxX : 0;
      const dz = (v.maxZ - v.minZ) >= (b.maxZ - b.minZ)
        ? (b.minZ + b.maxZ) / 2 - (v.minZ + v.maxZ) / 2
        : v.minZ < b.minZ ? b.minZ - v.minZ
        : v.maxZ > b.maxZ ? b.maxZ - v.maxZ : 0;
      if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) break;
      this.target.x += dx;
      this.target.z += dz;
    }
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
