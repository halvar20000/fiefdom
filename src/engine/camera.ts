import * as THREE from 'three';
import {
  ELEVATION, PIXELS_PER_WORLD_UNIT, ZOOM_LEVELS, AZIMUTH_DEG,
  cameraDirectionAz, type RotationIndex,
} from './iso';

/**
 * How far inside the screen edge a map corner can be brought.
 *
 * 1 puts the corner tile exactly on the edge, which is reachable in the strict
 * sense and useless in practice. Below 1 pulls it in far enough to look at,
 * at the cost of showing that much more of what is beyond the map. 0.7 puts a
 * corner roughly two thirds of the way out from the middle of the screen.
 */
const CORNER_REACH = 0.7;

/**
 * Stronghold's camera, set free: orthographic at a fixed 30-degree elevation,
 * but turning to any azimuth and zooming without steps, since the world it
 * looks at is real geometry now.
 *
 * The four rotations and four zoom levels are still here as the resting
 * places the keys step between, and `rotation` still answers with the
 * nearest quadrant, because the unit sprites only exist from those four
 * angles and everything that picks a sprite frame asks for it. What is drawn
 * as a mesh uses the exact angle; what is drawn as a sprite gets the nearest
 * of four, which at worst is 45 degrees off for a billboard the size of a
 * thumb.
 *
 * Both angle and zoom glide: a key press sets a target and `update` moves
 * toward it each frame, so R and E turn the world rather than cut to it.
 */
export class IsoCamera {
  readonly camera: THREE.OrthographicCamera;

  /** The exact azimuth in degrees; 45 is the classic view. */
  azimuthDeg = AZIMUTH_DEG;
  /** Zoom as a multiple of PIXELS_PER_WORLD_UNIT, continuous. */
  zoom: number = ZOOM_LEVELS[0];

  private targetAz = AZIMUTH_DEG;
  private targetZoom: number = ZOOM_LEVELS[0];

  /** Point on the ground the view is centred on. */
  target = new THREE.Vector3(0, 0, 0);

