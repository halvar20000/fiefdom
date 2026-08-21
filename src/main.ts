import * as THREE from 'three';
import { IsoCamera } from './engine/camera';
import { Terrain } from './engine/terrain';
import { SpriteBatch } from './engine/sprites';
import { loadTileArray, buildCombinedAtlas, type CombinedAtlas } from './engine/assets';
import {
  generateMap, findSite, isBuildable, findStartSite, GROUND_TYPES,
} from './game/worldgen';
import {
  TILE_PX_W, unitDirectionIndex, footprintDepthBias, depthKey, spriteAnchor,
} from './engine/iso';
import { GameState, type PlacedBuilding } from './game/state';
import { PathGrid } from './game/pathfind';
import { Herd, HUNT_RADIUS } from './game/wildlife';
import { Army } from './game/army';
import { Lord } from './game/lord';
import { WorkerPool, type WorkerWorld } from './game/workers';
import { Placement, type PlacementWorld } from './game/placement';
import { Hud } from './ui/hud';
import {
  BUILDINGS, STORE_SPRITES, SOLDIER_TYPES, buildingHp, canGarrison,
  GARRISON_HEIGHT, MARSH_SPEED_FOOT, MARSH_SPEED_SIEGE, type Store,
} from './game/defs';

/** Both stores, for the loops that must treat them identically. */
const STORE_KINDS: readonly Store[] = ['stockpile', 'granary'];

const MAP_W = 200;
const MAP_H = 200;
const WALK_FPS = 10;
const DIRECTION_OFFSET = 2;
// How many idle peasants are drawn at the fire. Beyond this the crowd stops
// growing visually, though the Unemployed figure keeps counting.
const IDLE_WANDERERS = 48;
/** Minimum gap between two people standing at the fire, in tiles. */
const GATHER_SPACING = 0.85;

interface Decoration {
  name: string;
  x: number;
  z: number;
  /** Felled trees stay in the list so they can grow back in place. */
  alive: boolean;
  regrowAt: number;
  claimedBy: number | null;
}

/** Seconds before a felled tree grows back, if nothing was built on the spot. */
const TREE_REGROW_SECONDS = 150;
/** How far a woodcutter will walk for a tree before giving up. */
const TREE_SEARCH_RADIUS = 25;

interface Wanderer {
  x: number; z: number; tx: number; tz: number;
  heading: number; speed: number; phase: number;
  moving: boolean; pause: number;
  path: { x: number; z: number }[];
  /** Index of this peasant's standing place around the fire. */
  slot: number;
  /** True once stood at the fire; cleared when they take a stroll. */
  atPost: boolean;
  /** Seconds until they consider wandering off for a moment. */
  restless: number;
}

