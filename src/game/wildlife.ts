/**
 * Wild animals on the landscape, and the quarry a hunter's hut works.
 *
 * Animals are deliberately NOT decorations. Decorations are static and live in
 * the pre-sorted scenery list; anything that moves has to join the per-frame
 * figure stream with the workers, or it would be depth-sorted once and then
 * walk straight through everything it was sorted behind.
 */

/** Seconds before a hunted animal is replaced by another of the herd. */
export const RESPAWN_SECONDS = 110;

/** How far an animal strays from where its herd was seeded. */
export const HOME_RADIUS = 4.5;

/** Tiles a hunter will walk to reach its quarry. */
export const HUNT_RADIUS = 30;

const SPEED = 0.55;

export interface Animal {
  id: number;
  x: number;
  z: number;
  heading: number;
  phase: number;
  alive: boolean;
  respawnAt: number;
  /** Herd centre. Animals graze around it rather than roaming the whole map. */
  hx: number;
  hz: number;
  /** Worker id that has marked this one, or null. */
  claimedBy: number | null;
  moving: boolean;
  timer: number;
  tx: number;
  tz: number;
}

export interface HerdWorld {
  blocked(x: number, z: number): boolean;
  lineClear(x1: number, z1: number, x2: number, z2: number): boolean;
  inBounds(x: number, z: number): boolean;
}

export class Herd {
  animals: Animal[] = [];
  private nextId = 1;

  constructor(private world: HerdWorld) {}

  add(x: number, z: number): Animal {
    const a: Animal = {
      id: this.nextId++, x, z, heading: Math.random() * Math.PI * 2, phase: Math.random() * 3,
      alive: true, respawnAt: 0, hx: x, hz: z, claimedBy: null,
      moving: false, timer: 1 + Math.random() * 6, tx: x, tz: z,
    };
    this.animals.push(a);
    return a;
  }

  /** Nearest live, unclaimed animal to a point, or null. */
  nearestFree(x: number, z: number, radius: number): Animal | null {
    let best: Animal | null = null;
    let bestD = radius * radius;
    for (const a of this.animals) {
      if (!a.alive || a.claimedBy !== null) continue;
      const d = (a.x - x) ** 2 + (a.z - z) ** 2;
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }

  byId(id: number): Animal | null {
    return this.animals.find(a => a.id === id) ?? null;
  }

  release(workerId: number): void {
    for (const a of this.animals) if (a.claimedBy === workerId) a.claimedBy = null;
  }

  /** Take a marked animal. Returns false if it was already gone. */
  take(id: number, now: number): boolean {
    const a = this.byId(id);
    if (!a || !a.alive) return false;
    a.alive = false;
    a.claimedBy = null;
    a.respawnAt = now + RESPAWN_SECONDS;
    return true;
  }

  update(dt: number, now: number): void {
    for (const a of this.animals) {
      if (!a.alive) {
        if (now < a.respawnAt) continue;
        const spot = this.openSpotNearHome(a);
        if (!spot) { a.respawnAt = now + 8; continue; }
        a.x = spot.x; a.z = spot.z;
        a.alive = true;
        a.moving = false;
        a.timer = 2 + Math.random() * 6;
        continue;
      }

      // A marked animal stands still and goes on grazing. It has not noticed
      // the hunter -- which is also what lets the hut reuse the ordinary
      // walk-to-a-fixed-spot machinery instead of needing a chase.
      if (a.claimedBy !== null) { a.moving = false; continue; }

      a.phase += dt;

      if (!a.moving) {
        a.timer -= dt;
        if (a.timer > 0) continue;
        const target = this.openSpotNearHome(a);
        if (!target || !this.world.lineClear(a.x, a.z, target.x, target.z)) {
          a.timer = 1 + Math.random() * 3;
          continue;
        }
        a.tx = target.x; a.tz = target.z;
        a.moving = true;
        a.heading = Math.atan2(a.tz - a.z, a.tx - a.x);
        continue;
      }

      const dx = a.tx - a.x, dz = a.tz - a.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.08) {
        a.moving = false;
        a.timer = 3 + Math.random() * 7;
        continue;
      }
      a.heading = Math.atan2(dz, dx);
      const step = Math.min(d, SPEED * dt);
      a.x += (dx / d) * step;
      a.z += (dz / d) * step;
    }
  }

  private openSpotNearHome(a: Animal): { x: number; z: number } | null {
    for (let i = 0; i < 8; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * HOME_RADIUS;
      const x = a.hx + Math.cos(ang) * r;
      const z = a.hz + Math.sin(ang) * r;
      if (!this.world.inBounds(x, z)) continue;
      if (this.world.blocked(x, z)) continue;
      return { x, z };
    }
    return null;
  }
}
