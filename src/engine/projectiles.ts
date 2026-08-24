import * as THREE from 'three';

/**
 * Arrows and bolts in flight.
 *
 * Drawn as short camera-facing ribbons -- a quad stretched from the tail to
 * the head of each shot -- rather than sprites or lines. Two reasons a ribbon
 * wins here. An arrow must point along its own flight, and a quad between two
 * points aims itself at every angle for free where our eight fixed sprite
 * facings could not. And a GL line is always one physical pixel wide, which on
 * a 2x backbuffer is invisible once the frame is scaled down; a quad has real
 * world width and survives.
 *
 * The ribbon is made camera-facing by offsetting its two long edges along
 * `cross(flightDirection, viewDirection)`. That vector is perpendicular to the
 * flight in the plane of the screen, so the ribbon keeps a constant apparent
 * width whatever the shot's angle or the camera's rotation.
 *
 * One triangle mesh holds every live shot; the buffers are allocated once and
 * only the used prefix is drawn, so a volley costs no allocation and one draw
 * call. The arc is faked -- a real ballistic solve is invisible at this size --
 * as a lift toward the midpoint that drops to the target.
 */

export type ProjectileKind = 'arrow' | 'bolt';

interface Shot {
  x0: number; z0: number; y0: number;
  x1: number; z1: number; y1: number;
  t: number;
  speed: number;
  kind: ProjectileKind;
}

const MAX = 512;
const COLOUR: Record<ProjectileKind, [number, number, number]> = {
  arrow: [0.95, 0.90, 0.72],
  bolt: [1.0, 0.55, 0.14],
};
/** Streak length and half-width, in world units. */
const LEN: Record<ProjectileKind, number> = { arrow: 0.55, bolt: 0.75 };
const HALF: Record<ProjectileKind, number> = { arrow: 0.07, bolt: 0.11 };

export class Projectiles {
  readonly mesh: THREE.Mesh;
  private shots: Shot[] = [];
  private positions: Float32Array;
  private colours: Float32Array;
  private geom: THREE.BufferGeometry;
  /** Camera forward, set each frame before render(). */
  private view = new THREE.Vector3(0, -1, 0);

  constructor() {
    // Four vertices and two triangles per shot.
    this.positions = new Float32Array(MAX * 4 * 3);
    this.colours = new Float32Array(MAX * 4 * 3);
    const index: number[] = [];
    for (let i = 0; i < MAX; i++) {
      const b = i * 4;
      index.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geom.setAttribute('color', new THREE.BufferAttribute(this.colours, 3));
    this.geom.setIndex(index);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true,
      // In front of the men: an arrow is a thing in the air, not on the
      // ground, and depth-testing it against blended sprites (which write no
      // depth) would hide it behind them at random.
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geom, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
  }

  fire(kind: ProjectileKind,
       x0: number, y0: number, z0: number,
       x1: number, y1: number, z1: number): void {
    if (this.shots.length >= MAX) return;
    const dist = Math.hypot(x1 - x0, z1 - z0);
    const base = kind === 'bolt' ? 14 : 10;
    this.shots.push({
      x0, z0, y0: y0 + 0.9, x1, z1, y1: y1 + 0.7,
      t: 0, speed: base / Math.max(1, dist), kind,
    });
  }

  update(dt: number): void {
    for (const s of this.shots) s.t += s.speed * dt;
    this.shots = this.shots.filter(s => s.t < 1);
  }

  /** The camera's forward direction, so ribbons can face it. */
  setView(x: number, y: number, z: number): void {
    this.view.set(x, y, z).normalize();
  }

  render(): void {
    const p = this.positions, c = this.colours;
    const V = this.view;
    let n = 0;
    for (const s of this.shots) {
      const t = s.t;
      const dxz = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
      const peak = Math.min(1.4, 0.25 + dxz * 0.12);
      const lift = Math.sin(t * Math.PI) * peak;
      const x = s.x0 + (s.x1 - s.x0) * t;
      const z = s.z0 + (s.z1 - s.z0) * t;
      const y = s.y0 + (s.y1 - s.y0) * t + lift;

      // Heading, arc included, so the streak tips down as the shot falls.
      let hx = s.x1 - s.x0;
      let hy = (s.y1 - s.y0) + Math.cos(t * Math.PI) * Math.PI * peak;
      let hz = s.z1 - s.z0;
      const hl = Math.hypot(hx, hy, hz) || 1;
      hx /= hl; hy /= hl; hz /= hl;

      // side = normalise(heading x view): perpendicular to flight and to the
      // line of sight, i.e. across the screen. Falls back to world X if the
      // shot flies straight at the camera and the cross degenerates.
      let sx = hy * V.z - hz * V.y;
      let sy = hz * V.x - hx * V.z;
      let sz = hx * V.y - hy * V.x;
      let sl = Math.hypot(sx, sy, sz);
      if (sl < 1e-4) { sx = 1; sy = 0; sz = 0; sl = 1; }
      const hw = HALF[s.kind];
      sx = sx / sl * hw; sy = sy / sl * hw; sz = sz / sl * hw;

      const len = LEN[s.kind];
      const tx = x - hx * len, ty = y - hy * len, tz = z - hz * len;

      const [r, g, b] = COLOUR[s.kind];
      const v = n * 12;
      // head+side, head-side, tail-side, tail+side
      p[v] = x + sx; p[v + 1] = y + sy; p[v + 2] = z + sz;
      p[v + 3] = x - sx; p[v + 4] = y - sy; p[v + 5] = z - sz;
      p[v + 6] = tx - sx; p[v + 7] = ty - sy; p[v + 8] = tz - sz;
      p[v + 9] = tx + sx; p[v + 10] = ty + sy; p[v + 11] = tz + sz;
      // head bright, tail faded -- reads as motion, not a floating stick
      for (let k = 0; k < 2; k++) {
        c[v + k * 3] = r; c[v + k * 3 + 1] = g; c[v + k * 3 + 2] = b;
      }
      for (let k = 2; k < 4; k++) {
        c[v + k * 3] = r * 0.35; c[v + k * 3 + 1] = g * 0.35; c[v + k * 3 + 2] = b * 0.35;
      }
      n++;
      if (n >= MAX) break;
    }
    this.geom.setDrawRange(0, n * 6);
    (this.geom.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  get count(): number { return this.shots.length; }
}