  private viewW = 1;
  private viewH = 1;
  private bounds = { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity };

  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 4000);
    this.apply();
  }

  /** The nearest of the four sprite rotations, for anything that picks a frame. */
  get rotation(): RotationIndex {
    const q = Math.round((this.azimuthDeg - AZIMUTH_DEG) / 90);
    return (((q % 4) + 4) % 4) as RotationIndex;
  }

  /** Quarter turns from the classic view, fractional -- the minimap turns by it. */
  get turns(): number {
    return (this.azimuthDeg - AZIMUTH_DEG) / 90;
  }

  get azimuth(): number {
    return (this.azimuthDeg * Math.PI) / 180;
  }

  /** The nearest of the stepped zoom levels. */
  get zoomIndex(): number {
    let best = 0;
    for (let i = 1; i < ZOOM_LEVELS.length; i++) {
      if (Math.abs(ZOOM_LEVELS[i] - this.targetZoom) < Math.abs(ZOOM_LEVELS[best] - this.targetZoom)) best = i;
    }
    return best;
  }

  get pixelsPerUnit(): number {
    return PIXELS_PER_WORLD_UNIT * this.zoom;
  }

  get viewWidth(): number { return this.viewW; }
  get viewHeight(): number { return this.viewH; }

  /**
   * Glide toward the targets. Called once a frame with the frame time; a
   * frame of 0 (or none, ever) leaves the camera exactly where the last call
   * put it, which is what headless tests rely on.
   */
  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 12);
    let moved = false;
    if (this.azimuthDeg !== this.targetAz) {
      const d = this.targetAz - this.azimuthDeg;
      this.azimuthDeg = Math.abs(d) < 0.01 ? this.targetAz : this.azimuthDeg + d * k;
      moved = true;
    }
    if (this.zoom !== this.targetZoom) {
      const d = this.targetZoom - this.zoom;
      this.zoom = Math.abs(d) < 0.001 ? this.targetZoom : this.zoom + d * k;
      moved = true;
    }
    if (moved) { this.clampTarget(); this.apply(); }
  }

  /** Jump to the targets without gliding -- a loaded save, a test. */
  settle(): void {
    this.azimuthDeg = this.targetAz;
    this.zoom = this.targetZoom;
    this.clampTarget();
    this.apply();
  }

  setViewport(width: number, height: number): void {
    this.viewW = Math.max(1, width);
    this.viewH = Math.max(1, height);
    this.clampTarget();
    this.apply();
  }

  /** Limit where the view may be pushed. See clampTarget for the rule. */
  setBounds(minX: number, maxX: number, minZ: number, maxZ: number): void {
    this.bounds = { minX, maxX, minZ, maxZ };
    this.clampTarget();
  }

  /** Turn by quarter turns, to the next resting angle. */
  rotateBy(steps: number): void {
    // from the nearest quadrant, so a half-dragged view snaps on as a key
    // press would expect, not 90 degrees further than the eye reads it
    const q = Math.round((this.targetAz - AZIMUTH_DEG) / 90);
    this.targetAz = AZIMUTH_DEG + (q + steps) * 90;
    this.normaliseAz();
  }

  /** Turn by any angle -- a drag, a two-finger twist. */
  rotateByDeg(deg: number): void {
    this.targetAz += deg;
    this.azimuthDeg += deg;
    this.normaliseAz();
    this.clampTarget();
    this.apply();
  }

  private normaliseAz(): void {
    // keep both in one lap of each other so the glide takes the short way
    while (this.targetAz - this.azimuthDeg > 180) this.azimuthDeg += 360;
    while (this.targetAz - this.azimuthDeg < -180) this.azimuthDeg -= 360;
    if (this.targetAz > 720 || this.targetAz < -720) {
      const lap = Math.floor(this.targetAz / 360) * 360;
      this.targetAz -= lap; this.azimuthDeg -= lap;
    }
  }

  /** Zoom by steps of the level table. */
  zoomBy(steps: number): void {
    const i = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, this.zoomIndex + steps));
    this.targetZoom = ZOOM_LEVELS[i];
  }

  /** Zoom by a factor -- a wheel notch, a pinch -- within the table's range. */
  zoomByFactor(f: number): void {
    const lo = ZOOM_LEVELS[0], hi = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
    this.targetZoom = Math.min(hi, Math.max(lo, this.targetZoom * f));
  }

  /**
   * Pan by a screen-pixel delta, converted into world movement along the
   * current view's ground axes. Dragging right must move the map right no
   * matter which of the four rotations we are in.
   */
  panByPixels(dxPx: number, dyPx: number): void {
    const ppu = this.pixelsPerUnit;
    const az = this.azimuth;

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

  /**
   * Keep the view on the map -- but never so strictly that part of the map
   * cannot be looked at.
   *
   * The rule used to be "the whole view stays inside the map", which sounds
   * right and quietly made the four corners of every map impossible to see at
   * any zoom. The geometry, once written down, is not subtle:
   *
   * The camera looks along a 45-degree diagonal (ROTATIONS), so the square map
   * is drawn as a diamond and the screen rectangle lands on the ground as a
   * parallelogram turned 45 degrees to the world axes. Containing that
   * parallelogram inside the map square constrains its axis-aligned BOUNDING
   * BOX, which at 45 degrees is much bigger than the shape inside it -- and the
   * corners of that bounding box are the one part of it that is not on the
   * shape. To put the map's corner tile on screen, the view's bounding box
   * corner has to sit ON that tile, which the old rule forbade by exactly the
   * amount the box overshoots. So the corner was never reachable: not zoomed
   * in, not zoomed out, not at any rotation. Zoomed out it was simply most
   * obvious, because the unreachable margin scales with the view.
   *
   * What is clamped now is the view's CENTRE, into the map inset by a margin
   * derived from how far the view reaches: far enough in that a normal pan
   * shows no void, and never so far that a corner cannot be brought properly
   * into shot. A corner of the map is a corner of the world, and looking at one
   * means seeing some of what lies beyond it; that is the trade, and it is the
   * right way round.
   *
   * Worked from the four projected screen corners rather than from the zoom and
   * rotation. An analytic reach looked right and left two tiles of void at the
   * top corner, because the target is not the centre of what you can see -- it
   * projects about 32px below it. Projecting the corners cannot disagree with
   * what is actually drawn, whatever that offset turns out to be. One pass is
   * enough and there is no iteration: moving the target translates the whole
   * view by the same vector, so the correction is exact.
   */
  private clampTarget(): void {
    const b = this.bounds;
    if (!Number.isFinite(b.minX)) return;   // unbounded, e.g. before setBounds

    this.apply();                            // screenToGround needs the matrices
    const c = [
      this.screenToGround(0, 0, 0),
      this.screenToGround(this.viewW, 0, 0),
      this.screenToGround(this.viewW, this.viewH, 0),
      this.screenToGround(0, this.viewH, 0),
    ];
    // The middle of what is on screen, which is NOT the target.
    const cx = (c[0].x + c[1].x + c[2].x + c[3].x) / 4;
    const cz = (c[0].z + c[1].z + c[2].z + c[3].z) / 4;

    // How far the view reaches along its own two ground axes -- the directions
    // a drag actually moves it in, which is why the margin is measured here
    // rather than along the world axes.
    const az = this.azimuth;
    const rightX = Math.cos(az), rightZ = -Math.sin(az);
    const upX = Math.sin(az), upZ = Math.cos(az);
    let reachRight = 0, reachUp = 0;
    for (const p of c) {
      const dx = p.x - cx, dz = p.z - cz;
      reachRight = Math.max(reachRight, Math.abs(dx * rightX + dz * rightZ));
      reachUp = Math.max(reachUp, Math.abs(dx * upX + dz * upZ));
    }

    // The inset, and the whole fix in one line.
    //
    // Along the diagonal to a map corner, the view reaches min(right, up) / √2
    // in world-axis terms -- the smaller of the two, because the corner lies
    // where both axes must stretch to meet it. Insetting by exactly that puts
    // the corner tile precisely on the screen edge; CORNER_REACH pulls it in
    // off the edge so it can actually be looked at rather than just touched.
    const inset = CORNER_REACH * Math.min(reachRight, reachUp) / Math.SQRT2;

    // A map smaller than the inset has no legal position: centre it instead.
    const fit = (v: number, lo: number, hi: number) =>
      lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
    const wantX = fit(cx, b.minX + inset, b.maxX - inset);
    const wantZ = fit(cz, b.minZ + inset, b.maxZ - inset);

    this.target.x += wantX - cx;
    this.target.z += wantZ - cz;
    this.apply();
  }

  apply(): void {
    const ppu = this.pixelsPerUnit;
    const halfW = this.viewW / 2 / ppu;
    const halfH = this.viewH / 2 / ppu;

    const cam = this.camera;
    cam.left = -halfW; cam.right = halfW;
    cam.top = halfH; cam.bottom = -halfH;
    cam.near = 0.1; cam.far = 4000;

    const [dx, dy, dz] = cameraDirectionAz(this.azimuth);
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
    const dir = new THREE.Vector3(...cameraDirectionAz(this.azimuth)).negate();
    const t = (height - ndc.y) / dir.y;
    return new THREE.Vector3(ndc.x + dir.x * t, height, ndc.z + dir.z * t);
  }
}