function hash2(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

async function main() {
  const app = document.getElementById('app')!;
  const legacyHud = document.getElementById('hud')!;
  const loading = document.getElementById('loading')!;
  legacyHud.remove();

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x0d0c0a, 1);
  app.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const iso = new IsoCamera();
  const flags = new URLSearchParams(location.search);

  const [tiles, atlas] = await Promise.all([
    loadTileArray('/assets/tiles'),
    buildCombinedAtlas('/assets/sprites'),
  ]) as [Awaited<ReturnType<typeof loadTileArray>>, CombinedAtlas];

  const terrain = new Terrain({ width: MAP_W, height: MAP_H, layers: 20 }, tiles.texture);
  scene.add(terrain.mesh);
  const { flatTiles, groundType } = generateMap(terrain, tiles.layerOf, 20260818);

  // ONE batch for the whole scene. Everything is drawn in a single
  // back-to-front stream so people, buildings and trees interleave correctly.
  const sprites = new SpriteBatch(atlas.texture, 40000);
  const ghostBatch = new SpriteBatch(atlas.texture, 4);
  ghostBatch.mesh.renderOrder = 11;
  scene.add(sprites.mesh);
  scene.add(ghostBatch.mesh);

  // --- occupancy ----------------------------------------------------------
  // Two grids on purpose. `occupied` decides where you may BUILD and counts
  // trees and rocks; `paths.blocked` decides where units may WALK and counts
  // only buildings. Making scatter block movement as well turns a palm grove
  // into a maze and sends woodcutters on long detours around the very tree
  // they are walking to.
  const occupied = new Uint8Array(MAP_W * MAP_H);
  const paths = new PathGrid(MAP_W, MAP_H);

  const markArea = (x: number, z: number, w: number, d: number, v = 1) => {
    for (let dz = 0; dz < d; dz++)
      for (let dx = 0; dx < w; dx++) {
        const tx = x + dx, tz = z + dz;
        if (tx >= 0 && tz >= 0 && tx < MAP_W && tz < MAP_H) occupied[tz * MAP_W + tx] = v;
      }
  };

  /** Mark a building's footprint as impassable. */
  const markSolid = (x: number, z: number, w: number, d: number, v = true) => {
    paths.fill(x, z, w, d, v);
  };

  /** Does this building have at least one usable door in `region`? */
  function hasAccess(bx: number, bz: number, bw: number, bd: number,
                     region: number): boolean {
    for (let z = bz - 1; z <= bz + bd; z++) {
      for (let x = bx - 1; x <= bx + bw; x++) {
        const onRing = x === bx - 1 || x === bx + bw || z === bz - 1 || z === bz + bd;
        if (!onRing) continue;
        if (paths.regionAt(x, z) === region) return true;
      }
    }
    return false;
  }

  /**
   * Would putting a building here wall something off?
   *
   * Buildings placed shoulder to shoulder can seal a courtyard, and anything
   * inside -- a worker, another building's only door -- is then cut off for
   * good. Checked on commit rather than on hover: it needs a full connectivity
   * rebuild, which is far too costly to run every frame under the cursor.
   */
  function wouldSealSomethingOff(x: number, z: number, w: number, d: number): boolean {
    paths.fill(x, z, w, d, true);
    let sealed = false;
    try {
      const ref = state.buildings.find(b => b.name === 'keep') ?? state.buildings[0];
      if (!ref) return false;
      const [rw, rd] = ref.def.footprint;
      let region = -1;
      for (let rz = ref.z - 1; rz <= ref.z + rd && region < 0; rz++) {
        for (let rx = ref.x - 1; rx <= ref.x + rw && region < 0; rx++) {
          const r = paths.regionAt(rx, rz);
          if (r >= 0) region = r;
        }
      }
      if (region < 0) return true;

      if (!hasAccess(x, z, w, d, region)) { sealed = true; return true; }
      for (const b of state.buildings) {
        const [bw, bd] = b.def.footprint;
        if (!hasAccess(b.x, b.z, bw, bd, region)) { sealed = true; return true; }
      }
      for (const wk of workers.workers) {
        if (paths.regionAt(Math.floor(wk.x), Math.floor(wk.z)) !== region) {
          sealed = true; return true;
        }
      }
      return false;
    } finally {
      if (!sealed) paths.fill(x, z, w, d, true);   // keep it; caller placed it
      else paths.fill(x, z, w, d, false);          // undo the trial
    }
  }

  /**
   * Move anyone standing inside a building back onto open ground.
   * Covers idle townsfolk too -- they are the only figures on screen before
   * any production building exists, so missing them is very visible.
   */
  function rescueStuckWorkers(): void {
    for (const w of workers.workers) {
      if (!paths.isBlocked(Math.floor(w.x), Math.floor(w.z))) continue;
      const open = paths.nearestOpen(Math.floor(w.x), Math.floor(w.z), 8);
      if (!open) continue;
      w.x = open.x + 0.5;
      w.z = open.z + 0.5;
      w.path = [];
      w.tx = w.x; w.tz = w.z;
    }
    for (const u of wanderers) {
      if (!paths.isBlocked(Math.floor(u.x), Math.floor(u.z))) continue;
      const open = paths.nearestOpen(Math.floor(u.x), Math.floor(u.z), 8);
      if (!open) continue;
      u.x = open.x + 0.5;
      u.z = open.z + 0.5;
      u.path = [];
      u.tx = u.x; u.tz = u.z;
      u.moving = false;
      u.pause = 0.5;
    }
  }

  // --- vegetation ---------------------------------------------------------
  const decorations: Decoration[] = [];
  const SAND = GROUND_TYPES.indexOf('sand');
  const SCRUB = GROUND_TYPES.indexOf('scrub');
  const GRASS = GROUND_TYPES.indexOf('grass');
  const DARK = GROUND_TYPES.indexOf('grass_dark');
  const ROCK = GROUND_TYPES.indexOf('rock');
  const TREES = new Set(['palm', 'olive_tree', 'dead_tree']);

  /**
   * Gazelle on the open land.
   *
   * Seeded as herds rather than scattered singly: a lone animal every thirty
   * tiles reads as decoration, a group of four grazing together reads as
   * wildlife, and it gives a hunter's hut somewhere worth standing.
   */
  /**
   * Red cast marking what belongs to the enemy.
   *
   * Two strengths on purpose. A soldier is twenty-odd pixels and has to read as
   * hostile at a glance, so his tint is heavy. A castle covers a third of the
   * screen, and the same heavy tint over that much stone stops looking like a
   * banner colour and starts looking like a broken render.
   */
  const ENEMY_TINT: [number, number, number] = [1.5, 0.62, 0.55];
  const ENEMY_BUILDING_TINT: [number, number, number] = [1.26, 0.80, 0.74];

  /** Gap between off-map raids, once they are switched on at all. */
  const RAID_EVERY = 300;
  // Off by default: the lord provides the pressure. Set a finite value through
  // __game.setNextRaid to bring off-map raiders back.
  let nextRaid = Infinity;
  let raidNumber = 0;

  /** Gold an unopposed enemy carries off per second, standing at your keep. */
  const SACK_GOLD_PER_SEC = 2.5;
  let sackDebt = 0;

  /**
   * The enemy lord's castle.
   *
   * Kept OUT of state.buildings deliberately. Everything in that list feeds the
   * player's economy -- housing, storage, worker slots -- so putting an enemy
   * keep in it would hand the player its beds and its granary.
   */
  interface EnemyBuilding {
    name: string; x: number; z: number; hp: number;
    /** Workers the lord has put in it. He manages this; we just store it. */
    staff: number;
  }
  const enemyBuildings: EnemyBuilding[] = [];
  let enemyKeep: { x: number; z: number } | null = null;

  const MARSH = GROUND_TYPES.indexOf('marsh');

  /** How fast the ground under a point lets a unit move. */
  function groundSpeed(x: number, z: number, siege: boolean): number {
    const tx = Math.floor(x), tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= MAP_W || tz >= MAP_H) return 1;
    if (groundType[tz * MAP_W + tx] !== MARSH) return 1;
    return siege ? MARSH_SPEED_SIEGE : MARSH_SPEED_FOOT;
  }

  /** The player's soldiers. */
  const army = new Army({
    findPath: (fx, fz, tx, tz) => paths.find(Math.floor(fx), Math.floor(fz),
                                             Math.floor(tx), Math.floor(tz)),
    blocked: (x, z) => paths.isBlocked(Math.floor(x), Math.floor(z)),
    groundSpeed,
    siegeTarget: (s) => {
      // Whose stone this engine is here to break.
      let best: { x: number; z: number; dist: number; hit(n: number): void } | null = null;
      const consider = (bx: number, bz: number, w: number, d: number,
                        hit: (n: number) => void) => {
        const dist = distToFootprint(s.x, s.z, bx, bz, w, d);
        if (best && dist >= best.dist) return;
        best = {
          x: Math.max(bx, Math.min(s.x, bx + w)),
          z: Math.max(bz, Math.min(s.z, bz + d)),
          dist, hit,
        };
      };
      if (s.side === 'player') {
        for (const b of enemyBuildings) {
          const [w, d] = BUILDINGS[b.name].footprint;
          consider(b.x, b.z, w, d, (n) => damageEnemyBuilding(b, n));
        }
      } else {
        for (const b of state.buildings) {
          const [w, d] = b.def.footprint;
          consider(b.x, b.z, w, d, (n) => damagePlayerBuilding(b, n));
        }
      }
      return best;
    },
  });

  const herd = new Herd({
    blocked: (x, z) => paths.isBlocked(Math.floor(x), Math.floor(z)),
    lineClear: (x1, z1, x2, z2) => paths.isLineClear(x1, z1, x2, z2),
    inBounds: (x, z) => x >= 1 && z >= 1 && x < MAP_W - 1 && z < MAP_H - 1,
  });

  const start = findStartSite(terrain, groundType);
  const cx = start.x, cz = start.z;

  for (const t of flatTiles) {
    const idx = t.z * MAP_W + t.x;
    if (occupied[idx]) continue;
    if (Math.abs(t.x - cx) < 8 && Math.abs(t.z - cz) < 8) continue;
    const g = groundType[idx];
    const r = hash2(t.x * 3 + 11, t.z * 5 + 7);
    let name: string | null = null;
    if (g === DARK) {
      if (r < 0.20) name = 'palm';
      else if (r < 0.30) name = 'olive_tree';
      else if (r < 0.40) name = 'bush';
    } else if (g === GRASS) {
      if (r < 0.10) name = 'palm';
      else if (r < 0.19) name = 'olive_tree';
      else if (r < 0.30) name = 'bush';
    } else if (g === SCRUB) {
      if (r < 0.07) name = 'bush';
      else if (r < 0.075) name = 'dead_tree';
    } else if (g === SAND) {
      if (r < 0.003) name = 'dead_tree';
      else if (r < 0.010) name = 'bush';
      else if (r < 0.014) name = 'rock';
    } else if (g === ROCK) {
      if (r < 0.12) name = 'rock';
    }
    if (name) {
      decorations.push({ name, x: t.x, z: t.z, alive: true, regrowAt: 0, claimedBy: null });
      occupied[idx] = 1;
    }
  }

  // --- game ---------------------------------------------------------------
  const state = new GameState();

  const groundName = (x: number, z: number) => {
    if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) return 'sand';
    return GROUND_TYPES[groundType[z * MAP_W + x]] ?? 'sand';
  };

  const placementWorld: PlacementWorld = {
    isFlat: (x, z, w, d) => isBuildable(terrain, x, z, w, d),
    groundAt: groundName,
    isOccupied: (x, z) =>
      x < 0 || z < 0 || x >= MAP_W || z >= MAP_H ? true : occupied[z * MAP_W + x] === 1,
    inBounds: (x, z, w, d) => x >= 0 && z >= 0 && x + w <= MAP_W && z + d <= MAP_H,
  };

  /** Felled trees waiting to grow back. */
  const regrowing: number[] = [];

  function releaseClaim(w: { id: number; claim: number | null; prey?: number | null }): void {
    // A hunter holds a prey mark, not a scatter claim, and freeing one without
    // the other would leave an animal frozen mid-graze for the rest of the game.
    herd.release(w.id);
    if (w.prey !== undefined) w.prey = null;
    if (w.claim === null) return;
    const t = decorations[w.claim];
    if (t && t.claimedBy === w.id) t.claimedBy = null;
    w.claim = null;
  }

  /**
   * Nudge a spot onto walkable ground.
   *
   * Work spots are computed geometrically, so in a dense settlement they
   * happily land on a neighbour's roof. Snapping keeps labourers standing
   * outside buildings instead of inside them.
   */
  function snapOpen(p: { x: number; z: number },
                    from?: { x: number; z: number }): { x: number; z: number } {
    const region = from ? paths.regionAt(Math.floor(from.x), Math.floor(from.z)) : -1;
    const tx = Math.floor(p.x), tz = Math.floor(p.z);
    if (!paths.isBlocked(tx, tz) && (region < 0 || paths.regionAt(tx, tz) === region)) {
      return p;
    }
    const open = paths.nearestOpen(tx, tz, 5, region);
    return open ? { x: open.x + 0.5, z: open.z + 0.5 } : p;
  }

  /**
   * Stand next to the trunk on the side facing home, not on top of it.
   * Approaching from that side also leaves the walk heading pointing at the
   * tree, so the chop animation faces what it is cutting.
   */
  function standBeside(t: Decoration, from: { x: number; z: number }) {
    return standBesidePoint({ x: t.x + 0.5, z: t.z + 0.5 }, from);
  }

  /** Same, for something that already has a world position rather than a tile. */
  function standBesidePoint(p: { x: number; z: number }, from: { x: number; z: number }) {
    const tx = p.x, tz = p.z;
    const dx = from.x - tx, dz = from.z - tz;
    const len = Math.hypot(dx, dz) || 1;
    const off = 0.55;
    return { x: tx + (dx / len) * off, z: tz + (dz / len) * off };
  }

  const workerWorld: WorkerWorld = {
    heightAt: (x, z) => terrain.heightAt(x, z),
    groundSpeed,
    nearestStore(kind, x, z) {
      let best: PlacedBuilding | null = null;
      let bestD = Infinity;
      for (const b of state.buildings) {
        if (b.def.storeFor !== kind) continue;
        const d = (b.x - x) ** 2 + (b.z - z) ** 2;
        if (d < bestD) { bestD = d; best = b; }
      }
      return best;
    },
    isWalkable(x, z) {
      return !paths.isBlocked(Math.floor(x), Math.floor(z));
    },

    lineClear(x1, z1, x2, z2) {
      return paths.isLineClear(x1, z1, x2, z2);
    },

    approach(b, fromX, fromZ) {
      const [w, d] = b.def.footprint;
      const from = paths.regionAt(Math.floor(fromX), Math.floor(fromZ));

      let best: { x: number; z: number } | null = null;
      let bestD = Infinity;
      let fallback: { x: number; z: number } | null = null;
      let fallbackD = Infinity;

      // the ring of tiles just outside the footprint
      for (let z = b.z - 1; z <= b.z + d; z++) {
        for (let x = b.x - 1; x <= b.x + w; x++) {
          const onRing = x === b.x - 1 || x === b.x + w || z === b.z - 1 || z === b.z + d;
          if (!onRing) continue;
          if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) continue;
          if (paths.isBlocked(x, z)) continue;
          const cx = x + 0.5, cz = z + 0.5;
          const dist = (cx - fromX) ** 2 + (cz - fromZ) ** 2;

          // Prefer a door the worker can actually walk to. Buildings readily
          // enclose a courtyard, and picking the geometrically nearest tile
          // happily lands inside one.
          if (from >= 0 && paths.regionAt(x, z) === from) {
            if (dist < bestD) { bestD = dist; best = { x: cx, z: cz }; }
          } else if (dist < fallbackD) {
            fallbackD = dist; fallback = { x: cx, z: cz };
          }
        }
      }
      return best ?? fallback ?? { x: b.x + w / 2, z: b.z + d / 2 };
    },

    findPath(fromX, fromZ, toX, toZ) {
      return paths.find(Math.floor(fromX), Math.floor(fromZ),
                        Math.floor(toX), Math.floor(toZ));
    },

    haulerNear(b) {
      return state.buildings.some(o =>
        o.name === 'ox_tether' &&
        Math.abs(o.x - b.x) < 14 && Math.abs(o.z - b.z) < 14);
    },
    workSpot(b, w) {
      const [fw, fd] = b.def.footprint;
      const c = { x: b.x + fw / 2, z: b.z + fd / 2 };

      // Woodcutters walk to an actual tree, and each one reserves its own.
      // Without the reservation every hut sends its man to the same nearest
      // trunk and they stack on one tile.
      if (b.name === 'woodcutter') {
        const held = w.claim !== null ? decorations[w.claim] : null;
        if (held && held.alive && held.claimedBy === w.id) {
          return snapOpen(standBeside(held, c), w);
        }
        if (w.claim !== null) releaseClaim(w);

        let bestIdx = -1;
        let bestD = Infinity;
        for (let i = 0; i < decorations.length; i++) {
          const t = decorations[i];
          if (!t.alive || !TREES.has(t.name)) continue;
          if (t.claimedBy !== null) continue;
          const d = (t.x - c.x) ** 2 + (t.z - c.z) ** 2;
          if (d < bestD) { bestD = d; bestIdx = i; }
        }
        if (bestIdx < 0 || bestD > TREE_SEARCH_RADIUS ** 2) {
          state.notify('No trees near the woodcutter', 'warn');
          return null;
        }
        decorations[bestIdx].claimedBy = w.id;
        w.claim = bestIdx;
        return snapOpen(standBeside(decorations[bestIdx], c), w);
      }

      // A hunter walks to a gazelle and marks it. The animal freezes while
      // marked -- it has not noticed him -- which is what lets this reuse the
      // ordinary walk-to-a-fixed-spot machinery instead of needing a chase.
      if (b.name === 'hunter') {
        const held = w.prey !== null ? herd.byId(w.prey) : null;
        if (held && held.alive && held.claimedBy === w.id) {
          return snapOpen(standBesidePoint(held, c), w);
        }
        if (w.prey !== null) { herd.release(w.id); w.prey = null; }

        const quarry = herd.nearestFree(c.x, c.z, HUNT_RADIUS);
        if (!quarry) {
          state.notify('No game near the hunter', 'warn');
          return null;
        }
        quarry.claimedBy = w.id;
        w.prey = quarry.id;
        return snapOpen(standBesidePoint(quarry, c), w);
      }

      const ang = (w.slot / Math.max(1, b.def.workers)) * Math.PI * 2 + b.id;
      const rad = Math.max(fw, fd) * 0.55 + 0.6;
      return snapOpen({ x: c.x + Math.cos(ang) * rad, z: c.z + Math.sin(ang) * rad }, w);
    },

    harvest(b, w) {
      if (b.name === 'hunter') {
        if (w.prey !== null) herd.take(w.prey, state.elapsed);
        w.prey = null;
        return;
      }
      if (b.name !== 'woodcutter' || w.claim === null) return;
      const t = decorations[w.claim];
      if (!t || !t.alive) return;
      t.alive = false;
      t.regrowAt = state.elapsed + TREE_REGROW_SECONDS;
      t.claimedBy = null;
      w.claim = null;
      // felling clears the land, so the spot becomes buildable
      occupied[t.z * MAP_W + t.x] = 0;
      regrowing.push(decorations.indexOf(t));
      staticDirty = true;
    },

    releaseClaim(w) { releaseClaim(w); },
  };

  const workers = new WorkerPool(workerWorld, state);
  const placement = new Placement(placementWorld, state);
  const hud = new Hud(state, placement);
  hud.onRecruit = (type: string) => recruit(type);
  hud.enemyCount = () => army.enemies.length;
  hud.armyCounts = () => {
    const n: Record<string, number> = {};
    for (const sd of army.mine) n[sd.type] = (n[sd.type] ?? 0) + 1;
    return n;
  };

  /**
   * Recompute the legal-placement overlay. Runs once per selection change, not
   * per frame: it is 40,000 placement checks, which is cheap once and wasteful
   * sixty times a second.
   */
  let debugBlocked = false;
  let lastIdleCount = -1;
  let overlayFor: string | null = null;
  function refreshOverlay(force = false): void {
    if (debugBlocked) return;
    const sel = placement.selected;
    if (!force && sel === overlayFor) return;
    overlayFor = sel;
    if (!sel) { terrain.setOverlay(null); return; }
    terrain.setOverlay((x, z) => placement.check(sel, x, z).ok);
  }

  hud.onSelect = () => refreshOverlay();

  // --- starting settlement ------------------------------------------------
  const place = (name: string, nearX: number, nearZ: number): PlacedBuilding | null => {
    const [w, d] = BUILDINGS[name].footprint;
    const site = findSite(terrain, w, d, nearX, nearZ, 34);
    if (!site) return null;
    if (!placementWorld.isOccupied(site.x, site.z)) {
      if (state.buildings.length && wouldSealSomethingOff(site.x, site.z, w, d)) {
        paths.fill(site.x, site.z, w, d, false);
        return null;
      }
      paths.fill(site.x, site.z, w, d, false);
      const b = state.addBuilding(name, site.x, site.z);
      markArea(site.x, site.z, w, d);
      markSolid(site.x, site.z, w, d);
      return b;
    }
    return null;
  };

  /**
   * Lay down a block of store squares.
   *
   * Both stores are separate 1x1 buildings, not one 3x3 shed, because each
   * square draws its own load and can be added to independently. Nine to start
   * against nine storable goods: enough to open, not enough to coast.
   */
  const placeStoreBlock = (name: string, nearX: number, nearZ: number,
                           w = 3, d = 3): void => {
    const site = findSite(terrain, w, d, nearX, nearZ, 34);
    if (!site) return;
    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) {
        const x = site.x + dx, z = site.z + dz;
        if (placementWorld.isOccupied(x, z)) continue;
        state.addBuilding(name, x, z);
        markArea(x, z, 1, 1);     // no markSolid: stores are walked over
      }
    }
  };

  const keep = place('keep', cx, cz);
  const kx = keep?.x ?? cx, kz = keep?.z ?? cz;
  // Sixteen yard squares, nine granary bays.
  //
  // Measured on a natural build order with a 3x3 yard: 300 of 450 units are
  // spoken for before the player has done anything, the amber warning is on
  // almost at once, and by minute 15 wheat has hogged three squares and the
  // flour has nowhere to go. Sixteen opens at 37% and still needs expanding
  // once four or five chains are running, which is the pressure I wanted --
  // just not in the first quarter hour.
  placeStoreBlock('stockpile', kx + 8, kz + 1, 4, 4);
  placeStoreBlock('granary', kx - 7, kz + 2);
  // Two hovels to open with. Starting at keep-only housing put population at
  // capacity immediately, which applies the overcrowding penalty and starts the
  // player below the growth threshold before they have done anything.
  place('hovel', kx + 4, kz - 4);
  place('hovel', kx - 4, kz - 4);
  state.assignWorkers();
  workers.sync();

  /**
   * Raise the enemy lord's castle, far across the map.
   *
   * Built from the same building set as the player's, tinted red. Placed at
   * distance and only on ground that will take it -- a lord whose keep failed
   * to find a site would leave the player alone on the map with no opponent
   * and no explanation, so this tries every direction before giving up.
   */
  /**
   * The same ground rules the player's placement enforces.
   *
   * isBuildable only checks that the ground is LEVEL. Without this the lord
   * would happily put wheat farms on sand and quarries on grass, which is
   * exactly the sort of quiet exemption that makes an opponent feel unfair.
   */
  const enemyTerrainOk = (name: string, x: number, z: number): boolean => {
    const need = BUILDINGS[name].terrain;
    if (need === 'any') return true;
    const [w, d] = BUILDINGS[name].footprint;
    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) {
        const g = GROUND_TYPES[groundType[(z + dz) * MAP_W + (x + dx)]];
        const ok = need === 'green' ? (g === 'grass' || g === 'grass_dark')
                 : need === 'rock' ? g === 'rock'
                 : (g === 'sand' || g === 'scrub');
        if (!ok) return false;
      }
    }
    return true;
  };

  const placeEnemyAt = (name: string, x: number, z: number): boolean => {
    const [w, d] = BUILDINGS[name].footprint;
    if (x < 1 || z < 1 || x + w >= MAP_W - 1 || z + d >= MAP_H - 1) return false;
    if (!isBuildable(terrain, x, z, w, d)) return false;
    if (!enemyTerrainOk(name, x, z)) return false;
    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) if (occupied[(z + dz) * MAP_W + (x + dx)]) return false;
    }
    enemyBuildings.push({ name, x, z, hp: buildingHp(BUILDINGS[name]), staff: 0 });
    markArea(x, z, w, d);
    if (!BUILDINGS[name].walkable) markSolid(x, z, w, d);
    return true;
  };

  const placeEnemyNear = (name: string, nx: number, nz: number, radius = 18) => {
    const [w, d] = BUILDINGS[name].footprint;
    const site = findSite(terrain, w, d, nx, nz, radius);
    if (!site) return null;
    return placeEnemyAt(name, site.x, site.z) ? site : null;
  };

  /** Ring positions for his curtain wall, and which slot the gate takes. */
  let enemyRing: [number, number][] = [];
  let enemyGate: [number, number] | null = null;

  (function raiseEnemyCastle(): void {
    const dirs: [number, number][] = [
      [1, 1], [-1, -1], [1, -1], [-1, 1], [1, 0], [0, 1], [-1, 0], [0, -1],
    ];
    for (const [dx, dz] of dirs) {
      const cx = Math.max(14, Math.min(MAP_W - 15, kx + dx * 72));
      const cz = Math.max(14, Math.min(MAP_H - 15, kz + dz * 72));
      const keepSite = placeEnemyNear('keep', cx, cz, 28);
      if (!keepSite) continue;

      const c = { x: keepSite.x + 1, z: keepSite.z + 1 };
      enemyKeep = c;

      // He STARTS with a keep and one hovel and nothing else. Everything after
      // that -- timber, storage, food, stone, the barracks, the walls -- he has
      // to build and pay for, which is the whole point of giving him an
      // economy rather than a spawn timer.
      placeEnemyNear('hovel', keepSite.x - 5, keepSite.z + 3, 10);

      // The wall ring is laid out now but not built. The gate slot is the
      // position closest to the player that will take a 2x2, chosen before any
      // wall goes down so the wall can be built around it later.
      const R = 7;
      const ring: [number, number][] = [];
      for (let i = -R; i <= R - 1; i++) {
        ring.push([c.x + i, c.z - R], [c.x + i, c.z + R],
                  [c.x - R, c.z + i], [c.x + R, c.z + i]);
      }
      enemyRing = ring;
      const byNearest = [...ring].sort(
        (a, b) => Math.hypot(a[0] - kx, a[1] - kz) - Math.hypot(b[0] - kx, b[1] - kz));
      enemyGate = byNearest.find(([wx, wz]) =>
        isBuildable(terrain, wx, wz, 2, 2)) ?? null;

      console.log(`[lord] keep at ${c.x},${c.z} — ` +
                  `${Math.round(Math.hypot(c.x - kx, c.z - kz))} tiles away, ` +
                  `he builds the rest himself`);
      return;
    }
    console.warn('[lord] found nowhere to build a castle');
  })();

  /**
   * Find somewhere for the lord to put a building.
   *
   * Scans outward from his keep rather than using findSite, because findSite
   * only checks that the ground is level -- a farm also needs green land, and
   * the first level patch is very often the wrong sort of ground.
   */
  function findEnemySite(name: string, maxR = 26,
                        anchor?: { x: number; z: number }): [number, number] | null {
    if (!enemyKeep) return null;
    const [w, d] = BUILDINGS[name].footprint;
    const c = anchor ?? enemyKeep;
    for (let r = 2; r <= maxR; r++) {
      for (let a = 0; a < r * 8; a++) {
        const ang = (a / (r * 8)) * Math.PI * 2;
        const x = Math.round(c.x + Math.cos(ang) * r) - Math.floor(w / 2);
        const z = Math.round(c.z + Math.sin(ang) * r) - Math.floor(d / 2);
        if (x < 1 || z < 1 || x + w >= MAP_W - 1 || z + d >= MAP_H - 1) continue;
        if (!isBuildable(terrain, x, z, w, d)) continue;
        if (!enemyTerrainOk(name, x, z)) continue;
        let clear = true;
        for (let dz = 0; dz < d && clear; dz++) {
          for (let dx = 0; dx < w; dx++) {
            if (occupied[(z + dz) * MAP_W + (x + dx)]) { clear = false; break; }
          }
        }
        if (clear) return [x, z];
      }
    }
    return null;
  }

  /** Build one thing for the lord. Returns false if there is nowhere to put it. */
  function lordBuild(name: string): boolean {
    if (name === 'wall') {
      for (const [wx, wz] of enemyRing) {
        // keep the gate's 2x2 and a tile of clearance either side of it free
        if (enemyGate && Math.abs(wx - enemyGate[0]) <= 2
                      && Math.abs(wz - enemyGate[1]) <= 2) continue;
        if (occupied[wz * MAP_W + wx]) continue;
        if (placeEnemyAt('wall', wx, wz)) { staticDirty = true; return true; }
      }
      return false;
    }
    if (name === 'tower') {
      // A tower belongs ON the wall line, at a corner if one is free.
      const corners = enemyRing.filter(([wx, wz]) =>
        enemyKeep && Math.abs(wx - enemyKeep.x) === 7 && Math.abs(wz - enemyKeep.z) === 7);
      for (const [wx, wz] of [...corners, ...enemyRing]) {
        if (enemyGate && Math.abs(wx - enemyGate[0]) <= 3
                      && Math.abs(wz - enemyGate[1]) <= 3) continue;
        if (placeEnemyAt('tower', wx, wz)) { staticDirty = true; return true; }
      }
      return false;
    }
    if (name === 'gatehouse') {
      if (!enemyGate) return false;
      const ok = placeEnemyAt('gatehouse', enemyGate[0], enemyGate[1]);
      if (ok) staticDirty = true;
      return ok;
    }
    // An ox tether belongs beside a QUARRY, not beside the keep.
    //
    // Placed from the keep like everything else it lands in the courtyard,
    // while the quarries sit out on whatever rock the map provides -- often
    // well past the 14-tile haul range. Measured: two quarries, two tethers,
    // and two stone in the bank after thirty minutes, with the wall stuck at
    // nine segments and the siege camp never affordable.
    let anchor: { x: number; z: number } | undefined;
    if (name === 'ox_tether') {
      const orphan = enemyBuildings.find(q => q.name === 'quarry'
        && !enemyBuildings.some(o => o.name === 'ox_tether'
          && Math.abs(o.x - q.x) < 14 && Math.abs(o.z - q.z) < 14));
      if (orphan) anchor = { x: orphan.x, z: orphan.z };
    }
    const site = findEnemySite(name, 26, anchor);
    if (!site) return false;
    const ok = placeEnemyAt(name, site[0], site[1]);
    if (ok) staticDirty = true;
    return ok;
  }

  /**
   * Seed gazelle herds across the open land.
   *
   * Deterministic rather than Math.random: the map itself is generated from a
   * fixed seed, and wildlife that moved every reload would make any measurement
   * of a hunter's output unrepeatable.
   *
   * Herds are kept off rock, apart from each other, and away from the keep --
   * gazelle grazing in the courtyard would read as a bug, and a hut still
   * reaches them at HUNT_RADIUS.
   */
  (function seedHerds(): void {
    let seed = 0x9e3779b9 ^ 20260818;
    const rnd = () => {
      seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x9e3779b9) | 0;
      return ((seed >>> 8) & 0xffffff) / 0x1000000;
    };
    const ROCK = GROUND_TYPES.indexOf('rock');
    const centres: { x: number; z: number }[] = [];
    const WANT = 15;

    for (let tries = 0; tries < 2500 && centres.length < WANT; tries++) {
      const x = 6 + Math.floor(rnd() * (MAP_W - 12));
      const z = 6 + Math.floor(rnd() * (MAP_H - 12));
      if (paths.isBlocked(x, z)) continue;
      if (groundType[z * MAP_W + x] === ROCK) continue;
      if (Math.hypot(x - kx, z - kz) < 16) continue;
      if (centres.some(c => Math.hypot(c.x - x, c.z - z) < 12)) continue;
      centres.push({ x, z });
    }

    for (const c of centres) {
      const n = 3 + Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        for (let t = 0; t < 12; t++) {
          const ang = rnd() * Math.PI * 2;
          const r = rnd() * 3.0;
          const ax = c.x + 0.5 + Math.cos(ang) * r;
          const az = c.z + 0.5 + Math.sin(ang) * r;
          if (paths.isBlocked(Math.floor(ax), Math.floor(az))) continue;
          herd.add(ax, az);
          break;
        }
      }
    }
    console.log(`[wildlife] ${centres.length} herds, ${herd.animals.length} gazelle`);
  })();

  /**
   * The gathering fire outside the keep.
   *
   * Placed automatically rather than built: in Stronghold it is simply where
   * the unemployed stand, and having somewhere for them to be is what stops a
   * settlement with no jobs from looking abandoned.
   */
  const fire = (() => {
    // The keep's door is modelled on the Blender -Y face, and engine_z is
    // -blender_y, so the door faces +z: it sits at about (bx + 1.5, bz + 3).
    // Put the fire straight out from it, leaving one tile of space to stand in.
    const doorX = kx + 1;
    const candidates: [number, number][] = [
      [doorX, kz + 4], [doorX, kz + 5], [doorX - 1, kz + 4], [doorX + 1, kz + 4],
      [doorX, kz + 3], [doorX - 1, kz + 5], [doorX + 1, kz + 5],
    ];
    const usable = (x: number, z: number) => {
      if (x < 2 || z < 2 || x >= MAP_W - 2 || z >= MAP_H - 2) return false;
      if (occupied[z * MAP_W + x]) return false;
      if (!isBuildable(terrain, x, z, 1, 1)) return false;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++)
          if (occupied[(z + dz) * MAP_W + (x + dx)]) return false;
      return true;
    };

    let spot = candidates.find(([x, z]) => usable(x, z));
    if (!spot) {                       // nothing in front: settle for anywhere near
      outer: for (let r = 3; r <= 10; r++) {
        for (let a = 0; a < 24; a++) {
          const ang = (a / 24) * Math.PI * 2;
          const x = Math.round(kx + 1.5 + Math.cos(ang) * r);
          const z = Math.round(kz + 1.5 + Math.sin(ang) * r);
          if (usable(x, z)) { spot = [x, z]; break outer; }
        }
      }
    }
    if (!spot) return { x: kx + 1.5, z: kz + 1.5 };

    const [fx, fz] = spot;
    decorations.push({ name: 'campfire', x: fx, z: fz, alive: true, regrowAt: 0, claimedBy: null });
    occupied[fz * MAP_W + fx] = 1;      // cannot build on it
    paths.setBlocked(fx, fz, true);     // and nobody stands in the flames
    return { x: fx + 0.5, z: fz + 0.5 };
  })();

  /**
   * Standing places around the fire, nearest first.
   *
   * Found by searching outward for open ground rather than by fixed geometry.
   * A fixed ring cannot cope: at radius 2.45 the circle reaches into the keep's
   * own footprint, so those places had to be shunted elsewhere and the crowd
   * bunched up -- with 20 idle, two peasants ended up 0.32 tiles apart.
   * Searching also means the ring simply grows as the crowd does, and flows
   * around whatever gets built nearby.
   */
  let firePosts: { x: number; z: number }[] = [];

  function rebuildFirePosts(): void {
    const spots: { x: number; z: number }[] = [];
    for (let ring = 0; ring < 10 && spots.length < IDLE_WANDERERS; ring++) {
      const r = 1.5 + ring * 0.62;
      const n = Math.max(6, Math.round((2 * Math.PI * r) / GATHER_SPACING));
      for (let i = 0; i < n && spots.length < IDLE_WANDERERS; i++) {
        const a = (i / n) * Math.PI * 2 + ring * 0.37;
        const x = fire.x + Math.cos(a) * r;
        const z = fire.z + Math.sin(a) * r;
        if (paths.isBlocked(Math.floor(x), Math.floor(z))) continue;
        let tooClose = false;
        for (const sp of spots) {
          if (Math.hypot(sp.x - x, sp.z - z) < GATHER_SPACING) { tooClose = true; break; }
        }
        if (tooClose) continue;
        spots.push({ x, z });
      }
    }
    firePosts = spots;
  }

  function firePost(slot: number): { x: number; z: number } {
    if (!firePosts.length) return { x: fire.x, z: fire.z };
    return firePosts[slot % firePosts.length];
  }

  // idle peasants gather at the fire rather than drifting aimlessly
  const wanderers: Wanderer[] = [];
  for (let i = 0; i < IDLE_WANDERERS; i++) {
    const ang = hash2(i, 1) * Math.PI * 2;
    const rad = 2 + hash2(i, 2) * 7;
    const x = kx + Math.cos(ang) * rad;
    const z = kz + Math.sin(ang) * rad;
    wanderers.push({
      x, z, tx: x, tz: z, heading: hash2(i, 3) * Math.PI * 2,
      speed: 0.55 + hash2(i, 4) * 0.4, phase: hash2(i, 5) * 10,
      moving: false, pause: hash2(i, 6) * 3, path: [],
      slot: i, atPost: false, restless: 6 + hash2(i, 7) * 25,
    });
  }

  iso.target.set(kx + 1.5, terrain.heightAt(kx, kz), kz + 1.5);
  iso.setBounds(0, MAP_W, 0, MAP_H);

  // --- rendering helpers --------------------------------------------------
  const atlasPpu = (TILE_PX_W / Math.SQRT2) * atlas.scale;
  const clipFrames = (clip: string) => atlas.clips[clip]?.frames ?? 1;

  let builtRotation = -1;
  let staticDirty = true;

  /** Grow felled trees back, unless something has since been built there. */
  function regrowForest(): void {
    for (let i = regrowing.length - 1; i >= 0; i--) {
      const t = decorations[regrowing[i]];
      if (!t || t.alive) { regrowing.splice(i, 1); continue; }
      if (state.elapsed < t.regrowAt) continue;
      regrowing.splice(i, 1);
      if (occupied[t.z * MAP_W + t.x]) continue;   // built over; it stays gone
      t.alive = true;
      occupied[t.z * MAP_W + t.x] = 1;
      staticDirty = true;
    }
  }

  interface DrawItem {
    key: string; x: number; z: number; y: number;
    bias: number; depth: number;
    /** Selected soldiers are brightened in place; there is no marker sprite. */
    tint?: [number, number, number];
  }

  /**
   * Static scenery, pre-sorted back to front.
   *
   * Rebuilt only when the rotation changes or something is built or felled --
   * there are several thousand of these and re-sorting every frame is waste.
   * The handful of moving figures is merged into this list at draw time.
   */
  let staticSorted: DrawItem[] = [];

  /**
   * Put a raiding party on the map.
   *
   * They come from one edge and march on the keep, fighting whatever they meet.
   * Composition hardens as the raids go on, so an opening that beats spearmen
   * does not carry you for the rest of the game.
   */
  function spawnRaid(count?: number): number {
    const keep = state.buildings.find(b => b.name === 'keep');
    if (!keep) return 0;
    raidNumber += 1;
    const n = count ?? Math.min(14, 3 + raidNumber * 2);

    const edge = Math.floor(Math.random() * 4);
    const side = ['the north', 'the east', 'the south', 'the west'][edge];
    const pick = () => {
      const t = 6 + Math.random() * (MAP_W - 12);
      switch (edge) {
        case 0: return { x: t, z: 4 };
        case 1: return { x: MAP_W - 5, z: t };
        case 2: return { x: t, z: MAP_H - 5 };
        default: return { x: 4, z: t };
      }
    };

    let placed = 0;
    for (let i = 0; i < n; i++) {
      let spot: { x: number; z: number } | null = null;
      for (let tries = 0; tries < 24 && !spot; tries++) {
        const p = pick();
        const x = p.x + (Math.random() - 0.5) * 6, z = p.z + (Math.random() - 0.5) * 6;
        if (x < 2 || z < 2 || x > MAP_W - 3 || z > MAP_H - 3) continue;
        if (paths.isBlocked(Math.floor(x), Math.floor(z))) continue;
        spot = { x, z };
      }
      if (!spot) continue;
      // Later waves bring better troops. Spearmen only for the first two.
      const roll = Math.random();
      const type = raidNumber <= 2 ? 'spearman'
        : roll < 0.5 ? 'spearman' : roll < 0.8 ? 'archer' : 'swordsman';
      const e = army.recruit(type, spot.x, spot.z, 'enemy');
      if (!e) continue;
      // Head for the keep; if walls make that impossible, make for the nearest
      // of the player's soldiers instead so they do not just stand at the edge.
      if (!army.send(e, keep.x + 1, keep.z + 1)) {
        const mine = army.mine[0];
        if (mine) army.send(e, mine.x, mine.z);
      }
      placed++;
    }
    if (placed) state.notify(`Enemies approach from ${side}!`, 'warn');
    return placed;
  }

  /**
   * Raid timing, and what happens when nobody stops them.
   *
   * There is no building damage yet, so an unopposed raider loots instead:
   * gold off the treasury and popularity off the town while he stands in your
   * keep. Without a consequence, losing a battle costs nothing and combat is
   * decoration.
   */
  function updateRaids(dt: number): void {
    // The lord is the source of attacks now. The edge-spawn raid stays behind
    // `spawnRaid()` as a testing tool -- troops appearing out of empty desert
    // was always a placeholder for an opponent who actually lives somewhere.
    lord.update(dt);
    if (nextRaid !== Infinity && state.elapsed >= nextRaid) {
      spawnRaid();
      nextRaid = state.elapsed + RAID_EVERY;
    }
    for (const f of army.lastFallen) {
      if (f.side === 'player') {
        state.notify(`Your ${f.def.label.toLowerCase()} has fallen`, 'warn');
      }
    }
    const keep = state.buildings.find(b => b.name === 'keep');
    if (!keep) return;
    let sacking = 0;
    for (const e of army.enemies) {
      if (e.target !== null) continue;
      if (Math.hypot(e.x - (keep.x + 1), e.z - (keep.z + 1)) < 3.5) sacking++;
    }
    if (!sacking) return;
    sackDebt += sacking * SACK_GOLD_PER_SEC * dt;
    const take = Math.floor(sackDebt);
    if (take > 0) {
      sackDebt -= take;
      state.gold = Math.max(0, state.gold - take);
      state.popularity = Math.max(0, state.popularity - take * 0.05);
      state.notify('Your keep is being sacked!', 'warn');
    }
  }

  let lordDefeated = false;

  /** Distance from a point to the nearest edge of a footprint. */
  function distToFootprint(px: number, pz: number,
                           bx: number, bz: number, w: number, d: number): number {
    // Clamp onto the rectangle. Measuring to the CENTRE would have a catapult
    // stop a whole keep-width short of a keep and never reach it.
    const cx = Math.max(bx, Math.min(px, bx + w));
    const cz = Math.max(bz, Math.min(pz, bz + d));
    return Math.hypot(px - cx, pz - cz);
  }

  /** Name of whichever building owns a tile, player's or the lord's. */
  function buildingNameAt(x: number, z: number): string {
    for (const b of state.buildings) {
      const [w, d] = b.def.footprint;
      if (x >= b.x && x < b.x + w && z >= b.z && z < b.z + d) return b.name;
    }
    for (const b of enemyBuildings) {
      const [w, d] = BUILDINGS[b.name].footprint;
      if (x >= b.x && x < b.x + w && z >= b.z && z < b.z + d) return b.name;
    }
    return '';
  }

  /**
   * Turn out anyone standing on a building that has just fallen.
   *
   * They drop rather than die -- shaken and on the ground where the wall was.
   * Killing them outright would make a breached wall an instant massacre and
   * punish the player twice for the same event.
   */
  function evictGarrison(x: number, z: number): void {
    for (const sd of army.garrisonOf(x, z)) {
      army.dismount(sd, sd.x, sd.z);
      sd.hp = Math.max(1, Math.round(sd.hp * 0.6));
    }
  }

  /** Take a building off the map: free its tiles and forget it. */
  function razeTiles(x: number, z: number, w: number, d: number): void {
    markArea(x, z, w, d, 0);
    markSolid(x, z, w, d, false);
    staticDirty = true;
  }

  function damageEnemyBuilding(b: EnemyBuilding, amount: number): void {
    b.hp -= amount;
    if (b.hp > 0) return;
    const [w, d] = BUILDINGS[b.name].footprint;
    const i = enemyBuildings.indexOf(b);
    if (i >= 0) enemyBuildings.splice(i, 1);
    evictGarrison(b.x, b.z);
    razeTiles(b.x, b.z, w, d);
    if (b.name === 'barracks') {
      state.notify("The enemy lord's barracks is destroyed — no more troops!", 'info');
    }
    if (b.name === 'keep' && !lordDefeated) {
      lordDefeated = true;
      lord.defeated = true;
      state.notify("The enemy lord's keep has fallen. The field is yours!", 'info');
    }
  }

  function damagePlayerBuilding(b: PlacedBuilding, amount: number): void {
    b.hp -= amount;
    if (b.hp > 0) return;
    const [w, d] = b.def.footprint;
    state.removeBuilding(b);
    evictGarrison(b.x, b.z);
    razeTiles(b.x, b.z, w, d);
    state.notify(`Your ${b.def.label.toLowerCase()} has been destroyed!`, 'warn');
    workers.sync();
  }

  /** The enemy lord, raising troops at his own castle. */
  const lord = new Lord(army, {
    buildings: () => enemyBuildings,
    build: (name: string) => lordBuild(name),
    // No barracks, no recruits -- and the barracks is found LIVE, because he
    // builds it himself partway through the game and may lose it later.
    muster: () => {
      const bar = enemyBuildings.find(b => b.name === 'barracks');
      return bar ? { x: bar.x + 1, z: bar.z + 4 } : null;
    },
    home: () => enemyKeep ?? { x: kx, z: kz },
    target: () => {
      const k = state.buildings.find(b => b.name === 'keep');
      return k ? { x: k.x + 1, z: k.z + 1 } : null;
    },
    garrisonPost: () => {
      // Prefer a tower, then the gatehouse, then any wall he has not manned.
      const rank = (n: string) => n === 'tower' ? 0 : n === 'gatehouse' ? 1 : 2;
      const posts = enemyBuildings
        .filter(b => canGarrison(b.name))
        .sort((a, b) => rank(a.name) - rank(b.name));
      for (const b of posts) {
        const [w, d] = BUILDINGS[b.name].footprint;
        // Spread them along the battlements. A generous cap put the whole
        // garrison on one gatehouse and left the rest of the wall bare.
        const cap = b.name === 'wall' ? 1 : 3;
        // Count men still walking to it, or a whole garrison gets assigned to
        // the same post in one tick before any of them has arrived.
        const inbound = army.soldiers.filter(u => u.mountAt
          && u.mountAt.x === b.x && u.mountAt.z === b.z).length;
        if (army.garrisonOf(b.x, b.z).length + inbound >= cap) continue;
        return { x: b.x, z: b.z, cx: b.x + w / 2, cz: b.z + d / 2 };
      }
      return null;
    },
    notify: (t: string) => state.notify(t, 'warn'),
  });

  /** Relayout both stores. Returns whether anything DRAWN changed. */
  function syncStores(): boolean {
    let moved = false;
    for (const kind of STORE_KINDS) {
      // Not `||`: it short-circuits, and the granary would stop being laid out
      // the moment the stockpile happened to change on the same tick.
      if (state.layoutFor(kind).sync(state.storeTiles(kind), state.stock)) moved = true;
    }
    return moved;
  }

  function rebuildStatic() {
    const rot = iso.rotation;
    const items: DrawItem[] = [];

    const push = (name: string, x: number, z: number, w: number, d: number,
                  tint?: [number, number, number]) => {
      const key = `${name}_${rot}`;
      if (!atlas.frames[key]) return;
      const [ax, az] = spriteAnchor(x, z, d);
      items.push({
        key, x: ax, z: az, y: terrain.heightAt(x, z),
        bias: footprintDepthBias(w, d, rot),
        // sort by the footprint centre, not by whichever corner is anchored
        depth: depthKey(x + w / 2, z + d / 2, rot),
        tint,
      });
    };

    for (const t of decorations) if (t.alive) push(t.name, t.x, t.z, 1, 1);

    // Each store square draws what is actually on it. Square and load are baked
    // into one sprite per level, so there is nothing to depth-sort against
    // itself and peasants still walk over the top of both.
    const squareAt = new Map<string, string>();
    for (const kind of STORE_KINDS) {
      const art = STORE_SPRITES[kind];
      for (const p of state.layoutFor(kind).piles) {
        squareAt.set(`${p.x},${p.z}`,
          p.res && p.level > 0 ? `${art.prefix}_${p.res}_${p.level}` : art.empty);
      }
    }
    for (const b of state.buildings) {
      const [w, d] = b.def.footprint;
      if (b.def.storeFor) {
        push(squareAt.get(`${b.x},${b.z}`) ?? STORE_SPRITES[b.def.storeFor].empty,
             b.x, b.z, 1, 1);
        continue;
      }
      push(b.name, b.x, b.z, w, d);
    }

    // The lord's castle, under the same red cast as his troops.
    for (const b of enemyBuildings) {
      const [w, d] = BUILDINGS[b.name].footprint;
      push(b.name, b.x, b.z, w, d, ENEMY_BUILDING_TINT);
    }
    items.sort((a, b) => a.depth - b.depth);
    staticSorted = items;
    builtRotation = rot;
    staticDirty = false;
    rebuildFirePosts();       // building near the fire reshapes the ring
  }

  // --- input --------------------------------------------------------------
  //
  // Left-drag already pans, and taking that away to make room for a selection
  // box would break the control everyone has been using. Box select is
  // shift-drag; a plain click picks the soldier under the cursor.
  /** Roughly how tall a soldier sprite stands above its feet, in pixels. */
  const SOLDIER_PICK_HEIGHT = 24;

  const selBox = document.createElement('div');
  selBox.style.cssText = 'position:fixed;border:1px solid #f0c869;' +
    'background:rgba(240,200,105,.14);pointer-events:none;display:none;z-index:40';
  document.body.appendChild(selBox);
  let boxing = false, boxX = 0, boxY = 0;

  let dragging = false, dragMoved = false, lastX = 0, lastY = 0;
  let mouseX = 0, mouseY = 0;
  const canvas = renderer.domElement;

  canvas.addEventListener('pointerdown', e => {
    // Left button only. pointerdown/pointerup fire for the RIGHT button too,
    // and letting them through here is what broke move orders: the right
    // button's pointerup ran the selection code, found no soldier under the
    // cursor, cleared the selection, and by the time contextmenu arrived there
    // was nothing left to order anywhere.
    if (e.button !== 0) return;
    dragging = true; dragMoved = false; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    if (e.shiftKey && !placement.selected) {
      boxing = true; boxX = e.clientX; boxY = e.clientY;
      selBox.style.cssText += ';display:block';
      selBox.style.left = `${boxX}px`; selBox.style.top = `${boxY}px`;
      selBox.style.width = '0px'; selBox.style.height = '0px';
    }
  });
  canvas.addEventListener('pointerup', e => {
    if (e.button !== 0) return;      // see pointerdown
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    dragging = false;

    if (boxing) {
      boxing = false;
      selBox.style.display = 'none';
      // Test in SCREEN space, the space the box was drawn in. A world-space
      // box built from the two corners is a different region entirely once the
      // camera is isometric, and selected nothing.
      const lx = Math.min(boxX, e.clientX), hx = Math.max(boxX, e.clientX);
      const ly = Math.min(boxY, e.clientY), hy = Math.max(boxY, e.clientY);
      const inBox = (px: number, py: number) =>
        px >= lx && px <= hx && py >= ly && py <= hy;
      const n = army.selectWhere(sd => {
        const [px, py] = iso.worldToScreen(sd.x, terrain.heightAt(sd.x, sd.z), sd.z);
        // Feet or chest inside the box: dragging round the visible bodies
        // should work, not only round the patch of ground they stand on.
        return inBox(px, py) || inBox(px, py - SOLDIER_PICK_HEIGHT);
      }, false);
      if (n) state.notify(`${n} selected`, 'info');
      return;
    }

    // plain click with nothing being built: pick a soldier
    if (!dragMoved && !placement.selected) {
      const w = pickWorld(e.clientX, e.clientY);
      if (!army.selectAt(w.x, w.z, e.shiftKey) && !e.shiftKey) army.clearSelection();
      return;
    }

    if (!dragMoved && placement.selected) {
      const pending = placement.selected;
      const spot = placement.hover;
      // A walkable building cannot seal anything off, so it skips the test --
      // which also means painting a large yard never trips "would block the way".
      if (pending && spot && !BUILDINGS[pending].walkable) {
        const [pw, pd] = BUILDINGS[pending].footprint;
        if (wouldSealSomethingOff(spot.x, spot.z, pw, pd)) {
          paths.fill(spot.x, spot.z, pw, pd, false);
          state.notify('That would block the way', 'warn');
          return;
        }
        paths.fill(spot.x, spot.z, pw, pd, false);
      }
      const built = placement.commit();
      if (built) {
        const b = state.buildings[state.buildings.length - 1];
        const [w, d] = b.def.footprint;
        markArea(b.x, b.z, w, d);
        if (!b.def.walkable) markSolid(b.x, b.z, w, d);
        workers.sync();
        staticDirty = true;
        // Keep the tool in hand for anything laid in runs -- yard squares,
        // granary bays, curtain wall.
        if (e.shiftKey || b.def.paintable) refreshOverlay(true);
        else placement.cancel();
      }
      refreshOverlay();
    }
  });
  canvas.addEventListener('pointermove', e => {
    mouseX = e.clientX; mouseY = e.clientY;
    if (boxing) {
      selBox.style.left = `${Math.min(boxX, e.clientX)}px`;
      selBox.style.top = `${Math.min(boxY, e.clientY)}px`;
      selBox.style.width = `${Math.abs(e.clientX - boxX)}px`;
      selBox.style.height = `${Math.abs(e.clientY - boxY)}px`;
      return;
    }
    if (dragging) {
      if (Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY) > 3) dragMoved = true;
      iso.panByPixels(-(e.clientX - lastX), (e.clientY - lastY));
      lastX = e.clientX; lastY = e.clientY;
    }
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault(); iso.zoomBy(e.deltaY > 0 ? -1 : 1);
  }, { passive: false });
  // Double-click a soldier to take every one of his kind. The standard RTS
  // idiom, and the answer to "how do I select all my archers" without hunting
  // for a modifier key.
  canvas.addEventListener('dblclick', e => {
    if (placement.selected) return;
    const w = pickWorld(e.clientX, e.clientY);
    let best: { type: string } | null = null;
    let bestD = 1.0;
    for (const sd of army.soldiers) {
      const d = Math.hypot(sd.x - w.x, sd.z - w.z);
      if (d < bestD) { bestD = d; best = sd; }
    }
    if (!best) return;
    const n = army.selectType(best.type, e.shiftKey);
    state.notify(`${n} ${SOLDIER_TYPES[best.type].label.toLowerCase()}` +
                 `${n === 1 ? '' : 's'} selected`, 'info');
  });

  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    // Right-click is a move order when troops are selected, and only falls back
    // to cancelling a placement when they are not.
    if (!placement.selected && army.selected.length) {
      const w = pickWorld(e.clientX, e.clientY);
      const tx = Math.floor(w.x), tz = Math.floor(w.z);

      // Right-clicking one of your own walls or towers posts them on it
      // rather than walking them into it.
      const post = state.buildings.find(b => {
        if (!canGarrison(b.name)) return false;
        const [bw, bd] = b.def.footprint;
        return tx >= b.x && tx < b.x + bw && tz >= b.z && tz < b.z + bd;
      });
      if (post) {
        const [bw, bd] = post.def.footprint;
        const n = army.orderGarrison(post.x, post.z,
                                     post.x + bw / 2, post.z + bd / 2,
                                     Math.max(bw, bd) * 0.3);
        state.notify(n ? `${n} to the ${post.def.label.toLowerCase()}`
                       : 'They cannot reach it', n ? 'info' : 'warn');
        return;
      }

      const n = army.orderMove(w.x, w.z);
      if (!n) state.notify('They cannot reach there', 'warn');
      return;
    }
    placement.cancel();
  });

  const keys = new Set<string>();
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    keys.add(k);
    if (k === 'r') { iso.rotateBy(1); }
    if (k === 'e') { iso.rotateBy(-1); }
    if (k === '+' || k === '=') iso.zoomBy(1);
    if (k === '-') iso.zoomBy(-1);
    if (k === 'escape') { placement.cancel(); refreshOverlay(); }
    if (k === 'm') hud.toggleMarket();
    if (k === 't') hud.toggleStats();
    if (k === 'g') {
      // Debug view: paint every tile a unit is forbidden to walk on.
      // If a figure is ever standing on red, movement is at fault; if it is
      // only ever on clear ground, what looks like walking through a building
      // is a draw-order or overlap question instead.
      debugBlocked = !debugBlocked;
      if (debugBlocked) {
        terrain.setOverlay((x, z) => paths.isBlocked(x, z));
        state.notify('Debug: red = blocked for movement (G to hide)');
      } else {
        refreshOverlay(true);
      }
    }
  });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

  const viewOverride = (() => {
    const v = flags.get('view');
    const m = v?.match(/^(\d+)x(\d+)$/);
    return m ? { w: +m[1], h: +m[2] } : null;
  })();

  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    iso.setViewport(viewOverride ? viewOverride.w : w, viewOverride ? viewOverride.h : h);
  };
  window.addEventListener('resize', resize);
  resize();

  /** Screen pixel -> tile, refined once against the terrain height there. */
  /** Exact ground point under a pixel, not snapped to a tile. */
  function pickWorld(px: number, py: number): { x: number; z: number } {
    let p = iso.screenToGround(px, py, iso.target.y);
    p = iso.screenToGround(px, py, terrain.heightAt(p.x, p.z));
    return { x: p.x, z: p.z };
  }

  /**
   * Recruit one soldier at the barracks.
   *
   * The peasant comes out of the idle pool but stays in `population`: he is
   * still a mouth to feed and still needs a bed. That is the whole cost model
   * now that there is no weapons chain -- gold, goods, and a body that no
   * longer works for you.
   */
  function recruit(type: string): string {
    const def = SOLDIER_TYPES[type];
    if (!def) return 'Unknown soldier';
    const from = state.buildings.find(b => b.name === def.from);
    if (!from) return def.from === 'siege_camp'
      ? 'You need a siege camp' : 'You need a barracks';
    const barracks = from;
    if (state.idle < 1) return 'No idle peasant to take up arms';
    if (state.gold < def.gold) return 'Not enough gold';
    if (!state.canAfford(def.cost)) {
      const missing = Object.entries(def.cost)
        .filter(([r, n]) => state.stock[r as never] < (n ?? 0)).map(([r]) => r);
      return `Not enough ${missing.join(' and ')}`;
    }
    state.gold -= def.gold;
    state.spend(def.cost);
    state.idle -= 1;
    // Spread recruits round the muster point. Spawning them all on the exact
    // same tile stacks them into one sprite and the player cannot click any of
    // them apart.
    const spot = workerWorld.approach(barracks, barracks.x + 1, barracks.z + 3);
    const n = army.soldiers.length;
    const ring = 0.55 + 0.32 * Math.floor(n / 8);
    const ang = (n % 8) / 8 * Math.PI * 2;
    let sx = spot.x + Math.cos(ang) * ring, sz = spot.z + Math.sin(ang) * ring;
    if (paths.isBlocked(Math.floor(sx), Math.floor(sz))) { sx = spot.x; sz = spot.z; }
    army.recruit(type, sx, sz);
    state.notify(`${def.label} recruited`, 'info');
    return 'ok';
  }

  function pickTile(px: number, py: number): { x: number; z: number } {
    let p = iso.screenToGround(px, py, iso.target.y);
    p = iso.screenToGround(px, py, terrain.heightAt(p.x, p.z));
    return { x: Math.floor(p.x), z: Math.floor(p.z) };
  }

  /**
   * Idle townsfolk: walk to your place in the ring at the fire, then stand
   * facing it. Kept as a named function so stepSim() and the render loop run
   * exactly the same code -- an update that lives only in the frame loop is
   * invisible to every headless test.
   */
  /**
   * Idle townsfolk gather at the fire and STAY there, facing it.
   *
   * They no longer wander off: with only a handful idle, one strolling away is
   * a quarter of the crowd gone, and the point of the fire is to show at a
   * glance how many people have no work. Life comes from the idle animation
   * and from re-forming the ring whenever the number of unemployed changes.
   *
   * Called from BOTH the render loop and stepSim() -- an update that lives only
   * in the frame loop is invisible to every headless test.
   */
  function updateWanderers(dt: number): void {
    if (!firePosts.length) rebuildFirePosts();
    const shown = Math.min(wanderers.length, state.idle);
    if (shown !== lastIdleCount) lastIdleCount = shown;

    for (let i = 0; i < shown; i++) {
      const u = wanderers[i];

      if (u.atPost && !u.moving) {
        u.heading = Math.atan2(fire.z - u.z, fire.x - u.x);
        continue;
      }

      if (!u.moving) {
        u.pause -= dt;
        if (u.pause > 0) continue;

        const post = firePost(u.slot);
        if (Math.hypot(post.x - u.x, post.z - u.z) < 0.2) {
          u.atPost = true;
          u.heading = Math.atan2(fire.z - u.z, fire.x - u.x);
          continue;
        }
        const route = paths.find(Math.floor(u.x), Math.floor(u.z),
                                 Math.floor(post.x), Math.floor(post.z));
        if (!route) { u.pause = 1 + Math.random(); continue; }
        u.path = route.slice();
        const tail = u.path.length ? u.path[u.path.length - 1] : { x: u.x, z: u.z };
        if (!paths.isBlocked(Math.floor(post.x), Math.floor(post.z))
            && paths.isLineClear(tail.x, tail.z, post.x, post.z)) {
          u.path.push({ x: post.x, z: post.z });
        }
        u.tx = post.x; u.tz = post.z;
        u.moving = true;
        continue;
      }

      let budget = u.speed * dt;
      u.phase += dt;
      while (budget > 0) {
        const wp = u.path.length ? u.path[0] : { x: u.tx, z: u.tz };
        const dx = wp.x - u.x, dz = wp.z - u.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.06) {
          if (u.path.length) { u.path.shift(); continue; }
          u.moving = false; u.atPost = true; u.pause = 0.1;
          u.heading = Math.atan2(fire.z - u.z, fire.x - u.x);
          break;
        }
        u.heading = Math.atan2(dz, dx);
        if (d <= budget) {
          u.x = wp.x; u.z = wp.z; budget -= d;
          if (u.path.length) u.path.shift();
          else {
            u.moving = false; u.atPost = true; u.pause = 0.1;
            u.heading = Math.atan2(fire.z - u.z, fire.x - u.x);
            break;
          }
        } else {
          u.x += (dx / d) * budget; u.z += (dz / d) * budget; budget = 0;
        }
      }
    }
  }

  // --- loop ---------------------------------------------------------------
  let last = performance.now();
  let syncClock = 0;

  function frame() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    const pan = 420 * dt;
    if (keys.has('arrowleft') || keys.has('a')) iso.panByPixels(-pan, 0);
    if (keys.has('arrowright') || keys.has('d')) iso.panByPixels(pan, 0);
    if (keys.has('arrowup') || keys.has('w')) iso.panByPixels(0, -pan);
    if (keys.has('arrowdown') || keys.has('s')) iso.panByPixels(0, pan);

    // --- simulation ---
    state.tickEconomy(dt);
    regrowForest();
    workers.update(dt);
    syncClock += dt;
    if (syncClock > 1) {
      syncClock = 0;
      state.assignWorkers();
      workers.sync();
      rescueStuckWorkers();
    }

    updateWanderers(dt);
    herd.update(dt, state.elapsed);
    army.update(dt);
    updateRaids(dt);

    // Store sprites are part of the static list, so a pile changing level has to
    // invalidate it. sync() returns true only when what is DRAWN moved, not on
    // every unit deposited, so this rebuilds a few times a minute.
    if (syncStores()) staticDirty = true;

    // --- placement ghost ---
    if (placement.selected) {
      const t = pickTile(mouseX, mouseY);
      const ok = placement.moveTo(t.x, t.z);
      const def = BUILDINGS[placement.selected];
      hud.showGhost(mouseX, mouseY,
        ok ? def.label : placement.lastCheck.reason, ok);
    } else {
      hud.hideGhost();
    }

    drawScene();
    requestAnimationFrame(frame);
  }

  /**
   * Draw one frame.
   *
   * Split out of `frame` so the debug handle can force a redraw with the SAME
   * code the game runs. A hidden tab freezes requestAnimationFrame, and a
   * separate test-only draw path has twice now let me verify something that
   * the real loop was not actually doing.
   */
  function drawScene(): void {
    const rot = iso.rotation;
    if (rot !== builtRotation || staticDirty) rebuildStatic();

    // Gather the moving figures, sort them, then merge into the pre-sorted
    // scenery so the entire scene emits as one back-to-front stream.
    const figures: DrawItem[] = [];
    const addFigure = (x: number, z: number, heading: number,
                       clip: string, phase: number) => {
      const dir = (unitDirectionIndex(heading, rot) + DIRECTION_OFFSET) & 7;
      const n = clipFrames(clip);
      const f = Math.floor(phase * WALK_FPS) % n;
      const key = atlas.frames[`${clip}_${dir}_${f}`]
        ? `${clip}_${dir}_${f}` : `idle_${dir}_0`;
      if (!atlas.frames[key]) return;
      // units are modelled centred on their origin, so no anchor shift
      figures.push({
        key, x, z, y: terrain.heightAt(x, z),
        bias: footprintDepthBias(1, 1, rot),
        depth: depthKey(x, z, rot),
      });
    };

    for (const w of workers.workers) {
      addFigure(w.x, w.z, w.heading, workers.clipFor(w), w.phase);
    }
    for (const sd of army.soldiers) {
      const act = sd.swing > 0 ? 'attack' : sd.moving ? 'walk' : 'idle';
      const clip = `${sd.type}_${act}`;
      const dir = (unitDirectionIndex(sd.heading, rot) + DIRECTION_OFFSET) & 7;
      const n = clipFrames(clip);
      const f = Math.floor(sd.phase * WALK_FPS) % n;
      const key = atlas.frames[`${clip}_${dir}_${f}`] ? `${clip}_${dir}_${f}`
                : atlas.frames[`${sd.type}_idle_${dir}_0`] ? `${sd.type}_idle_${dir}_0`
                : `idle_${dir}_0`;
      if (!atlas.frames[key]) continue;
      // A posted man stands on the walkway, not in the masonry. The extra bias
      // puts him after the wall in the same depth slot, so he is drawn on it
      // rather than behind it.
      const post = sd.garrison;
      const lift = post ? (GARRISON_HEIGHT[buildingNameAt(post.x, post.z)] ?? 0) : 0;
      figures.push({
        key, x: sd.x, z: sd.z, y: terrain.heightAt(sd.x, sd.z) + lift,
        bias: footprintDepthBias(1, 1, rot) + (post ? 0.6 : 0),
        depth: depthKey(sd.x, sd.z, rot),
        // Enemies are the same three bodies under a red cast rather than three
        // more palettes: 288 more sprites to say "not yours" is a poor trade,
        // and side reads faster from colour than from costume anyway.
        tint: sd.side === 'enemy' ? ENEMY_TINT
            : sd.selected ? [1.45, 1.45, 1.15] : undefined,
      });
    }

    for (const a of herd.animals) {
      if (!a.alive) continue;
      // A standing herd with every head down looks like a row of lawnmowers.
      // Real ones keep a couple of sentinels up, so a third of them stand
      // alert instead -- split by id so an individual does not flicker.
      const still = a.id % 3 === 0 ? 'gazelle_idle' : 'gazelle_graze';
      addFigure(a.x, a.z, a.heading, a.moving ? 'gazelle_walk' : still, a.phase);
    }
    const idleShown = Math.min(wanderers.length, state.idle);
    for (let i = 0; i < idleShown; i++) {
      const u = wanderers[i];
      addFigure(u.x, u.z, u.heading, u.moving ? 'walk' : 'idle', u.phase);
    }
    figures.sort((a, b) => a.depth - b.depth);

    sprites.clear();
    let si = 0, fi = 0;
    while (si < staticSorted.length || fi < figures.length) {
      const takeStatic = fi >= figures.length
        || (si < staticSorted.length && staticSorted[si].depth <= figures[fi].depth);
      const it = takeStatic ? staticSorted[si++] : figures[fi++];
      sprites.add(atlas.frames[it.key], atlas.size, atlasPpu,
        it.x, it.y, it.z, it.bias, it.tint);
    }
    sprites.flush();

    // ghost building, tinted green or red, floated in front of everything
    ghostBatch.clear();
    if (placement.selected && placement.hover) {
      // Neither store has a building sprite of its own any more -- they are
      // squares, so the ghost is the empty square.
      const store = BUILDINGS[placement.selected].storeFor;
      const ghostName = store ? STORE_SPRITES[store].empty : placement.selected;
      const frame = atlas.frames[`${ghostName}_${rot}`];
      if (frame) {
        const [w, d] = BUILDINGS[placement.selected].footprint;
        const { x, z } = placement.hover;
        const [gx, gz] = spriteAnchor(x, z, d);
        ghostBatch.add(frame, atlas.size, atlasPpu,
          gx, terrain.heightAt(x, z), gz, footprintDepthBias(w, d, rot) + 6,
          placement.lastCheck.ok ? [0.55, 1.20, 0.55] : [1.30, 0.45, 0.40]);
      }
    }
    ghostBatch.flush();

    renderer.render(scene, iso.camera);
    hud.update();
  }

  /**
   * Advance the simulation without the render loop.
   *
   * The browser throttles requestAnimationFrame in a hidden tab, so testing the
   * economy by waiting on wall-clock time measures the tab's visibility, not
   * the game. This runs the same tick at a fixed step.
   */
  function stepSim(seconds: number, step = 1 / 30): void {
    let left = seconds;
    let sync = 0;
    while (left > 0) {
      const dt = Math.min(step, left);
      left -= dt;
      state.tickEconomy(dt);
      regrowForest();
      workers.update(dt);
      updateWanderers(dt);
      herd.update(dt, state.elapsed);
      army.update(dt);
    updateRaids(dt);
      sync += dt;
      if (sync > 1) {
        sync = 0; state.assignWorkers(); workers.sync(); rescueStuckWorkers();
      }
    }
  }

  // Debug handle: lets the sim be inspected and driven from the console
  // without threading test hooks through the game code.
  (window as unknown as Record<string, unknown>).__game = {
    state, workers, placement, terrain, iso, stepSim,
    redraw: () => {
      if (syncStores()) staticDirty = true;
      drawScene();
    },
    decorations, workerWorld, groundType, regrowing, paths, wanderers, hud, herd, army,
    recruit, atlas, spawnRaid, lord, enemyBuildings,
    lordStatus: () => lord.status(),
    lordAttack: () => lord.attackNow(),
    /** Hold off the next raid. `setNextRaid(Infinity)` disables them. */
    setNextRaid: (t: number) => { nextRaid = t; },
    raidState: () => ({ nextRaid, raidNumber, elapsed: state.elapsed }),
    renderer, scene, sprites,
    occupiedAt: (x: number, z: number) => occupied[z * MAP_W + x],
    regrowForest,
    build: (name: string, x: number, z: number) => {
      const c = placement.check(name, x, z);
      if (!c.ok) return c.reason;
      // same rule the player's click goes through, so tests reflect the game
      const [gw, gd] = BUILDINGS[name].footprint;
      if (!BUILDINGS[name].walkable) {
        if (wouldSealSomethingOff(x, z, gw, gd)) {
          paths.fill(x, z, gw, gd, false);
          return 'would block the way';
        }
        paths.fill(x, z, gw, gd, false);
      }
      placement.select(name);
      placement.moveTo(x, z);
      const built = placement.commit();
      if (built) {
        const b = state.buildings[state.buildings.length - 1];
        markArea(b.x, b.z, b.def.footprint[0], b.def.footprint[1]);
        if (!b.def.walkable) markSolid(b.x, b.z, b.def.footprint[0], b.def.footprint[1]);
        workers.sync();
        staticDirty = true;
      }
      placement.cancel();
      return built ?? 'failed';
    },
    findSpot: (name: string, nearX = kx, nearZ = kz) => {
      for (let r = 0; r < 40; r++) {
        for (let a = 0; a < 32; a++) {
          const ang = (a / 32) * Math.PI * 2;
          const x = Math.round(nearX + Math.cos(ang) * r);
          const z = Math.round(nearZ + Math.sin(ang) * r);
          if (placement.check(name, x, z).ok) return { x, z };
        }
      }
      return null;
    },
  };

  loading.classList.add('done');
  frame();
}

main().catch(err => {
  document.getElementById('loading')!.textContent = `error: ${err.message}`;
  console.error(err);
});
