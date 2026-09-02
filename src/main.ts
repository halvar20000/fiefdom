import * as THREE from 'three';
import { IsoCamera } from './engine/camera';
import { Terrain } from './engine/terrain';
import { SpriteBatch } from './engine/sprites';
import { loadTileArray, buildCombinedAtlas, type CombinedAtlas } from './engine/assets';
import { Audio } from './engine/audio';
import { Projectiles } from './engine/projectiles';
import { reportStaleAssets, missingTiles, missingSprites } from './engine/freshness';
import {
  generateMap, findSite, isBuildable, findStartSite, GROUND_TYPES,
} from './game/worldgen';
import {
  TILE_PX_W, unitDirectionIndex, footprintDepthBias, depthKey, spriteAnchor,
  cameraDirection,
} from './engine/iso';
import { GameState, type PlacedBuilding } from './game/state';
import { PathGrid } from './game/pathfind';
import { Herd, HUNT_RADIUS } from './game/wildlife';
import { Army, PLAYER, SWING_TIME } from './game/army';
import { Lord, type Difficulty } from './game/lord';
import { WorkerPool, totalHeld, type WorkerWorld } from './game/workers';
import { EnemyWorkers } from './game/enemyworkers';
import { Placement, type PlacementWorld } from './game/placement';
import { Hud } from './ui/hud';
import { showMenu } from './ui/menu';
import { showEditor } from './ui/editor';
import { applyCustomMap, hashVariant, type CustomMap } from './game/custom';
import { manableTiles } from './game/access';
import { isTouchUi, isPhoneUi, lockPageGestures, makeTouchPad, attachPinch, type PadMode } from './ui/touch';
import { showPause } from './ui/pause';
import { showGameOver } from './ui/gameover';
import type { MapDef } from './game/maps';
import { SAVE_VERSION, takeBootIntent, readSlot, playTime, type SaveGame } from './game/save';
import { hydrate } from './game/backend';
import {
  BUILDINGS, STORE_SPRITES, SPRITE_STANDIN, SOLDIER_TYPES, buildingHp,
  canGarrison, isWeapon,
  GARRISON_HEIGHT, MARSH_SPEED_FOOT, MARSH_SPEED_SIEGE,
  BURN_SECONDS, BURN_RADIUS, BURN_DPS, IGNITE_RADIUS, DEMOLISH_REFUND,
  SPEED_LEVELS, RESOURCE_LABELS,
  type Resource,
} from './game/defs';

/**
 * Ground colours for the minimap, one per GROUND_TYPES entry.
 *
 * The same swatches the editor's brushes use, so the picture in the corner and
 * the palette you painted with agree about what grass looks like.
 *
 * Module scope, not inside main(): the minimap is rasterised as soon as the
 * HUD exists, which is long before the block these once sat in had run, and a
 * const in its temporal dead zone throws rather than reading as undefined.
 */
const MINI_COLOURS: [number, number, number][] = [
  [201, 169, 120],  // sand
  [157, 154, 94],   // scrub
  [127, 156, 78],   // grass
  [85, 116, 54],    // lush
  [142, 139, 131],  // rock
  [74, 68, 56],     // marsh
  [74, 124, 150],   // water
];

/**
 * The stores that are PAINTED a square at a time, for the loops that lay out
 * piles. The armoury is a shed and draws its own sprite, so it is not here --
 * see STORE_SPRITES, which is the declaration these two follow from.
 */
const STORE_KINDS: readonly ('stockpile' | 'granary')[] = ['stockpile', 'granary'];

const MAP_W = 200;
const MAP_H = 200;
/**
 * Fallback frame rate for a clip whose manifest entry carries no `fps`.
 *
 * Every clip used to be stepped at this flat rate, which is why it is still
 * exactly ten: a clip rendered before the pipeline started emitting a rate --
 * the 0 A.D. motion set, for one -- must keep playing at precisely the speed
 * it always did.
 */
const WALK_FPS = 10;
/**
 * Which sprite index a model's REST pose (Blender rotation 0) occupies.
 *
 * The peasant body -- and every soldier and siege engine cut from the same
 * convention -- is modelled facing Blender -Y, which the engine sees as world
 * +z. Two slots is where that lands once `unitDirectionIndex` has done the
 * heading and camera arithmetic.
 */
const DIRECTION_OFFSET = 2;
/**
 * The gazelle is modelled facing +Y instead (see tools/render/wildlife.py,
 * where BASE_YAW_DEG assumes the peasant faces the same way and it does not),
 * so its rest pose is the opposite one: four slots round from everything else.
 * Compensated here rather than in the renderer so the sprites already on disk
 * stay valid -- turning BASE_YAW_DEG to 180 would mean re-rendering the herd.
 */
const GAZELLE_DIRECTION_OFFSET = (DIRECTION_OFFSET + 4) & 7;
// How many idle peasants are drawn at the fire. Beyond this the crowd stops
// growing visually, though the Unemployed figure keeps counting.
const IDLE_WANDERERS = 48;
/** Minimum gap between two people standing at the fire, in tiles. */
const GATHER_SPACING = 0.85;
/**
 * The longest single simulation step, in seconds.
 *
 * Doubles as the clamp on a real frame's dt -- a stalled tab must not hand the
 * world a two-second stride -- and as the slice size for fast forward, so at 3x
 * the systems still only ever see a step they already cope with.
 */
const MAX_SIM_STEP = 0.1;

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

async function main(chosen: MapDef, restore: SaveGame | null = null,
                    difficulty: Difficulty = 'normal') {
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

  // Say so loudly if the manifests predate the code. Both failure modes are
  // silent: an unknown ground type falls back to sand, and a sprite with no
  // frame is skipped, so the game renders a plausible wrong world in silence.
  reportStaleAssets([
    ...missingTiles(GROUND_TYPES, tiles.index.types),
    ...missingSprites(
      Object.keys(BUILDINGS).filter(n => n !== 'stockpile' && n !== 'granary'),
      atlas.frames),
  ]);

  const terrain = new Terrain({ width: MAP_W, height: MAP_H, layers: 20 }, tiles.texture);
  scene.add(terrain.mesh);
  // A hand-drawn map carries its own tiles; a shipped one is regenerated from
  // its seed. Both return the same shape, so nothing below cares which it is.
  const { flatTiles, groundType } = chosen.custom
    ? applyCustomMap(terrain, tiles.layerOf, chosen.custom as CustomMap)
    : generateMap(terrain, tiles.layerOf, chosen);

  // ONE batch for the whole scene. Everything is drawn in a single
  // back-to-front stream so people, buildings and trees interleave correctly.
  const sprites = new SpriteBatch(atlas.texture, 40000);
  const ghostBatch = new SpriteBatch(atlas.texture, 4);
  ghostBatch.mesh.renderOrder = 11;
  scene.add(sprites.mesh);
  scene.add(ghostBatch.mesh);
  const projectiles = new Projectiles();
  scene.add(projectiles.mesh);

  // --- occupancy ----------------------------------------------------------
  // Two grids on purpose. `occupied` decides where you may BUILD and counts
  // trees and rocks; `paths.blocked` decides where units may WALK and counts
  // only buildings. Making scatter block movement as well turns a palm grove
  // into a maze and sends woodcutters on long detours around the very tree
  // they are walking to.
  const occupied = new Uint8Array(MAP_W * MAP_H);
  const paths = new PathGrid(MAP_W, MAP_H);

  // Water blocks both grids from the outset, before a single building exists.
  // It is the one ground that is impassable in itself: marsh only slows a
  // column down, but nothing in this game swims, and a lake nobody had marked
  // would be crossed by every unit as though it were sand.
  {
    const WATER = GROUND_TYPES.indexOf('water');
    let n = 0;
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        if (groundType[z * MAP_W + x] !== WATER) continue;
        occupied[z * MAP_W + x] = 1;
        paths.setBlocked(x, z, true);
        n++;
      }
    }
    if (n) console.log(`[map] ${n} tiles of water, impassable`);
  }

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
  const TREES = new Set(['palm', 'olive_tree', 'oak', 'dead_tree']);

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
  /**
   * One colour per rival, troops strong and stone soft.
   *
   * A soldier is twenty-odd pixels and must read as hostile at a glance; a
   * castle covers a third of the screen and the same strength over that much
   * stone reads as a broken render rather than a banner colour.
   */
  const FACTION_COLOURS: {
    name: string; unit: [number, number, number]; stone: [number, number, number];
  }[] = [
    // Red needs the least push: warming warm sandstone reads immediately.
    // Cooling it only neutralises, so blue and violet are pushed harder to
    // land at the same apparent distance from the player's own stone.
    { name: 'the Red Lord',    unit: [1.50, 0.62, 0.55], stone: [1.30, 0.78, 0.70] },
    { name: 'the Blue Lord',   unit: [0.55, 0.80, 1.60], stone: [0.62, 0.86, 1.48] },
    { name: 'the Violet Lord', unit: [1.22, 0.56, 1.50], stone: [1.14, 0.72, 1.36] },
  ];

  /** Gap between off-map raids, once they are switched on at all. */
  const RAID_EVERY = 300;
  // Off by default: the lord provides the pressure. Set a finite value through
  // __game.setNextRaid to bring off-map raiders back.
  let nextRaid = Infinity;
  let raidNumber = 0;

  // Running tallies for the end-of-game score. Peaks rather than final values
  // where the final would undersell the game -- a settlement that grew to 40
  // and was cut back to 12 was still, at its height, a town of 40.
  let peakPop = 0;
  let peakGold = 0;
  let enemyKilled = 0;
  let troopsLost = 0;
  /** Set once the war is decided, so the end screen shows exactly once. */
  let gameEnded = false;

  // --- a lord's "greatness", the same measure for the player and every rival --
  //
  // Comparable by construction: one formula over data both sides have -- the
  // size of the settlement, the worth of the standing army (its gold cost, so
  // quality counts, not just headcount), the extent of the holdings, and the
  // treasury. Weights put people and army first, holdings next, gold a distant
  // last, which is roughly how a Crusader map is actually judged.
  const TITLES: [number, string][] = [
    [0, 'Lord'], [150, 'Knight'], [350, 'Baron'], [600, 'Earl'],
    [900, 'Duke'], [1300, 'Prince'], [1800, 'King'],
  ];
  let titleIdx = 0;          // only ever climbs -- an earned honour is not lost
  let isGreatest = false;    // currently ahead of every living rival
  let standingClock = 0;

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

  /** Everything one rival lord owns. */
  interface Faction {
    id: number;
    name: string;
    unitTint: [number, number, number];
    stoneTint: [number, number, number];
    buildings: EnemyBuilding[];
    keep: { x: number; z: number } | null;
    /** Wall-ring positions and the slot reserved for his gate. */
    ring: [number, number][];
    gate: [number, number] | null;
    lord: Lord;
    defeated: boolean;
  }
  const factions: Faction[] = [];

  /** Every building on the map that is not the player's. */
  const allEnemyBuildings = () => factions.flatMap(f => f.buildings);
  const factionOf = (side: number): Faction | undefined =>
    factions.find(f => f.id === side);

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
      // Anything not on this engine's own side is a target -- which is what
      // lets two rival lords wreck each other's castles without a special case.
      if (s.side !== PLAYER) {
        for (const b of state.buildings) {
          const [w, d] = b.def.footprint;
          consider(b.x, b.z, w, d, (n) => damagePlayerBuilding(b, n));
        }
      }
      for (const f of factions) {
        if (f.id === s.side) continue;
        for (const b of f.buildings) {
          const [w, d] = BUILDINGS[b.name].footprint;
          consider(b.x, b.z, w, d, (n) => damageEnemyBuilding(f, b, n));
        }
      }
      return best;
    },
    onShoot: (kind, fx, fz, tx, tz) => {
      projectiles.fire(kind, fx, terrain.heightAt(fx, fz), fz,
                             tx, terrain.heightAt(tx, tz), tz);
    },
    // A soldier with no soldier to fight may cut down an enemy lord's labourers
    // if any stand within reach. Killing one costs that lord the man and the
    // staffed slot on the building he worked, so the job halts until refilled --
    // which is how thinning his operators actually bites into his economy.
    civilianTarget: (s, reach) => {
      let best: (typeof enemyWorkers.workers)[number] | null = null;
      let bestD = reach;
      for (const w of enemyWorkers.workers) {
        if (w.side === s.side) continue;   // never his own side's people
        const d = Math.hypot(w.x - s.x, w.z - s.z);
        if (d > reach || d >= bestD) continue;
        bestD = d; best = w;
      }
      if (!best) return null;
      const victim = best;
      return {
        x: victim.x, z: victim.z, dist: bestD,
        hit: (amount) => {
          victim.hp -= amount;
          if (victim.hp > 0) return;
          const b = victim.b ?? undefined;
          enemyWorkers.remove(victim);
          factionOf(victim.side)?.lord.loseWorker(b);
        },
      };
    },
  });

  const herd = new Herd({
    blocked: (x, z) => paths.isBlocked(Math.floor(x), Math.floor(z)),
    lineClear: (x1, z1, x2, z2) => paths.isLineClear(x1, z1, x2, z2),
    inBounds: (x, z) => x >= 1 && z >= 1 && x < MAP_W - 1 && z < MAP_H - 1,
  });

  // A hand-placed keep wins over the search. findStartSite scores farmland and
  // rock, which is the right answer for a generated map and the wrong one when
  // the player has said in as many words where they want to begin.
  const placedStart = chosen.custom?.start;
  const start = placedStart
    ? { x: Math.max(6, Math.min(MAP_W - 7, placedStart.x)),
        z: Math.max(6, Math.min(MAP_H - 7, placedStart.z)) }
    : findStartSite(terrain, groundType);
  const cx = start.x, cz = start.z;

  for (const t of flatTiles) {
    const idx = t.z * MAP_W + t.x;
    if (occupied[idx]) continue;
    if (Math.abs(t.x - cx) < 8 && Math.abs(t.z - cz) < 8) continue;
    const g = groundType[idx];
    const r = hash2(t.x * 3 + 11, t.z * 5 + 7);
    let name: string | null = null;
    // Density scales with the map's timber rating, so a wooded valley and a
    // bare drought are the same generator with a different multiplier.
    //
    // These were roughly halved. At the old figures lush ground put something
    // on 40% of its flat tiles and grass on 30%, which is not woodland -- it
    // is a hedge you cannot see your own buildings through, and it made the
    // editor's "Few" setting still read as a forest. 18% and 12% leave ground
    // showing between the trunks, which is what a Crusader map looks like.
    const T = chosen.trees;
    // Lush ground leans to leafy oaks and olives, with a few palms for
    // desert character; open grass is sparser and mixed. The greener foliage
    // now matches the greener turf rather than dotting it with olive.
    if (g === DARK) {
      if (r < 0.055 * T) name = 'oak';
      else if (r < 0.100 * T) name = 'olive_tree';
      else if (r < 0.130 * T) name = 'palm';
      else if (r < 0.185 * T) name = 'bush';
    } else if (g === GRASS) {
      if (r < 0.032 * T) name = 'oak';
      else if (r < 0.060 * T) name = 'olive_tree';
      else if (r < 0.085 * T) name = 'palm';
      else if (r < 0.120 * T) name = 'bush';
    } else if (g === SCRUB) {
      if (r < 0.032 * T) name = 'bush';
      else if (r < 0.036 * T) name = 'dead_tree';
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

  // --- buildable territory --------------------------------------------------
  //
  // You may build within reach of your keep, and NOTHING else lets you build
  // out on the far side of the map -- a settlement is a place, not a sprawl. The
  // one way to claim more ground is stone: a wall, a tower or a gatehouse pushes
  // the border outward around itself, so a castle grows by walling in more land,
  // exactly as in Stronghold. `territory` is where ordinary buildings may go;
  // `territoryEdge` is that plus a margin, where a border piece may be planted to
  // extend the line one step at a time.
  const territory = new Uint8Array(MAP_W * MAP_H);
  const territoryEdge = new Uint8Array(MAP_W * MAP_H);
  const R_KEEP = 22;       // a generous starting settlement
  const R_EXT = 12;        // how far a wall/tower/gate claims around itself
  const EDGE_REACH = 6;    // how far past the border a new wall may be planted
  const BORDER_BUILDINGS = new Set(['wall', 'tower', 'gatehouse']);

  const stampDisc = (grid: Uint8Array, cx: number, cz: number, r: number) => {
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(MAP_W - 1, Math.ceil(cx + r));
    const z0 = Math.max(0, Math.floor(cz - r)), z1 = Math.min(MAP_H - 1, Math.ceil(cz + r));
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
        if (dx * dx + dz * dz <= r2) grid[z * MAP_W + x] = 1;
      }
    }
  };

  function recomputeTerritory(): void {
    territory.fill(0);
    territoryEdge.fill(0);
    for (const b of state.buildings) {
      const isKeep = b.name === 'keep';
      if (!isKeep && !BORDER_BUILDINGS.has(b.name)) continue;
      const [w, d] = b.def.footprint;
      const cx = b.x + w / 2, cz = b.z + d / 2;
      const r = isKeep ? R_KEEP : R_EXT;
      stampDisc(territory, cx, cz, r);
      stampDisc(territoryEdge, cx, cz, r + EDGE_REACH);
    }
  }

  /** Is this footprint on land you may build on -- looser for a border piece? */
  const territoryOk = (name: string, x: number, z: number, w: number, d: number): boolean => {
    const grid = BORDER_BUILDINGS.has(name) ? territoryEdge : territory;
    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) {
        const tx = x + dx, tz = z + dz;
        if (tx < 0 || tz < 0 || tx >= MAP_W || tz >= MAP_H) return false;
        if (!grid[tz * MAP_W + tx]) return false;
      }
    }
    return true;
  };

  const placementWorld: PlacementWorld = {
    isFlat: (x, z, w, d) => isBuildable(terrain, x, z, w, d),
    groundAt: groundName,
    isOccupied: (x, z) =>
      x < 0 || z < 0 || x >= MAP_W || z >= MAP_H ? true : occupied[z * MAP_W + x] === 1,
    inBounds: (x, z, w, d) => x >= 0 && z >= 0 && x + w <= MAP_W && z + d <= MAP_H,
    territoryOk,
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
    // Close enough to be swinging AT the trunk, not standing back from it. Was
    // 0.55, which read as a gap between the woodcutter and the tree he is felling.
    const off = 0.35;
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

    /**
     * The nearest place a load can be dropped: a real store square, or a
     * storehouse if one is closer and has room.
     *
     * A FULL storehouse is skipped rather than preferred-and-refused, so a shed
     * whose carrier has fallen behind quietly stops attracting deliveries
     * instead of becoming a place loads go to be lost.
     */
    nearestDrop(kind, x, z) {
      let best = this.nearestStore(kind, x, z);
      let bestD = best ? (best.x - x) ** 2 + (best.z - z) ** 2 : Infinity;
      // Nothing goes to a storehouse unless the real store exists: otherwise a
      // shed becomes a way to "store" goods the town can never actually reach.
      if (!best) return null;
      for (const b of state.buildings) {
        const cap = b.def.relay;
        if (!cap) continue;
        if (totalHeld(b) >= cap) continue;
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

      // A fisherman works the water, not the lawn behind his hut. Walk to the
      // nearest water, stand on the shore tile beside it, and lean toward the
      // water so the casting animation faces what it is casting into.
      if (b.name === 'fishery') {
        const WATER = GROUND_TYPES.indexOf('water');
        const R = 10;
        let wx = -1, wz = -1, bd = Infinity;
        const x0 = Math.max(0, Math.floor(c.x - R)), x1 = Math.min(MAP_W - 1, Math.floor(c.x + R));
        const z0 = Math.max(0, Math.floor(c.z - R)), z1 = Math.min(MAP_H - 1, Math.floor(c.z + R));
        for (let z = z0; z <= z1; z++) {
          for (let x = x0; x <= x1; x++) {
            if (groundType[z * MAP_W + x] !== WATER) continue;
            const d = (x + 0.5 - c.x) ** 2 + (z + 0.5 - c.z) ** 2;
            if (d < bd) { bd = d; wx = x; wz = z; }
          }
        }
        if (wx < 0) { state.notify('The fishery has no water to work', 'warn'); return null; }
        // the walkable land tile touching that water, nearest the hut
        let sx = -1, sz = -1, sbd = Infinity;
        for (const [dx, dz] of
             [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
          const nx = wx + dx, nz = wz + dz;
          if (nx < 0 || nz < 0 || nx >= MAP_W || nz >= MAP_H) continue;
          if (paths.isBlocked(nx, nz)) continue;         // water and buildings are out
          const d = (nx + 0.5 - c.x) ** 2 + (nz + 0.5 - c.z) ** 2;
          if (d < sbd) { sbd = d; sx = nx; sz = nz; }
        }
        if (sx < 0) return snapOpen({ x: c.x, z: c.z }, w);
        // stand at the shore, nudged toward the water so he faces it
        return snapOpen({ x: sx + 0.5 + (wx - sx) * 0.32, z: sz + 0.5 + (wz - sz) * 0.32 }, w);
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
  // Visible operators for the rival lords. Driven by their real per-building
  // staff, so his castle looks worked and razing a building turns its people
  // out. See src/game/enemyworkers.ts.
  const enemyWorkers = new EnemyWorkers({
    findPath: (fx, fz, tx, tz) => paths.find(Math.floor(fx), Math.floor(fz),
                                             Math.floor(tx), Math.floor(tz)),
    isWalkable: (x, z) => !paths.isBlocked(Math.floor(x), Math.floor(z)),
    groundSpeed,
  });
  const placement = new Placement(placementWorld, state);
  const hud = new Hud(state, placement);
  // --- sound ---------------------------------------------------------------
  const audio = new Audio();
  audio.arm();
  hud.audio = audio;
  hud.syncSound();
  state.onNotice = (text, kind) => {
    audio.play(kind === 'warn' ? 'warn' : 'notice');
    audio.say(text, kind === 'warn');
  };

  hud.setIcons(atlas);
  buildMinimapGround();
  hud.onMinimapPick = (x, z) => {
    iso.target.x = Math.max(0, Math.min(MAP_W, x));
    iso.target.z = Math.max(0, Math.min(MAP_H, z));
    // A zero pan is how the camera's own clamp gets applied from outside;
    // clampTarget is private, and duplicating it here would be a second copy
    // of the bounds to keep in step.
    iso.panByPixels(0, 0);
  };
  hud.onRecruit = (type: string) => recruit(type);
  hud.enemyCount = () => army.enemies.length;
  hud.armyCounts = () => {
    const n: Record<string, number> = {};
    for (const sd of army.mine) n[sd.type] = (n[sd.type] ?? 0) + 1;
    return n;
  };
  // The richest living rival, for the "you vs him" line on the gold chart. The
  // leader is the one worth measuring yourself against; a beaten lord drops out
  // so the comparison follows whoever is actually still in the game.
  hud.rivalGold = () => {
    let best: Faction | null = null;
    for (const f of factions) {
      if (f.defeated) continue;
      if (!best || f.lord.gold > best.lord.gold) best = f;
    }
    return best ? { gold: Math.floor(best.lord.gold), name: best.name } : null;
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
  recomputeTerritory();   // the starting lands, around the keep

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

  /**
   * Buildings that are MEANT to touch, so they skip the spacing rule below.
   *
   * A wall ring, its towers and gate must abut to be continuous; the store
   * squares tile into a yard the same way the player's do; an ox tether is a
   * small post with no roof to overhang. Everything else has a sprite far larger
   * than its footprint -- the roof overhangs a tile or two on every side -- so
   * placed edge to edge they pile into an unreadable heap and bury each other.
   */
  const ENEMY_ABUT = new Set([
    'wall', 'tower', 'gatehouse', 'stockpile', 'granary', 'ox_tether',
  ]);

  /**
   * Would a roofed building here keep clear of its neighbours' overhangs?
   *
   * A one-tile gap against every existing building's real footprint. Buildings
   * that are meant to touch (the wall ring, the store yards) are exempt, so they
   * still tile tight while houses and workshops spread out enough to read.
   */
  const enemyGapOk = (f: Faction, name: string, x: number, z: number): boolean => {
    if (ENEMY_ABUT.has(name)) return true;
    const [w, d] = BUILDINGS[name].footprint;
    for (const o of f.buildings) {
      const [ow, od] = BUILDINGS[o.name].footprint;
      if (x - 1 < o.x + ow && x + w + 1 > o.x
          && z - 1 < o.z + od && z + d + 1 > o.z) return false;
    }
    return true;
  };

  const placeEnemyAt = (f: Faction, name: string, x: number, z: number): boolean => {
    const [w, d] = BUILDINGS[name].footprint;
    if (x < 1 || z < 1 || x + w >= MAP_W - 1 || z + d >= MAP_H - 1) return false;
    if (!isBuildable(terrain, x, z, w, d)) return false;
    if (!enemyTerrainOk(name, x, z)) return false;
    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) if (occupied[(z + dz) * MAP_W + (x + dx)]) return false;
    }
    if (!enemyGapOk(f, name, x, z)) return false;
    f.buildings.push({ name, x, z, hp: buildingHp(BUILDINGS[name]), staff: 0 });
    markArea(x, z, w, d);
    if (!BUILDINGS[name].walkable) markSolid(x, z, w, d);
    return true;
  };

  const placeEnemyNear = (f: Faction, name: string, nx: number, nz: number, radius = 18) => {
    // Spiral out from the reference point and take the FIRST candidate that
    // passes every rule -- terrain, occupancy and the roof-gap. findSite alone
    // only tests level ground and hands back one spot, so once the gap rule can
    // reject it a single miss failed the whole build; searching here instead
    // keeps him building at the same pace while his town spreads out.
    for (let r = 0; r <= radius; r++) {
      for (let a = 0; a < 24; a++) {
        const ang = (a / 24) * Math.PI * 2;
        const x = Math.round(nx + Math.cos(ang) * r);
        const z = Math.round(nz + Math.sin(ang) * r);
        if (placeEnemyAt(f, name, x, z)) return { x, z };
      }
    }
    return null;
  };

  /**
   * Raise one castle per rival the map asks for.
   *
   * Each starts as a keep and a single hovel; everything after that the lord
   * builds and pays for himself. Rivals are pushed apart as well as away from
   * the player -- two castles within siege range of each other would have them
   * grinding each other down before the player had laid a wall.
   */
  (function raiseCastles(): void {
    const want = Math.min(chosen.lords, FACTION_COLOURS.length);
    if (want < 1) { console.log('[lords] this map has no opposition'); return; }

    const dirs: [number, number][] = [
      [1, 1], [-1, -1], [1, -1], [-1, 1], [1, 0], [0, 1], [-1, 0], [0, -1],
    ];
    const placedKeeps: { x: number; z: number }[] = [];

    for (let i = 0; i < want; i++) {
      const colour = FACTION_COLOURS[i];
      const f: Faction = {
        id: i + 1, name: colour.name,
        unitTint: colour.unit, stoneTint: colour.stone,
        buildings: [], keep: null, ring: [], gate: null,
        lord: null as unknown as Lord, defeated: false,
      };

      // A hand-placed keep is taken as an instruction, with only enough search
      // room to find buildable ground under it.
      const wanted = chosen.custom?.keeps?.[i];
      const candidates: [number, number, number][] = wanted
        ? [[Math.max(10, Math.min(MAP_W - 11, wanted.x)),
            Math.max(10, Math.min(MAP_H - 11, wanted.z)), 8]]
        : dirs.map(([dx, dz]) => [
            Math.max(14, Math.min(MAP_W - 15, kx + dx * 72)),
            Math.max(14, Math.min(MAP_H - 15, kz + dz * 72)),
            28,
          ] as [number, number, number])
          // Clamping to the map edge silently collapses the intended 72-tile
          // separation when the player starts near a corner: both keeps land
          // in the same quadrant and the war opens on the doorstep. Trying the
          // farthest surviving direction first fixes that. Deliberately a sort
          // and not a filter -- a minimum-distance filter can empty the list
          // on a cramped map and lose the lord altogether, which is worse than
          // a near neighbour.
          .sort((a, b) => Math.hypot(b[0] - kx, b[1] - kz)
                        - Math.hypot(a[0] - kx, a[1] - kz));

      let sited = false;
      for (const [cx, cz, radius] of candidates) {
        // keep rivals well apart from one another, not just from the player
        if (!wanted && placedKeeps.some(k => Math.hypot(k.x - cx, k.z - cz) < 55)) continue;
        const keepSite = placeEnemyNear(f, 'keep', cx, cz, radius);
        if (!keepSite) continue;

        const c = { x: keepSite.x + 1, z: keepSite.z + 1 };
        f.keep = c;
        placedKeeps.push(c);
        placeEnemyNear(f, 'hovel', keepSite.x - 5, keepSite.z + 3, 10);

        const R = 7;
        const ring: [number, number][] = [];
        for (let k = -R; k <= R - 1; k++) {
          ring.push([c.x + k, c.z - R], [c.x + k, c.z + R],
                    [c.x - R, c.z + k], [c.x + R, c.z + k]);
        }
        f.ring = ring;
        f.gate = [...ring]
          .sort((a, b) => Math.hypot(a[0] - kx, a[1] - kz) - Math.hypot(b[0] - kx, b[1] - kz))
          .find(([wx, wz]) => isBuildable(terrain, wx, wz, 2, 2)) ?? null;

        sited = true;
        console.log(`[lords] ${f.name} at ${c.x},${c.z} — ` +
                    `${Math.round(Math.hypot(c.x - kx, c.z - kz))} tiles from you`);
        break;
      }
      if (!sited) { console.warn(`[lords] nowhere to seat rival ${i + 1}`); continue; }
      factions.push(f);
    }
  })();

  /**
   * Guarantee every rival keep can actually be reached from yours by land.
   *
   * The only things that stop a unit are water and buildings -- cliffs do not --
   * so a river can cut the map in two and strand a lord on the far bank with no
   * crossing anywhere, a game you can neither win nor lose. Where that has
   * happened, carve the shortest ford: turn the water on the cheapest route
   * between the two banks into a strip of dry sand. Runs for a new game and again
   * after a load, since the terrain is regenerated from the seed each time and
   * the ford is not stored in the save.
   */
  function ensureKeepsConnected(): void {
    const WATER = GROUND_TYPES.indexOf('water');
    const SAND = GROUND_TYPES.indexOf('sand');
    const drain = (x: number, z: number) => {
      const t = z * MAP_W + x;
      if (groundType[t] !== WATER) return;
      groundType[t] = SAND;
      terrain.layer[t] = tiles.layerOf('sand', hashVariant(x, z));
      paths.setBlocked(x, z, false);
      occupied[t] = 0;
    };
    const near = (x: number, z: number) => paths.nearestOpen(x, z, 10);
    const home = near(kx, kz);
    if (!home) return;

    let carved = false;
    for (const f of factions) {
      if (!f.keep) continue;
      const there = near(f.keep.x, f.keep.z);
      if (!there) continue;
      // Compare the WALKABLE ground beside each keep, not the keep tiles: a keep
      // is a building, so it has no region of its own and would read as "-1 ===
      // -1", i.e. falsely connected, every time.
      const target = paths.regionAt(there.x, there.z);
      if (target < 0 || paths.regionAt(home.x, home.z) === target) continue;

      const ford = shortestFord(home.x, home.z, target);
      if (!ford) { console.warn(`[map] no ford could reach ${f.name}`); continue; }
      for (const [x, z] of ford) drain(x, z);
      // Widen the crossing to two tiles so it reads as a causeway and a column
      // does not bottleneck single file over it. Only the water beside the ford
      // is drained -- `drain` ignores anything that is not water -- so the banks
      // are left alone. Thickened along whichever axis the ford runs LEAST, i.e.
      // across its length.
      if (ford.length > 1) {
        const xs = ford.map(t => t[0]), zs = ford.map(t => t[1]);
        const runsHorizontal =
          Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
        for (const [x, z] of ford) {
          drain(runsHorizontal ? x : x + 1, runsHorizontal ? z + 1 : z);
        }
      }
      carved = true;
      console.log(`[map] carved a ${ford.length}-tile ford so ${f.name} can be reached`);
    }
    if (carved) { terrain.rebuild(); staticDirty = true; }
  }

  /**
   * The fewest water tiles to turn to land to join a start tile to a target
   * region: a 0-1 breadth-first search where stepping onto land is free and onto
   * water costs one, and a building is never crossed nor carved. Returns the
   * water tiles on the cheapest route, or null if even flooding cannot join them.
   */
  function shortestFord(sx: number, sz: number, targetRegion: number): [number, number][] | null {
    const WATER = GROUND_TYPES.indexOf('water');
    const N = MAP_W * MAP_H;
    const cost = new Int32Array(N).fill(0x7fffffff);
    const prev = new Int32Array(N).fill(-1);
    const isWater = (i: number) => groundType[i] === WATER;
    const passable = (x: number, z: number) =>
      isWater(z * MAP_W + x) || !paths.isBlocked(x, z);   // land or water, never a building
    const buckets: number[][] = [[sz * MAP_W + sx]];
    cost[sz * MAP_W + sx] = 0;

    for (let c = 0; c < buckets.length; c++) {
      const b = buckets[c];
      while (b && b.length) {
        const i = b.pop()!;
        if (cost[i] !== c) continue;                       // stale
        const x = i % MAP_W, z = (i / MAP_W) | 0;
        if (!isWater(i) && paths.regionAt(x, z) === targetRegion) {
          const ford: [number, number][] = [];
          for (let j = i; j !== -1; j = prev[j]) {
            if (isWater(j)) ford.push([j % MAP_W, (j / MAP_W) | 0]);
          }
          return ford;
        }
        for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]] as const) {
          if (nx < 0 || nz < 0 || nx >= MAP_W || nz >= MAP_H) continue;
          if (!passable(nx, nz)) continue;
          const ni = nz * MAP_W + nx;
          const nc = c + (isWater(ni) ? 1 : 0);
          if (nc < cost[ni]) {
            cost[ni] = nc; prev[ni] = i;
            (buckets[nc] ||= []).push(ni);
          }
        }
      }
    }
    return null;
  }

  /**
   * Find somewhere for the lord to put a building.
   *
   * Scans outward from his keep rather than using findSite, because findSite
   * only checks that the ground is level -- a farm also needs green land, and
   * the first level patch is very often the wrong sort of ground.
   */
  function findEnemySite(f: Faction, name: string, maxR = 26,
                        anchor?: { x: number; z: number }): [number, number] | null {
    if (!f.keep) return null;
    const [w, d] = BUILDINGS[name].footprint;
    const c = anchor ?? f.keep;
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
        if (clear && enemyGapOk(f, name, x, z)) return [x, z];
      }
    }
    return null;
  }

  /** Build one thing for the lord. Returns false if there is nowhere to put it. */
  function lordBuild(f: Faction, name: string): boolean {
    if (name === 'wall') {
      for (const [wx, wz] of f.ring) {
        // keep the gate's 2x2 and a tile of clearance either side of it free
        if (f.gate && Math.abs(wx - f.gate[0]) <= 2
                   && Math.abs(wz - f.gate[1]) <= 2) continue;
        if (occupied[wz * MAP_W + wx]) continue;
        if (placeEnemyAt(f, 'wall', wx, wz)) { staticDirty = true; return true; }
      }
      return false;
    }
    if (name === 'tower') {
      // A tower belongs ON the wall line, at a corner if one is free.
      const corners = f.ring.filter(([wx, wz]) =>
        f.keep && Math.abs(wx - f.keep.x) === 7 && Math.abs(wz - f.keep.z) === 7);
      for (const [wx, wz] of [...corners, ...f.ring]) {
        if (f.gate && Math.abs(wx - f.gate[0]) <= 3
                   && Math.abs(wz - f.gate[1]) <= 3) continue;
        if (placeEnemyAt(f, 'tower', wx, wz)) { staticDirty = true; return true; }
      }
      return false;
    }
    if (name === 'gatehouse') {
      if (!f.gate) return false;
      const ok = placeEnemyAt(f, 'gatehouse', f.gate[0], f.gate[1]);
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
      const orphan = f.buildings.find(q => q.name === 'quarry'
        && !f.buildings.some(o => o.name === 'ox_tether'
          && Math.abs(o.x - q.x) < 14 && Math.abs(o.z - q.z) < 14));
      if (orphan) anchor = { x: orphan.x, z: orphan.z };
    }
    const site = findEnemySite(f, name, 26, anchor);
    if (!site) return false;
    const ok = placeEnemyAt(f, name, site[0], site[1]);
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
  /**
   * Pixels per world unit for ONE frame, at the scale that frame was baked at.
   *
   * Not a single constant for the atlas: sprites are allowed to differ (see
   * `Frame.scale`), and reading the atlas-wide scale for all of them drew any
   * sprite baked at a lower one half again too large.
   */
  const ppuOf = (f: { scale: number }) =>
    (TILE_PX_W / Math.SQRT2) * (f.scale || atlas.scale);
  const clipFrames = (clip: string) => atlas.clips[clip]?.frames ?? 1;
  /** Frames per second for a clip, so its cycle keeps its length. */
  const clipFps = (clip: string) => atlas.clips[clip]?.fps ?? WALK_FPS;
  /** Must match DEATH_TIME in army.ts -- the death clip's play length. */
  const DEATH_SECONDS = 1.1;

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
      const e = army.recruit(type, spot.x, spot.z, factions[0]?.id ?? 1);
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
    for (const f of factions) f.lord.update(dt);
    if (nextRaid !== Infinity && state.elapsed >= nextRaid) {
      spawnRaid();
      nextRaid = state.elapsed + RAID_EVERY;
    }
    for (const f of army.lastFallen) {
      if (f.side === PLAYER) {
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


  /** A tile of pitch currently alight. */
  interface Fire { x: number; z: number; until: number; seed: number }
  const fires: Fire[] = [];

  /**
   * Light every ditch the enemy is standing in, and let it run.
   *
   * Fire spreads through the connected ditch network rather than burning only
   * the tile that was lit. That is what makes laying a LINE of them worth the
   * pitch: the enemy steps on one end of it and the whole trench goes up.
   *
   * Returns how many tiles caught.
   */
  function lightPitch(): number {
    const ditches = state.buildings.filter(b => b.name === 'pitch_ditch');
    if (!ditches.length) return 0;
    const at = new Map<string, PlacedBuilding>();
    for (const b of ditches) at.set(`${b.x},${b.z}`, b);

    // seeds: ditches with an enemy close enough to be worth the pitch
    const queue: PlacedBuilding[] = ditches.filter(b =>
      army.enemies.some(e =>
        Math.hypot(e.x - (b.x + 0.5), e.z - (b.z + 0.5)) <= IGNITE_RADIUS));
    if (!queue.length) return 0;

    const seen = new Set<string>();
    const caught: PlacedBuilding[] = [];
    while (queue.length) {
      const b = queue.shift()!;
      const key = `${b.x},${b.z}`;
      if (seen.has(key)) continue;
      seen.add(key);
      caught.push(b);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
        const n = at.get(`${b.x + dx},${b.z + dz}`);
        if (n && !seen.has(`${n.x},${n.z}`)) queue.push(n);
      }
    }

    for (const b of caught) {
      fires.push({
        x: b.x, z: b.z, until: state.elapsed + BURN_SECONDS,
        seed: (b.x * 7 + b.z * 13) & 7,
      });
      state.removeBuilding(b);
      markArea(b.x, b.z, 1, 1, 0);
    }
    staticDirty = true;
    audio.play('fire');
    state.notify(`The pitch is alight — ${caught.length} burning!`, 'info');
    return caught.length;
  }

  /**
   * Burn whatever is standing in it.
   *
   * Friend and foe alike. Fire does not check banners, and a player who has to
   * pull his own men clear is making a real decision rather than pressing a
   * free win button.
   */
  function updateFires(dt: number): void {
    if (!fires.length) return;
    for (let i = fires.length - 1; i >= 0; i--) {
      if (state.elapsed >= fires[i].until) fires.splice(i, 1);
    }
    if (!fires.length) return;

    // Burn each man ONCE per tick, however many fires he is standing in.
    //
    // Summing per fire made a line of ditches wildly disproportionate: the
    // radii overlap, so a man in the middle of a trench took triple damage and
    // five spearmen died in under four seconds. A longer line should buy a
    // bigger AREA to deny, not a hotter fire on the same square foot.
    const burning = new Set<number>();
    for (const f of fires) {
      const cx = f.x + 0.5, cz = f.z + 0.5;
      for (const u of army.soldiers) {
        if (u.hp <= 0 || burning.has(u.id)) continue;
        if (Math.hypot(u.x - cx, u.z - cz) <= BURN_RADIUS) burning.add(u.id);
      }
    }
    for (const u of army.soldiers) if (burning.has(u.id)) u.hp -= BURN_DPS * dt;
  }

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
    for (const b of allEnemyBuildings()) {
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

  function damageEnemyBuilding(f: Faction, b: EnemyBuilding, amount: number): void {
    b.hp -= amount;
    if (b.hp > 0) return;
    const [w, d] = BUILDINGS[b.name].footprint;
    const i = f.buildings.indexOf(b);
    if (i >= 0) f.buildings.splice(i, 1);
    evictGarrison(b.x, b.z);
    razeTiles(b.x, b.z, w, d);
    if (b.name === 'barracks') {
      state.notify(`${f.name}'s barracks is destroyed — no more troops!`, 'info');
    }
    if (b.name === 'keep' && !f.defeated) {
      f.defeated = true;
      f.lord.defeated = true;
      const left = factions.filter(o => !o.defeated).length;
      if (left) {
        state.notify(
          `${f.name}'s keep has fallen. ${left} rival${left === 1 ? '' : 's'} left.`, 'info');
      } else {
        state.notify(`${f.name}'s keep has fallen. The field is yours!`, 'info');
        endGame(true);
      }
    }
  }

  /** The player's building standing on this tile, if any. */
  function buildingAt(x: number, z: number): PlacedBuilding | null {
    for (const b of state.buildings) {
      const [w, d] = b.def.footprint;
      if (x >= b.x && z >= b.z && x < b.x + w && z < b.z + d) return b;
    }
    return null;
  }

  /**
   * Pull a building down deliberately.
   *
   * Deliberately the same teardown siege uses -- evict the garrison, free the
   * tiles, resync the workers -- because a building removed two different ways
   * is a building that gets left half-removed by one of them.
   */
  function demolish(b: PlacedBuilding): boolean {
    if (b.name === 'keep') {
      state.notify('The keep cannot be pulled down', 'warn');
      return false;
    }
    const [w, d] = b.def.footprint;
    const back: string[] = [];
    for (const [r, n] of Object.entries(b.def.cost)) {
      const give = Math.floor((n ?? 0) * DEMOLISH_REFUND);
      if (give <= 0) continue;
      state.stock[r as Resource] += give;
      back.push(`${give} ${r}`);
    }
    audio.play('demolish');
    state.removeBuilding(b);
    evictGarrison(b.x, b.z);
    razeTiles(b.x, b.z, w, d);
    if (BORDER_BUILDINGS.has(b.name)) recomputeTerritory();   // the border it held is gone
    workers.sync();
    state.notify(
      back.length
        ? `${b.def.label} pulled down — ${back.join(', ')} recovered`
        : `${b.def.label} pulled down`, 'info');
    return true;
  }

  function damagePlayerBuilding(b: PlacedBuilding, amount: number): void {
    b.hp -= amount;
    if (b.hp > 0) return;
    const [w, d] = b.def.footprint;
    audio.play('destroy');
    state.removeBuilding(b);
    evictGarrison(b.x, b.z);
    razeTiles(b.x, b.z, w, d);
    if (b.name === 'keep' || BORDER_BUILDINGS.has(b.name)) recomputeTerritory();
    state.notify(`Your ${b.def.label.toLowerCase()} has been destroyed!`, 'warn');
    workers.sync();
    // Lose your keep and the fief is lost.
    if (b.name === 'keep') endGame(false);
  }

  /** Roll the peaks and the kill tally forward. Called each tick after combat. */
  function trackStats(): void {
    if (state.population > peakPop) peakPop = state.population;
    if (state.gold > peakGold) peakGold = state.gold;
    for (const s of army.lastFallen) {
      if (s.side === PLAYER) troopsLost++; else enemyKilled++;
    }
  }

  /** One lord's greatness -- the same formula for the player and every rival. */
  function greatness(side: number): number {
    let pop: number, gold: number, buildings: number;
    if (side === PLAYER) {
      pop = state.population; gold = state.gold; buildings = state.buildings.length;
    } else {
      const f = factionOf(side);
      pop = f?.lord.population ?? 0; gold = f?.lord.gold ?? 0;
      buildings = f?.buildings.length ?? 0;
    }
    const armyWorth = army.of(side)
      .reduce((n, s) => n + (SOLDIER_TYPES[s.type]?.gold ?? 20), 0);
    return pop * 8 + armyWorth * 0.6 + buildings * 5 + gold * 0.02;
  }

  /** The title the player's own score has earned, as an index into TITLES. */
  function titleFor(score: number): number {
    let i = 0;
    for (let k = 0; k < TITLES.length; k++) if (score >= TITLES[k][0]) i = k;
    return i;
  }

  /**
   * Announce a rising title and a change in standing against the living rivals.
   *
   * Two separate ideas on purpose. The TITLE is absolute -- earned from the
   * player's own greatness, never taken back -- so it gives a sense of rising
   * even on a map with no rivals to measure against. "Greatest in the land" is
   * comparative and can be lost; the margins (ahead by a tenth to claim it, back
   * under a twentieth to lose it) keep two close lords from trading the title
   * every few seconds.
   */
  function checkStanding(): void {
    const score = greatness(PLAYER);
    const t = titleFor(score);
    if (t > titleIdx) {
      titleIdx = t;
      state.notify(`Your standing rises — you are now a ${TITLES[t][1]}.`, 'info');
      audio.say(`You are now a ${TITLES[t][1]}.`);
    }

    const rivals = factions.filter(f => !f.defeated);
    if (!rivals.length) return;   // nobody to be greater THAN; the title carries it
    const best = Math.max(...rivals.map(f => greatness(f.id)));
    if (!isGreatest && score > best * 1.1) {
      isGreatest = true;
      state.notify('You are now the greatest lord in the land!', 'info');
      audio.say('You are the greatest lord in the land.');
    } else if (isGreatest && score < best * 0.95) {
      isGreatest = false;
      state.notify('A rival lord has surpassed you in greatness.', 'warn');
      audio.say('A rival lord has surpassed you.', true);
    }
  }

  /**
   * End the game and show the tally. Runs exactly once.
   *
   * On a win the rivals' castles are put to the torch and cleared from the map,
   * their leaderless troops quit the field and their workers go with the walls,
   * so the field the player surveys is genuinely theirs rather than a frozen
   * enemy town they can no longer touch.
   */
  function endGame(win: boolean): void {
    if (gameEnded) return;
    gameEnded = true;
    nextRaid = Infinity;

    if (win) {
      for (const f of factions) {
        for (const b of [...f.buildings]) {
          const [w, d] = BUILDINGS[b.name].footprint;
          fires.push({
            x: Math.floor(b.x + w / 2), z: Math.floor(b.z + d / 2),
            until: state.elapsed + BURN_SECONDS, seed: (b.x * 7 + b.z * 13) & 7,
          });
          evictGarrison(b.x, b.z);
          razeTiles(b.x, b.z, w, d);
        }
        f.buildings.length = 0;
      }
      army.soldiers = army.soldiers.filter(s => s.side === PLAYER);
      enemyWorkers.sync(factions);
      staticDirty = true;
    }

    audio.play(win ? 'notice' : 'warn');
    audio.say(win ? 'The field is yours, my lord.' : 'Our keep has fallen.', !win);

    const defeated = factions.filter(f => f.defeated).length;
    // Final standing. A win means every rival keep has fallen, so the player is
    // the last lord standing -- greatest by survival. Otherwise rank by score.
    titleIdx = Math.max(titleIdx, titleFor(greatness(PLAYER)));
    let standing: string;
    if (win || !factions.length) {
      standing = 'Greatest lord in the land';
    } else {
      const scores = [greatness(PLAYER), ...factions.map(f => greatness(f.id))]
        .sort((a, b) => b - a);
      const rank = scores.indexOf(greatness(PLAYER)) + 1;
      const nth = ['', '1st', '2nd', '3rd', '4th'][rank] ?? `${rank}th`;
      standing = `${nth} of ${scores.length} lords`;
    }
    showGameOver({
      win,
      stats: [
        { label: 'Time', value: playTime(state.elapsed) },
        { label: 'Title earned', value: TITLES[titleIdx][1] },
        { label: 'Standing', value: standing },
        { label: 'Largest settlement', value: `${peakPop} people` },
        { label: 'Gold amassed', value: Math.floor(peakGold) },
        { label: 'Popularity', value: `${Math.round(state.popularity)}%` },
        { label: 'Buildings standing', value: state.buildings.length },
        { label: 'Rival lords defeated', value: `${defeated} of ${factions.length}` },
        { label: 'Enemy troops destroyed', value: enemyKilled },
        { label: 'Men lost', value: troopsLost },
      ],
      onStay: () => {},
    });
  }

  /**
   * Give every rival his own Lord, each closed over his own castle.
   *
   * A lord's target is the NEAREST keep that is not his, so rivals march on
   * each other as readily as on the player. That is the whole reason to have
   * more than one: the map becomes a three-cornered war the player can let
   * burn for a while rather than two armies pointed at each other.
   */
  for (const f of factions) {
    f.lord = new Lord(army, {
      buildings: () => f.buildings,
      build: (name: string) => lordBuild(f, name),
      // Found LIVE: he builds his barracks partway through and may lose it.
      muster: () => {
        const bar = f.buildings.find(b => b.name === 'barracks');
        return bar ? { x: bar.x + 1, z: bar.z + 4 } : null;
      },
      home: () => f.keep ?? { x: kx, z: kz },
      /**
       * Who this lord marches on.
       *
       * Nearest-keep alone does not work. The player starts near the middle
       * and the rivals ring the map, so the player is nearest to ALL of them --
       * measured on a three-lord map, 104 against 145/110, 42 against 145/92,
       * 81 against 110/92. Three lords all beelining the player is just one
       * lord tripled, and strictly worse for the player than having one.
       *
       * So the player's distance is weighted UP, heavily at first and less as
       * the game goes on. Early the rivals carve each other up while the
       * player builds; late they turn on him. That arc is the whole reason to
       * put more than one lord on a map.
       */
      target: () => {
        const from = f.keep;
        if (!from) return null;
        const t = Math.min(1, f.lord.elapsed / 1800);
        const aversion = 2.6 - 1.6 * t;      // 2.6 early, 1.0 by 30 minutes

        let best: { x: number; z: number } | null = null;
        let bestScore = Infinity;
        const weigh = (p: { x: number; z: number }, factor: number) => {
          const score = Math.hypot(p.x - from.x, p.z - from.z) * factor;
          if (score < bestScore) { bestScore = score; best = p; }
        };

        const mine = state.buildings.find(b => b.name === 'keep');
        if (mine) weigh({ x: mine.x + 1, z: mine.z + 1 }, aversion);
        for (const o of factions) {
          if (o.id === f.id || o.defeated || !o.keep) continue;
          weigh(o.keep, 1);
        }
        return best;
      },
      garrisonPost: () => {
        // Prefer a tower, then the gatehouse, then any wall he has not manned.
        const rank = (n: string) => n === 'tower' ? 0 : n === 'gatehouse' ? 1 : 2;
        const reach = manableTiles(f.buildings);
        const posts = f.buildings
          .filter(b => canGarrison(b.name))
          .sort((a, b) => rank(a.name) - rank(b.name));
        for (const b of posts) {
          // Same rule the player plays by: an unreachable wall cannot be
          // manned, so the lord does not try and his men do not pile up
          // walking to a wall they can never climb.
          if (b.name === 'wall' && !reach.has(`${b.x},${b.z}`)) continue;
          const [w, d] = BUILDINGS[b.name].footprint;
          // Spread them along the battlements: a generous cap put the whole
          // garrison on one gatehouse and left the rest of the wall bare.
          const cap = b.name === 'wall' ? 1 : 3;
          // Count men still walking there, or a whole garrison is assigned to
          // the same post in one tick before any of them has arrived.
          const inbound = army.soldiers.filter(u => u.mountAt
            && u.mountAt.x === b.x && u.mountAt.z === b.z).length;
          if (army.garrisonOf(b.x, b.z).length + inbound >= cap) continue;
          return { x: b.x, z: b.z, cx: b.x + w / 2, cz: b.z + d / 2 };
        }
        return null;
      },
      notify: (t: string) => state.notify(`${f.name}: ${t}`, 'warn'),
    }, f.id, difficulty);
  }

  /**
   * The atlas key a building draws, falling back to its stand-in.
   *
   * Null when neither exists, which is the caller's cue to draw nothing at all
   * -- the same behaviour a missing frame always had. See SPRITE_STANDIN for
   * why a building might not have its own art.
   */
  function spriteKey(name: string, rot: number): string | null {
    const own = `${name}_${rot}`;
    if (atlas.frames[own]) return own;
    const alias = SPRITE_STANDIN[name];
    const key = alias ? `${alias}_${rot}` : null;
    return key && atlas.frames[key] ? key : null;
  }

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
      const key = spriteKey(name, rot);
      if (!key) return;
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
      const art = STORE_SPRITES[kind]!;
      for (const p of state.layoutFor(kind).piles) {
        squareAt.set(`${p.x},${p.z}`,
          p.res && p.level > 0 ? `${art.prefix}_${p.res}_${p.level}` : art.empty);
      }
    }
    for (const b of state.buildings) {
      const [w, d] = b.def.footprint;
      // A PAINTED store draws the square and whatever is stacked on it. A store
      // with no square art -- the armoury -- falls through and draws itself.
      const art = b.def.storeFor ? STORE_SPRITES[b.def.storeFor] : undefined;
      if (art) {
        push(squareAt.get(`${b.x},${b.z}`) ?? art.empty, b.x, b.z, 1, 1);
        continue;
      }
      push(b.name, b.x, b.z, w, d);
    }

    // Each rival's castle, under his own colour.
    for (const f of factions) {
      for (const b of f.buildings) {
        const [w, d] = BUILDINGS[b.name].footprint;
        push(b.name, b.x, b.z, w, d, f.stoneTint);
      }
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

  // The military rally flag: where a newly recruited soldier or engine marches
  // to, so an army musters at the front instead of at the barracks door. One
  // per player -- recruitment is already global (it draws from the first
  // barracks or siege camp), so one flag governs everything that comes out.
  let rallyPoint: { x: number; z: number } | null = null;
  let placingRally = false;
  const rallyFlag = document.createElement('div');
  rallyFlag.style.cssText = 'position:fixed;pointer-events:none;display:none;'
    + 'z-index:22;transform:translate(-2px,-100%);font-size:22px;line-height:1;'
    + 'filter:drop-shadow(0 2px 2px rgba(0,0,0,.6))';
  rallyFlag.textContent = '\u{1F6A9}';   // a flag the eye finds at a glance
  document.body.appendChild(rallyFlag);

  function armRally(): void {
    placement.cancel();
    if (hud.demolishing) hud.setDemolish(false);
    placingRally = true;
    document.body.style.cursor = 'crosshair';
    hud.openDrawer(null);   // on a phone, get the sheet off the map to place it
    state.notify('Click where new troops should gather', 'info');
  }
  hud.onSetRally = armRally;

  // A stance toggle that shows itself only while troops are selected, so it is
  // there when it is useful and gone when it is not. Works by tap or click, so
  // it covers phone and desktop without another key or thumb-bar button. Its
  // label and position are refreshed each frame in the loop below.
  const stanceBtn = document.createElement('button');
  stanceBtn.id = 'stance';
  stanceBtn.style.cssText = 'position:fixed;z-index:26;display:none;'
    + 'left:50%;transform:translateX(-50%);padding:7px 14px;'
    + 'font:600 13px ui-monospace,SFMono-Regular,Menlo,monospace;color:#ecdfc2;'
    + 'background:rgba(24,19,12,.94);border:1px solid rgba(196,162,96,.34);'
    + 'border-radius:8px;box-shadow:0 3px 12px rgba(0,0,0,.5);cursor:pointer;'
    + '-webkit-tap-highlight-color:transparent;touch-action:manipulation';
  stanceBtn.addEventListener('pointerup', e => {
    e.preventDefault(); e.stopPropagation(); toggleHold();
  });
  document.body.appendChild(stanceBtn);

  /**
   * Scratch buffer for the trouble markers, and a cap on them.
   *
   * The cap is not for speed -- it is that forty badges at once is a wall of
   * orange that says nothing. If the whole town is unstaffed the player has one
   * problem, not forty, and the population figure already tells them so.
   */
  const troubleBuf: { x: number; y: number; text: string }[] = [];
  const miniDots: { x: number; z: number; c: string; big?: boolean }[] = [];
  const MAX_FLAGS = 12;

  let dragging = false, dragMoved = false, lastX = 0, lastY = 0;
  let mouseX = 0, mouseY = 0;
  // Touch has no double-click event to speak of, so a second quick tap near the
  // first is detected by hand -- the "select all of this kind" idiom otherwise
  // has no way in on a phone.
  let lastTapT = 0, lastTapX = 0, lastTapY = 0;
  const canvas = renderer.domElement;
  // Whether the touch pad's command mode is on; replaced once the pad exists.
  let touchCommand = (): boolean => false;
  // Two fingers down means a pinch, not a pan; set by attachPinch below.
  const pinching = () => (canvas as unknown as { pinching?: () => boolean }).pinching?.() ?? false;

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

    // Planting the rally flag comes before everything else: while the tool is
    // armed a click on the map is the flag, not a selection or an order. A drag
    // is a pan to look around first, so it leaves the tool armed.
    if (placingRally) {
      if (!dragMoved) {
        placingRally = false;
        document.body.style.cursor = '';
        const w = pickWorld(e.clientX, e.clientY);
        const tx = Math.floor(w.x), tz = Math.floor(w.z);
        const on = buildingAt(tx, tz);
        if (on && (on.name === 'barracks' || on.name === 'siege_camp')) {
          rallyPoint = null;
          state.notify('Rally point cleared — troops muster at the barracks', 'info');
        } else if (tx >= 0 && tz >= 0 && tx < MAP_W && tz < MAP_H && !paths.isBlocked(tx, tz)) {
          rallyPoint = { x: tx + 0.5, z: tz + 0.5 };
          state.notify('Rally point set — new troops will gather here', 'info');
        } else {
          state.notify('Cannot set a rally point there', 'warn');
        }
      }
      return;
    }

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

    // Demolition, when the tool is in hand. Checked before soldier selection,
    // or a click on a garrisoned tower would pick the man rather than pull the
    // tower down.
    if (!dragMoved && hud.demolishing) {
      const w = pickWorld(e.clientX, e.clientY);
      const b = buildingAt(Math.floor(w.x), Math.floor(w.z));
      if (b) {
        demolish(b);
        // Stays armed: clearing a misplaced row is several clicks, and Esc or
        // the button turns it off.
        if (!e.shiftKey) refreshOverlay(true);
      } else {
        state.notify('Nothing there to pull down', 'warn');
      }
      return;
    }

    // plain click with nothing being built: pick a soldier -- unless the touch
    // pad is in command mode, where a tap is the missing right-click and orders
    // the selected troops instead of reselecting.
    if (!dragMoved && !placement.selected) {
      if (touchCommand() && army.selected.length) {
        issueOrderAt(e.clientX, e.clientY);
        return;
      }
      const w = pickWorld(e.clientX, e.clientY);
      // Touch has no shift and no reliable double-click, so selection works by
      // accumulation instead: each tap toggles a soldier into the group, a tap
      // on empty ground clears it, and a quick second tap on the same man takes
      // his whole kind. This is the only way to post more than one soldier on a
      // phone -- without it every tap replaced the selection and just one could
      // ever be sent to a wall.
      if (e.pointerType === 'touch') {
        const now = performance.now();
        const dbl = now - lastTapT < 350
          && Math.abs(e.clientX - lastTapX) < 24 && Math.abs(e.clientY - lastTapY) < 24;
        lastTapT = now; lastTapX = e.clientX; lastTapY = e.clientY;
        if (dbl && selectTypeAt(e.clientX, e.clientY, false)) return;
        if (!army.selectAt(w.x, w.z, true, true)) army.clearSelection();
        return;
      }
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
        audio.play('place');
        const b = state.buildings[state.buildings.length - 1];
        const [w, d] = b.def.footprint;
        markArea(b.x, b.z, w, d);
        if (!b.def.walkable) markSolid(b.x, b.z, w, d);
        if (BORDER_BUILDINGS.has(b.name)) recomputeTerritory();   // a wall claims new ground
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
    if (dragging && !pinching()) {
      if (Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY) > 3) dragMoved = true;
      iso.panByPixels(-(e.clientX - lastX), (e.clientY - lastY));
      lastX = e.clientX; lastY = e.clientY;
    }
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault(); iso.zoomBy(e.deltaY > 0 ? -1 : 1);
  }, { passive: false });
  /**
   * Take every soldier of the kind nearest a screen point. The "select all my
   * archers" idiom, reached by a double-click on desktop and a double-tap on
   * touch (where there is no double-click event). Returns whether it hit anyone.
   */
  function selectTypeAt(clientX: number, clientY: number, add: boolean): boolean {
    if (placement.selected) return false;
    const w = pickWorld(clientX, clientY);
    let best: { type: string } | null = null;
    let bestD = 1.0;
    for (const sd of army.soldiers) {
      const d = Math.hypot(sd.x - w.x, sd.z - w.z);
      if (d < bestD) { bestD = d; best = sd; }
    }
    if (!best) return false;
    const n = army.selectType(best.type, add);
    state.notify(`${n} ${SOLDIER_TYPES[best.type].label.toLowerCase()}` +
                 `${n === 1 ? '' : 's'} selected`, 'info');
    return true;
  }

  canvas.addEventListener('dblclick', e => { selectTypeAt(e.clientX, e.clientY, e.shiftKey); });

  /**
   * Flip the selected troops between holding ground and going on the attack.
   *
   * A toggle so one control does both: if the whole selection is already
   * holding, this releases them; otherwise it sets them to hold. Held soldiers
   * stand where they are and only strike what comes into reach.
   */
  function toggleHold(): void {
    const sel = army.selected;
    if (!sel.length) { state.notify('Select troops first', 'warn'); return; }
    const on = !army.allHolding;
    army.setHold(on);
    state.notify(on
      ? `${sel.length} holding ground — they will not give chase`
      : `${sel.length} on the attack`, 'info');
  }

  /**
   * Order the selected troops to a screen point: post them on a wall if it is
   * one they can reach, otherwise march them there. Returns true if it did
   * something, so the caller knows whether to fall through.
   *
   * Extracted from the right-click handler so a touch "command" tap can issue
   * exactly the same order without a right button to press.
   */
  function issueOrderAt(clientX: number, clientY: number): boolean {
    if (placement.selected || !army.selected.length) return false;
    const w = pickWorld(clientX, clientY);
    const tx = Math.floor(w.x), tz = Math.floor(w.z);

    const post = state.buildings.find(b => {
      if (!canGarrison(b.name)) return false;
      const [bw, bd] = b.def.footprint;
      return tx >= b.x && tx < b.x + bw && tz >= b.z && tz < b.z + bd;
    });
    if (post) {
      if (!manableTiles(state.buildings).has(`${post.x},${post.z}`)) {
        state.notify('No stair to that wall — anchor it with a tower or gatehouse',
                     'warn');
        return true;
      }
      const [bw, bd] = post.def.footprint;
      const n = army.orderGarrison(post.x, post.z,
                                   post.x + bw / 2, post.z + bd / 2,
                                   Math.max(bw, bd) * 0.3);
      state.notify(n ? `${n} to the ${post.def.label.toLowerCase()}`
                     : 'They cannot reach it', n ? 'info' : 'warn');
      return true;
    }

    const n = army.orderMove(w.x, w.z);
    if (!n) state.notify('They cannot reach there', 'warn');
    return true;
  }

  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    // Right-click is a move order when troops are selected, and only falls back
    // to cancelling a placement when they are not.
    if (!issueOrderAt(e.clientX, e.clientY)) placement.cancel();
  });

  // --- touch: a thumb bar, pinch-zoom, and tap-to-order ---------------------
  if (isTouchUi()) {
    document.documentElement.classList.add('touch');
    lockPageGestures();
    // A phone is too narrow for the always-on panels; fold them into on-demand
    // bottom sheets and give the thumb bar the buttons that open them. A tablet
    // keeps the desktop panels and the original bar.
    const phone = isPhoneUi();
    if (phone) hud.enablePhoneLayout();
    const pad = makeTouchPad({
      rotate: (d) => iso.rotateBy(d),
      zoom: (d) => iso.zoomBy(d),
      toggleBuild: () => phone ? hud.openDrawer('build') : hud.toggleBuild(),
      openMap: () => hud.openDrawer('map'),
      openInfo: () => hud.openDrawer('info'),
      pause: () => openPause(),
      onMode: (m: PadMode) => {
        // The map cursor tells you a tap will give an order, not a selection.
        document.body.style.cursor = m === 'command' ? 'crosshair' : '';
      },
    }, phone);
    hud.onDrawerChange = (name) => pad.syncDrawer(name);
    touchCommand = () => pad.mode() === 'command';
    attachPinch(canvas, { zoom: (d) => iso.zoomBy(d) });
  }

  const keys = new Set<string>();

  /**
   * Is the player typing into, or steering, a form control?
   *
   * Buttons are deliberately NOT in this list: arrow keys mean nothing to a
   * button, and a HUD button keeps focus after it is clicked, so excluding
   * them would stop the camera the moment anyone pressed Rations.
   */
  const inFormControl = (): boolean => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA'
        || el.isContentEditable;
  };

  /**
   * Forget every held key.
   *
   * Held keys drive the camera every frame, so one that never gets its keyup
   * pans the view into a corner and stays there. A native <select> popup eats
   * the keyup while it is open, and losing window focus mid-key never delivers
   * one at all -- both left the map scrolling with no way to stop it.
   */
  const releaseKeys = () => keys.clear();
  window.addEventListener('blur', releaseKeys);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseKeys();
  });

  /**
   * Say the new speed, but never while paused.
   *
   * A notice expires on GAME time (`elapsed - at < 6`), and at Pause that clock
   * is not running -- so "Paused" would sit on the screen until the world was
   * started again. The banner says it instead, and it can be cleared.
   */
  function announceSpeed(): void {
    if (!state.paused) state.notify(`Speed: ${SPEED_LEVELS[state.speed].label}`);
  }

  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    // A dropdown or a text box owns the keyboard while it has focus. Adding
    // the key here as well is what stuck the camera: the control swallows the
    // keyup, and the game goes on believing the key is still down.
    if (inFormControl()) { keys.delete(k); return; }
    keys.add(k);
    if (k === 'r') { iso.rotateBy(1); }
    if (k === 'e') { iso.rotateBy(-1); }
    if (k === '+' || k === '=') iso.zoomBy(1);
    if (k === '-') iso.zoomBy(-1);
    if (k === 'escape') {
      // Esc means "back out of what I am doing". With a building in hand that
      // is the building, with the wrecking tool armed it is the tool;
      // otherwise it is the game itself.
      if (placingRally) { placingRally = false; document.body.style.cursor = ''; }
      else if (placement.selected) { placement.cancel(); refreshOverlay(); }
      else if (hud.demolishing) hud.setDemolish(false);
      else openPause();
    }
    if (k === 'f') {
      const n = lightPitch();
      if (!n) {
        state.notify(state.buildings.some(b => b.name === 'pitch_ditch')
          ? 'No enemy in the pitch yet' : 'You have no pitch ditches', 'warn');
      }
    }
    if (k === ' ') {
      // preventDefault twice over: the page would scroll, and a space while a
      // HUD button still holds focus would press that button again.
      e.preventDefault();
      state.togglePause();
      announceSpeed();
    }
    // Not the digits: 1-6 already open the build categories. , and . sit under
    // the fingers that are not on the camera keys.
    if (k === ',' || k === '<') { state.nudgeSpeed(-1); announceSpeed(); }
    if (k === '.' || k === '>') { state.nudgeSpeed(1); announceSpeed(); }
    if (k === 'b') hud.toggleBuild();
    if (k === 'x' || k === 'delete') hud.setDemolish(!hud.demolishing);
    if (k === 'n') hud.toggleMinimap();
    if (k === 'v') {
      // One key to shut it up, because that is the control anyone reaches for
      // in a hurry. Restores to Full rather than to whatever it was: a mute
      // that remembers 'Low' feels like it failed to unmute.
      audio.setVolume(audio.volume > 0 ? 0 : 0.8);
      audio.silence();
      hud.syncSound();
      state.notify(audio.volume > 0 ? 'Sound on' : 'Sound off');
    }
    if (k >= '1' && k <= '6') hud.toggleCategory(Number(k) - 1);
    if (k === 'm') hud.toggleMarket();
    if (k === 't') hud.toggleStats();
    if (k === 'h') toggleHold();
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
   * Three things are spent, and each is a different kind of pressure. GOLD, out
   * of the treasury. A PEASANT, who comes off the idle pool -- and off the
   * population roll, so he stops eating, stops paying tax and frees his bed.
   * And his KIT, taken off the armoury rack: the barracks arms a man, it does
   * not forge for him, so a spear that no poleturner has made is a spearman you
   * cannot raise however much gold you are sitting on.
   *
   * Siege engines are the exception and go on costing timber and iron directly
   * -- an engine is built at the camp rather than issued from a store.
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
      const missing = (Object.entries(def.cost) as [Resource, number][])
        .filter(([r, n]) => state.stock[r] < (n ?? 0));
      const names = missing.map(([r]) => RESOURCE_LABELS[r].toLowerCase());
      // Say where the shortfall has to be made up. "Not enough bows" sends a
      // player to the market; "no bows in the armoury" sends them to a
      // fletcher, which is the answer.
      const kit = missing.every(([r]) => isWeapon(r));
      if (kit && !state.hasStore('armoury')) return 'You need an armoury';
      return kit
        ? `No ${names.join(' or ')} in the armoury`
        : `Not enough ${names.join(' and ')}`;
    }
    state.gold -= def.gold;
    state.spend(def.cost);
    // A recruit LEAVES the town, as in Crusader: off the population roll, not
    // merely off the idle pool. He therefore eats nothing, pays no tax and
    // frees his bed -- and because the bed is free, the ordinary growth drift
    // walks a new peasant in behind him, which is the "unemployed drops by one
    // and immediately comes back" the original is known for.
    //
    // Deliberately left to that drift rather than spawning a replacement here:
    // an instant refill would let an army be raised at any popularity at all,
    // and severing recruitment from popularity removes the one cost that keeps
    // the economy worth playing.
    state.idle -= 1;
    state.population -= 1;
    // Spread recruits round the muster point. Spawning them all on the exact
    // same tile stacks them into one sprite and the player cannot click any of
    // them apart.
    const spot = workerWorld.approach(barracks, barracks.x + 1, barracks.z + 3);
    const n = army.soldiers.length;
    const ring = 0.55 + 0.32 * Math.floor(n / 8);
    const ang = (n % 8) / 8 * Math.PI * 2;
    let sx = spot.x + Math.cos(ang) * ring, sz = spot.z + Math.sin(ang) * ring;
    if (paths.isBlocked(Math.floor(sx), Math.floor(sz))) { sx = spot.x; sz = spot.z; }
    const soldier = army.recruit(type, sx, sz);
    // Send him to the rally flag if one is set. `ordered` keeps him marching
    // there rather than wandering off after the first thing he sees -- the same
    // flag every recruit follows, so an army forms up where you asked.
    if (soldier && rallyPoint && army.send(soldier, rallyPoint.x, rallyPoint.z)) {
      soldier.ordered = true;
    }
    audio.play('recruit');
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
  let paused = false;
  let last = performance.now();
  let syncClock = 0;

  /**
   * One step of the world. The ONLY place the simulation advances.
   *
   * The render loop and the console harness both come through here, so the
   * fixed-step test path and real play cannot disagree about what a tick does.
   */
  function simulateStep(dt: number): void {
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

    if (syncClock === 0) enemyWorkers.sync(factions);   // on the same 1s beat

    updateWanderers(dt);
    herd.update(dt, state.elapsed);
    army.update(dt);
    trackStats();
    standingClock += dt;
    if (standingClock > 6) { standingClock = 0; checkStanding(); }
    updateRaids(dt);
    enemyWorkers.update(dt, factions);
    updateFires(dt);
    projectiles.update(dt);

    // Store sprites are part of the static list, so a pile changing level has to
    // invalidate it. sync() returns true only when what is DRAWN moved, not on
    // every unit deposited, so this rebuilds a few times a minute.
    if (syncStores()) staticDirty = true;
  }

  /**
   * Advance `seconds` of game time, in steps no longer than MAX_SIM_STEP.
   *
   * Fast forward runs MORE steps, never longer ones. Everything that moves
   * integrates as `speed * dt`, and a single 3x step is long enough to carry a
   * man clean through a wall he would have stopped at -- the same reason the
   * loop has always clamped a slow frame's dt rather than trusting it.
   */
  function advanceSim(seconds: number): void {
    let left = seconds;
    while (left > 1e-6) {
      const step = Math.min(MAX_SIM_STEP, left);
      left -= step;
      simulateStep(step);
    }
  }

  function frame() {
    const now = performance.now();
    // Clamp AND discard while paused, so a menu left open for two minutes does
    // not resume by fast-forwarding the settlement through two minutes of
    // starvation the moment it closes.
    const dt = paused ? 0 : Math.min(MAX_SIM_STEP, (now - last) / 1000);
    last = now;
    if (paused) {
      drawScene();
      requestAnimationFrame(frame);
      return;
    }

    const pan = 420 * dt;
    if (keys.has('arrowleft') || keys.has('a')) iso.panByPixels(-pan, 0);
    if (keys.has('arrowright') || keys.has('d')) iso.panByPixels(pan, 0);
    if (keys.has('arrowup') || keys.has('w')) iso.panByPixels(0, -pan);
    if (keys.has('arrowdown') || keys.has('s')) iso.panByPixels(0, pan);

    // --- simulation ---
    // Real seconds scaled by the chosen speed: 0 at Pause, 3x at Fast. The
    // camera, the ghost and the HUD above and below this line stay on real
    // time, so a paused settlement is still one you can look around and plan
    // in -- unlike the Esc menu, which stops the frame outright.
    advanceSim(dt * state.speedMult);

    // --- placement ghost ---
    if (placement.selected) {
      const t = pickTile(mouseX, mouseY);
      const ok = placement.moveTo(t.x, t.z);
      const def = BUILDINGS[placement.selected];
      hud.showGhost(mouseX, mouseY,
        ok ? def.label : placement.lastCheck.reason, ok);
    } else {
      hud.hideGhost();
      // Only when nothing is in hand: during placement the ghost already
      // occupies the cursor, and two boxes chasing it is worse than either.
      // Shown while the wrecking tool is armed too, and especially then:
      // knowing what is about to come down is worth more at that moment than
      // at any other.
      const t = pickTile(mouseX, mouseY);
      const what = describeAt(t.x, t.z);
      if (what) {
        hud.showTip(mouseX, mouseY,
          hud.demolishing && !what.foe ? `Pull down ${what.title}` : what.title,
          what.sub, what.foe);
      } else hud.hideTip();
    }

    updateTroubleFlags();
    updateRallyFlag();
    updateStanceButton();
    updateAmbience(performance.now());
    audio.tickAmbience();
    drawMinimap();
    drawScene();
    requestAnimationFrame(frame);
  }

  /** Keep the flag marker over its world tile, or hidden when none is set. */
  function updateRallyFlag(): void {
    if (!rallyPoint) { rallyFlag.style.display = 'none'; return; }
    const [px, py] = iso.worldToScreen(
      rallyPoint.x, terrain.heightAt(rallyPoint.x, rallyPoint.z), rallyPoint.z);
    rallyFlag.style.left = `${px}px`;
    rallyFlag.style.top = `${py}px`;
    rallyFlag.style.display = 'block';
  }

  /** Show the stance toggle while troops are selected, labelled to their state. */
  function updateStanceButton(): void {
    const n = army.selected.length;
    if (!n) { stanceBtn.style.display = 'none'; return; }
    const holding = army.allHolding;
    stanceBtn.textContent = holding ? '\u{1F6E1} Holding — tap to attack'
                                    : '⚔ Attacking — tap to hold';
    // Sit clear of the thumb bar on a phone, low on the screen on desktop.
    stanceBtn.style.bottom =
      document.documentElement.classList.contains('touch') ? '76px' : '18px';
    stanceBtn.style.display = 'block';
  }

  /** Rasterise the ground once. Cliffs are shaded from the height, not stored. */
  function buildMinimapGround(): void {
    const rgba = new Uint8ClampedArray(MAP_W * MAP_H * 4);
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        const t = z * MAP_W + x;
        const c = MINI_COLOURS[groundType[t]] ?? MINI_COLOURS[0];
        // A flat colour map of a tiered world reads as a paint chart. Shading
        // by elevation is what makes the plateaus and the wadi legible, which
        // is most of what anyone looks at a minimap for.
        const lift = 0.86 + terrain.cornerHeight(x, z) * 0.055;
        rgba[t * 4] = c[0] * lift;
        rgba[t * 4 + 1] = c[1] * lift;
        rgba[t * 4 + 2] = c[2] * lift;
        rgba[t * 4 + 3] = 255;
      }
    }
    hud.setMinimapGround(MAP_W, MAP_H, rgba);
  }

  /**
   * Which building makes which noise.
   *
   * Several kinds share a voice on purpose: a quarry and an iron mine are both
   * a pick on rock, and a market and an inn are both a room full of people.
   * Giving each its own voice would add nodes without adding anything anybody
   * could name blindfolded.
   */
  const AMBIENT_OF: Record<string, string> = {
    quarry: 'quarry', iron_mine: 'quarry',
    // A smithy is a hammer on iron, which is the pick-on-rock voice; a fletcher
    // and a poleturner are both a blade working timber.
    blacksmith: 'quarry', armourer: 'quarry',
    fletcher: 'woodcutter', poleturner: 'woodcutter',
    woodcutter: 'woodcutter',
    mill: 'mill',
    brewery: 'brewery', inn: 'crowd', market: 'crowd',
    pig_farm: 'livestock', dairy_farm: 'livestock', hunter: 'livestock',
  };

  const ambient = new Map<string, { weight: number; pan: number }>();
  let ambientAt = 0;

  /**
   * Work out what is on screen and how loud it should therefore be.
   *
   * Runs four times a second, not every frame. The gains are ramped over a
   * third of a second anyway, so a faster update would be inaudible, and this
   * walks every building and samples the ground.
   */
  function updateAmbience(now: number): void {
    if (now - ambientAt < 250) return;
    ambientAt = now;
    ambient.clear();

    const W = window.innerWidth, H = window.innerHeight;
    const add = (kind: string, sx: number) => {
      const e = ambient.get(kind) ?? { weight: 0, pan: 0 };
      e.weight += 1;
      e.pan += sx;
      ambient.set(kind, e);
    };

    for (const b of state.buildings) {
      const kind = AMBIENT_OF[b.name];
      if (!kind) continue;
      // Only what is actually working: a mill with nobody in it is a still
      // wheel, and hearing it grind is worse than hearing nothing.
      if (b.def.workers && b.staff < b.def.workers) continue;
      const [fw, fd] = b.def.footprint;
      const [sx, sy] = iso.worldToScreen(
        b.x + fw / 2, terrain.heightAt(b.x, b.z), b.z + fd / 2);
      if (sx < 0 || sy < 0 || sx > W || sy > H) continue;
      add(kind, sx);
    }

    // Water and fire come from the ground rather than from buildings, so they
    // are sampled on a coarse screen grid -- 96 probes against 40,000 tiles.
    const WATER = GROUND_TYPES.indexOf('water');
    for (let iy = 0; iy < 8; iy++) {
      for (let ix = 0; ix < 12; ix++) {
        const px = ((ix + 0.5) / 12) * W, py = ((iy + 0.5) / 8) * H;
        const t = pickTile(px, py);
        if (t.x < 0 || t.z < 0 || t.x >= MAP_W || t.z >= MAP_H) continue;
        if (groundType[t.z * MAP_W + t.x] === WATER) add('water', px);
      }
    }
    for (const f of fires) {
      const [sx, sy] = iso.worldToScreen(f.x, terrain.heightAt(f.x, f.z), f.z);
      if (sx < 0 || sy < 0 || sx > W || sy > H) continue;
      add('burning', sx);
    }

    // Turn counts into a weight and an average position.
    //
    // One building starts at half rather than a third of full. Measured at
    // n/3, a lone woodcutter peaked at 0.0125 against a wind bed of 0.005 --
    // present in the mix and inaudible in practice. The curve saturates fast
    // so a quarry district is busy rather than deafening; the interesting
    // difference is none-versus-some, not three-versus-eight.
    for (const [kind, e] of ambient) {
      const n = e.weight;
      e.pan = Math.max(-1, Math.min(1, ((e.pan / n) / W) * 2 - 1)) * 0.8;
      e.weight = kind === 'water'
        ? Math.min(1, n / 12)
        : Math.min(1, 0.5 + (n - 1) * 0.25);
    }
    audio.setAmbience(ambient);
  }

  /** One frame of the minimap: the view outline and everyone's buildings. */
  function drawMinimap(): void {
    // The real screen corners, projected to ground. An outline derived from
    // the camera target and zoom would be an approximation that drifts; this
    // one is exactly what you can see.
    const view: [number, number][] = [
      [0, 0], [window.innerWidth, 0],
      [window.innerWidth, window.innerHeight], [0, window.innerHeight],
    ].map(([px, py]) => {
      const g = pickWorld(px, py);
      return [g.x, g.z] as [number, number];
    });

    miniDots.length = 0;
    const keep = state.buildings.find(b => b.name === 'keep');
    for (const b of state.buildings) {
      if (b === keep) continue;
      miniDots.push({ x: b.x, z: b.z, c: '#f0c869' });
    }
    for (const f of factions) {
      const col = f.id === 1 ? '#e2794f' : f.id === 2 ? '#6f9fd8' : '#b07fd0';
      for (const b of f.buildings) miniDots.push({ x: b.x, z: b.z, c: col });
      if (f.keep) miniDots.push({ x: f.keep.x, z: f.keep.z, c: col, big: true });
    }
    // Keeps last and larger, so they are never buried under their own castle.
    if (keep) miniDots.push({ x: keep.x, z: keep.z, c: '#ffffff', big: true });

    hud.drawMinimap(iso.rotation, view, miniDots);
  }

  /**
   * What is on this tile, in words.
   *
   * Returns null for bare ground. Written as one function over both sides so a
   * rival's barracks describes itself the same way yours does -- the player
   * scouting an enemy castle wants the same information, and two code paths
   * would drift into two different answers.
   */
  function describeAt(tx: number, tz: number):
      { title: string; sub: string; foe: boolean } | null {
    const mine = buildingAt(tx, tz);
    if (mine) {
      const def = mine.def;
      const bits: string[] = [];
      if (def.workers) bits.push(`${mine.staff}/${def.workers} worker${def.workers > 1 ? 's' : ''}`);
      if (def.produces) {
        const p = def.produces;
        bits.push(`${p.amount} ${p.output} / ${p.seconds}s`);
      }
      if (def.housing) bits.push(`houses ${def.housing}`);
      if (def.storeFor === 'stockpile' || def.storeFor === 'granary') {
        // Store squares hold nothing themselves; what sits on this one comes
        // from the yard layout, which is what the player can actually see.
        const pile = state.layoutFor(def.storeFor).piles
          .find(q => q.x === mine.x && q.z === mine.z);
        bits.push(pile ? `${pile.count} ${pile.res}` : 'empty');
      } else if (def.storeFor === 'armoury') {
        // The armoury pools its room, so the useful number is the town's whole
        // stock of kit against what its armouries can hold.
        bits.push(`${state.armouryUsed} / ${state.armouryCapacity} weapons`);
      }
      const held = Object.entries(mine.held).filter(([, n]) => (n ?? 0) > 0);
      if (def.relay && held.length) {
        bits.push(held.map(([r, n]) => `${n} ${r}`).join(', '));
      }
      const full = buildingHp(def);
      if (mine.hp < full) bits.push(`${Math.max(0, Math.round(mine.hp))}/${full} hp`);
      return { title: def.label, sub: bits.join(' · '), foe: false };
    }

    for (const f of factions) {
      for (const b of f.buildings) {
        const [w, d] = BUILDINGS[b.name].footprint;
        if (tx < b.x || tz < b.z || tx >= b.x + w || tz >= b.z + d) continue;
        const def = BUILDINGS[b.name];
        const full = buildingHp(def);
        const bits = [f.name];
        if (b.hp < full) bits.push(`${Math.max(0, Math.round(b.hp))}/${full} hp`);
        return { title: def.label, sub: bits.join(' · '), foe: true };
      }
    }
    return null;
  }

  /**
   * Mark buildings that are standing idle for a reason the player can fix.
   *
   * A notice scrolls away in a few seconds and only fires once; a building
   * that will never work until something changes has to say so for as long as
   * that is true. Staffing is the case that actually bites -- you lay down an
   * iron mine, there is nobody left to work it, and nothing on screen ever
   * tells you which of your forty buildings is the empty one.
   */
  function updateTroubleFlags(): void {
    troubleBuf.length = 0;
    for (const b of state.buildings) {
      const want = b.def.workers;
      if (!want || b.staff >= want) continue;

      const [w, d] = b.def.footprint;
      const [sx, sy] = iso.worldToScreen(
        b.x + w / 2, terrain.heightAt(b.x, b.z), b.z + d / 2);
      // Cull off-screen before doing anything else with it: on a 200-tile map
      // most buildings are nowhere near the viewport most of the time.
      if (sx < -80 || sy < -40 || sx > window.innerWidth + 80
          || sy > window.innerHeight + 40) continue;

      troubleBuf.push({
        x: sx,
        // Clear of the building itself rather than sitting on its roof.
        y: sy - 34,
        text: want - b.staff === want ? 'no worker' : `short ${want - b.staff}`,
      });
      if (troubleBuf.length >= MAX_FLAGS) break;
    }
    hud.setFlags(troubleBuf);
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
                       clip: string, phase: number,
                       facingOffset = DIRECTION_OFFSET) => {
      const dir = (unitDirectionIndex(heading, rot) + facingOffset) & 7;
      const n = clipFrames(clip);
      const f = Math.floor(phase * clipFps(clip)) % n;
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
    // The rival lords' operators, the same peasant body under his colour so a
    // glance says whose men are working which castle.
    for (const w of enemyWorkers.workers) {
      const dir = (unitDirectionIndex(w.heading, rot) + DIRECTION_OFFSET) & 7;
      const clip = enemyWorkers.clipFor(w);
      const n = clipFrames(clip);
      const f = Math.floor(w.phase * clipFps(clip)) % n;
      const key = atlas.frames[`${clip}_${dir}_${f}`] ? `${clip}_${dir}_${f}` : `idle_${dir}_0`;
      if (!atlas.frames[key]) continue;
      figures.push({
        key, x: w.x, z: w.z, y: terrain.heightAt(w.x, w.z),
        bias: footprintDepthBias(1, 1, rot),
        depth: depthKey(w.x, w.z, rot),
        tint: factionOf(w.side)?.unitTint ?? [1.5, 0.62, 0.55],
      });
    }
    for (const sd of army.soldiers) {
      const dir = (unitDirectionIndex(sd.heading, rot) + DIRECTION_OFFSET) & 7;
      let key: string;
      if (sd.hp <= 0) {
        // Dying: play the shared death clip once, front to back, mapping the
        // time left onto the frames rather than looping. The clip is the bare
        // peasant body -- soldiers are that body anyway -- so a red cast is
        // all that says whose man just fell.
        const dn = clipFrames('death');
        const prog = 1 - Math.max(0, sd.dying) / DEATH_SECONDS;
        const f = Math.min(dn - 1, Math.floor(prog * dn));
        key = atlas.frames[`death_${dir}_${f}`] ? `death_${dir}_${f}` : `idle_${dir}_0`;
      } else {
        const act = sd.swing > 0 ? 'attack' : sd.moving ? 'walk' : 'idle';
        const clip = `${sd.type}_${act}`;
        const n = clipFrames(clip);
        const f = Math.floor(sd.phase * clipFps(clip)) % n;
        key = atlas.frames[`${clip}_${dir}_${f}`] ? `${clip}_${dir}_${f}`
                : atlas.frames[`${sd.type}_idle_${dir}_0`] ? `${sd.type}_idle_${dir}_0`
                : `idle_${dir}_0`;
      }
      if (!atlas.frames[key]) continue;
      // A posted man stands on the walkway, not in the masonry. The extra bias
      // puts him after the wall in the same depth slot, so he is drawn on it
      // rather than behind it.
      const post = sd.garrison;
      const lift = post ? (GARRISON_HEIGHT[buildingNameAt(post.x, post.z)] ?? 0) : 0;
      // The strike lunge. A close-fighter or a battering ram thrusts toward what
      // it is hitting on the moment of the blow and eases back -- so the blow
      // visibly lands instead of falling short across a gap, and the ram meets
      // the wall. Ranged men (archers, catapults) and posted men do not lunge:
      // they loose from where they stand. Heading already points at the target
      // while a blow is in the air, so it needs no target lookup here.
      let dx = sd.x, dz = sd.z;
      if (sd.hp > 0 && sd.swing > 0 && !post && sd.def.range < 3.0) {
        const l = (sd.def.siege ? 0.5 : 0.32) * (sd.swing / SWING_TIME);
        dx += Math.cos(sd.heading) * l;
        dz += Math.sin(sd.heading) * l;
      }
      figures.push({
        key, x: dx, z: dz, y: terrain.heightAt(dx, dz) + lift,
        bias: footprintDepthBias(1, 1, rot) + (post ? 0.6 : 0),
        depth: depthKey(dx, dz, rot),
        // Enemies are the same three bodies under a red cast rather than three
        // more palettes: 288 more sprites to say "not yours" is a poor trade,
        // and side reads faster from colour than from costume anyway.
        // Selection wins; otherwise a held man wears a cool steel cast so you
        // can see at a glance which of your troops are standing their ground.
        tint: sd.side !== PLAYER ? (factionOf(sd.side)?.unitTint ?? [1.5, 0.62, 0.55])
            : sd.selected ? [1.45, 1.45, 1.15]
            : sd.hold ? [0.82, 0.9, 1.15] : undefined,
      });
    }

    // Flames flicker by cycling three rendered variants. They live in the
    // per-frame figure stream rather than the static list precisely because
    // they change every fifth of a second.
    for (const f of fires) {
      const v = 1 + ((Math.floor(state.elapsed * 7) + f.seed) % 3);
      const key = `pitch_fire_${v}_${rot}`;
      if (!atlas.frames[key]) continue;
      const [fx, fz] = spriteAnchor(f.x, f.z, 1);
      figures.push({
        key, x: fx, z: fz, y: terrain.heightAt(f.x, f.z),
        bias: footprintDepthBias(1, 1, rot),
        depth: depthKey(f.x + 0.5, f.z + 0.5, rot),
      });
    }

    for (const a of herd.animals) {
      if (!a.alive) continue;
      // A standing herd with every head down looks like a row of lawnmowers.
      // Real ones keep a couple of sentinels up, so a third of them stand
      // alert instead -- split by id so an individual does not flicker.
      const still = a.id % 3 === 0 ? 'gazelle_idle' : 'gazelle_graze';
      addFigure(a.x, a.z, a.heading, a.moving ? 'gazelle_walk' : still, a.phase,
                GAZELLE_DIRECTION_OFFSET);
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
      const frame = atlas.frames[it.key];
      sprites.add(frame, atlas.size, ppuOf(frame),
        it.x, it.y, it.z, it.bias, it.tint);
    }
    sprites.flush();

    // ghost building, tinted green or red, floated in front of everything
    ghostBatch.clear();
    if (placement.selected && placement.hover) {
      // A painted store has no building sprite of its own -- it is a square, so
      // the ghost is the empty square. SPRITE_STANDIN already says as much.
      const key = spriteKey(placement.selected, rot);
      const frame = key ? atlas.frames[key] : undefined;
      if (frame) {
        const [w, d] = BUILDINGS[placement.selected].footprint;
        const { x, z } = placement.hover;
        const [gx, gz] = spriteAnchor(x, z, d);
        ghostBatch.add(frame, atlas.size, ppuOf(frame),
          gx, terrain.heightAt(x, z), gz, footprintDepthBias(w, d, rot) + 6,
          placement.lastCheck.ok ? [0.55, 1.20, 0.55] : [1.30, 0.45, 0.40]);
      }
    }
    ghostBatch.flush();
    { const [vx, vy, vz] = cameraDirection(iso.rotation); projectiles.setView(vx, vy, vz); }
    projectiles.render();

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
    while (left > 0) {
      const dt = Math.min(step, left);
      left -= dt;
      simulateStep(dt);
    }
  }

  // --- saving and loading -------------------------------------------------

  /**
   * Snapshot the game as a diff against a freshly generated world.
   *
   * Workers are deliberately NOT saved. Their in-flight state is a tangle of
   * paths, claims and half-finished production cycles, and all of it is
   * recoverable: on load `assignWorkers` and `workers.sync` put a man back in
   * every staffed building and he begins his cycle again. The cost is losing
   * one trip's worth of progress; the alternative is a fragile serialisation of
   * the most mutable structure in the game.
   */
  function snapshot(): SaveGame {
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      elapsed: state.elapsed,
      map: chosen,

      gold: state.gold,
      stock: { ...state.stock },
      population: state.population,
      idle: state.idle,
      popularity: state.popularity,
      rations: state.rations,
      taxLevel: state.taxLevel,
      trade: JSON.parse(JSON.stringify(state.trade)),

      buildings: state.buildings.map(b => ({
        n: b.name, x: b.x, z: b.z, staff: b.staff, hp: b.hp,
        held: { ...b.held } as Record<string, number>,
      })),
      factions: factions.map(f => ({
        id: f.id,
        buildings: f.buildings.map(b => ({
          n: b.name, x: b.x, z: b.z, staff: b.staff, hp: b.hp, held: {},
        })),
        defeated: f.defeated,
        gold: f.lord.gold, stock: { ...f.lord.stock },
        population: f.lord.population, idle: f.lord.idle, elapsed: f.lord.elapsed,
        recruited: f.lord.recruited, built: f.lord.built, wavesSent: f.lord.wavesSent,
      })),
      felled: decorations
        .map((d, i) => [i, d] as const)
        .filter(([, d]) => !d.alive)
        .map(([i, d]) => [i, d.regrowAt] as [number, number]),
      soldiers: army.soldiers.map(u => ({
        t: u.type, side: u.side, x: u.x, z: u.z, hp: u.hp,
        ...(u.hold ? { h: true } : {}),
        ...(u.garrison
          ? { g: [u.garrison.x, u.garrison.z, u.garrison.sx, u.garrison.sz] as
                 [number, number, number, number] }
          : {}),
      })),
      animals: herd.animals.map(a => ({
        x: a.x, z: a.z, hx: a.hx, hz: a.hz, alive: a.alive, respawnAt: a.respawnAt,
      })),
      fires: fires.map(f => [f.x, f.z, f.until] as [number, number, number]),
      rally: rallyPoint,
      difficulty,
    };
  }

  /** Put a snapshot back on top of the freshly generated world. */
  function applySave(sv: SaveGame): void {
    // Clear what the fresh start put down, then rebuild from the save.
    for (const b of [...state.buildings]) {
      const [w, d] = b.def.footprint;
      state.removeBuilding(b);
      markArea(b.x, b.z, w, d, 0);
      markSolid(b.x, b.z, w, d, false);
    }
    for (const b of allEnemyBuildings()) {
      const [w, d] = BUILDINGS[b.name].footprint;
      markArea(b.x, b.z, w, d, 0);
      markSolid(b.x, b.z, w, d, false);
    }
    for (const f of factions) f.buildings.length = 0;
    army.soldiers.length = 0;
    fires.length = 0;
    // Clear the worker pool outright.
    //
    // sync() drops workers whose building has gone, but KEEPS any that are
    // idle -- correct during play, wrong here: they are orphans of a world
    // that no longer exists, and sync then staffs the restored buildings on
    // top of them. Measured 4 workers going in and 8 coming out.
    workers.workers.length = 0;

    for (const sb of sv.buildings) {
      const def = BUILDINGS[sb.n];
      if (!def) continue;
      const [w, d] = def.footprint;
      const b = state.addBuilding(sb.n, sb.x, sb.z);
      // Restore staffing from the save rather than recomputing it. The saved
      // `idle` count ALREADY excludes these men, so calling assignWorkers here
      // deducted them a second time and every load quietly lost peasants --
      // measured 25 idle going in, 21 coming out.
      b.staff = sb.staff;
      b.hp = sb.hp;
      b.held = { ...sb.held } as typeof b.held;
      markArea(sb.x, sb.z, w, d);
      if (!def.walkable) markSolid(sb.x, sb.z, w, d);
    }
    for (const sf of sv.factions) {
      const f = factionOf(sf.id);
      if (!f) continue;                    // map now has fewer rivals
      for (const sb of sf.buildings) {
        const def = BUILDINGS[sb.n];
        if (!def) continue;
        const [w, d] = def.footprint;
        f.buildings.push({ name: sb.n, x: sb.x, z: sb.z, hp: sb.hp, staff: sb.staff });
        markArea(sb.x, sb.z, w, d);
        if (!def.walkable) markSolid(sb.x, sb.z, w, d);
      }
      const ek = f.buildings.find(b => b.name === 'keep');
      if (ek) f.keep = { x: ek.x + 1, z: ek.z + 1 };
      f.defeated = sf.defeated;
      f.lord.defeated = sf.defeated;
      f.lord.gold = sf.gold;
      Object.assign(f.lord.stock, sf.stock);
      f.lord.population = sf.population;
      f.lord.idle = sf.idle;
      f.lord.elapsed = sf.elapsed;
      f.lord.recruited = sf.recruited;
      f.lord.built = sf.built;
      f.lord.wavesSent = sf.wavesSent;
    }

    // Drain any water a restored building is standing in.
    //
    // Same hazard as the trees below, one degree worse: the terrain is
    // regenerated from the map settings rather than stored, so adding a river
    // to a map moves the ground under a save made before it, and water blocks
    // both movement and building. Rather than reject the save or drown the
    // granary, the handful of tiles under it go back to sand.
    const WATER_G = GROUND_TYPES.indexOf('water');
    let drained = 0;
    const dryOut = (bx: number, bz: number, w: number, d: number) => {
      for (let z = bz; z < bz + d; z++) {
        for (let x = bx; x < bx + w; x++) {
          if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) continue;
          const t = z * MAP_W + x;
          if (groundType[t] !== WATER_G) continue;
          groundType[t] = GROUND_TYPES.indexOf('sand');
          terrain.layer[t] = tiles.layerOf('sand', hashVariant(x, z));
          paths.setBlocked(x, z, false);
          drained++;
        }
      }
    };
    for (const b of state.buildings) {
      const [w, d] = b.def.footprint;
      dryOut(b.x, b.z, w, d);
    }
    for (const f of factions) {
      for (const b of f.buildings) {
        const [w, d] = BUILDINGS[b.name].footprint;
        dryOut(b.x, b.z, w, d);
      }
    }
    if (drained) {
      terrain.rebuild();
      staticDirty = true;
      console.log(`[save] drained ${drained} tile(s) under restored buildings`);
    }

    // Clear anything growing where a restored building now stands.
    //
    // The scatter is regenerated from the map, not stored in the save, so a
    // change to its density moves the trees while the buildings stay put -- and
    // a save made before such a change can restore a granary onto a tile that
    // now grows a palm. Cheap to check, and it makes the scatter safe to tune
    // without invalidating anyone's game.
    let cleared = 0;
    for (const d of decorations) {
      if (!d.alive) continue;
      if (!occupied[d.z * MAP_W + d.x]) continue;
      const onBuilding = buildingAt(d.x, d.z)
        || factions.some(f => f.buildings.some(b => {
             const [w, h] = BUILDINGS[b.name].footprint;
             return d.x >= b.x && d.z >= b.z && d.x < b.x + w && d.z < b.z + h;
           }));
      if (!onBuilding) continue;
      d.alive = false;
      d.claimedBy = null;
      cleared++;
    }
    if (cleared) console.log(`[save] cleared ${cleared} tree(s) under restored buildings`);

    // trees: everything regrows fresh, so re-fell the ones that were down
    for (const [i, regrowAt] of sv.felled) {
      const d = decorations[i];
      if (!d) continue;
      d.alive = false;
      d.regrowAt = regrowAt;
      d.claimedBy = null;
      occupied[d.z * MAP_W + d.x] = 0;
      regrowing.push(i);
    }

    for (const su of sv.soldiers) {
      const u = army.recruit(su.t, su.x, su.z, su.side);
      if (!u) continue;
      u.hp = su.hp;
      if (su.h) u.hold = true;
      if (su.g) u.garrison = { x: su.g[0], z: su.g[1], sx: su.g[2], sz: su.g[3] };
    }

    herd.animals.length = 0;
    for (const sa of sv.animals) {
      const a = herd.add(sa.x, sa.z);
      a.hx = sa.hx; a.hz = sa.hz;
      a.alive = sa.alive; a.respawnAt = sa.respawnAt;
    }

    for (const [x, z, until] of sv.fires) {
      fires.push({ x, z, until, seed: (x * 7 + z * 13) & 7 });
    }

    state.gold = sv.gold;
    for (const [r, n] of Object.entries(sv.stock)) {
      (state.stock as Record<string, number>)[r] = n;
    }
    state.population = sv.population;
    state.idle = sv.idle;
    state.popularity = sv.popularity;
    state.rations = sv.rations as typeof state.rations;
    state.taxLevel = sv.taxLevel;
    Object.assign(state.trade, sv.trade);
    state.elapsed = sv.elapsed;
    rallyPoint = sv.rally ?? null;   // absent on saves made before the flag existed

    // sync() alone: it creates exactly one worker per staffed slot, which is
    // what the save recorded. assignWorkers would re-derive it and drift.
    workers.sync();
    recomputeTerritory();   // the lands, from the restored keep and walls
    rebuildFirePosts();
    staticDirty = true;
    state.notify('Game loaded', 'info');
  }

  function openPause(): void {
    if (paused) return;
    paused = true;
    placement.cancel();
    showPause({ snapshot, onResume: () => { paused = false; last = performance.now(); } });
  }

  if (restore) applySave(restore);

  // With the keeps final -- placed fresh or restored from a save -- make sure a
  // land route joins every one of them, carving a ford across any dividing river.
  ensureKeepsConnected();

  // Debug handle: lets the sim be inspected and driven from the console
  // without threading test hooks through the game code.
  (window as unknown as Record<string, unknown>).__game = {
    state, workers, placement, terrain, iso, stepSim,
    redraw: () => {
      if (syncStores()) staticDirty = true;
      drawScene();
    },
    decorations, workerWorld, groundType, regrowing, paths, wanderers, hud, herd, army, enemyWorkers,
    recruit, atlas, spawnRaid, factions, fires, lightPitch, projectiles,
    manable: () => [...manableTiles(state.buildings)],
    snapshot, applySave, openPause,
    isPaused: () => paused,
    // Kept singular-friendly for the console: no argument means the first
    // rival, which is the common case while poking at a game.
    lord: (i = 0) => factions[i]?.lord,
    enemyBuildings: () => allEnemyBuildings(),
    lordStatus: (i?: number) => i === undefined
      ? factions.map(f => ({ who: f.name, ...f.lord.status() }))
      : factions[i]?.lord.status(),
    lordAttack: (i = 0) => factions[i]?.lord.attackNow() ?? 0,
    /** Force the end screen, for testing. `win=true` also razes the rivals. */
    endGame: (win = true) => { if (win) for (const f of factions) { f.defeated = true; f.lord.defeated = true; } endGame(win); },
    greatness: (side = 0) => greatness(side),
    checkStanding: () => checkStanding(),
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
        if (BORDER_BUILDINGS.has(b.name)) recomputeTerritory();
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

/**
 * Boot.
 *
 * A "load" intent skips the menu entirely: the slot already records which map
 * it was played on, so asking again would only be a chance to pick the wrong
 * one and get a world the save does not fit.
 */
(async () => {
  const intent = takeBootIntent();
  const loading = document.getElementById('loading')!;

  // Contact the storage backend before anything reads a save or a map. Never
  // throws -- a missing server just leaves saves in this browser's localStorage,
  // exactly as before. On first run against a fresh server this also copies up
  // any saves the browser already held, so upgrading loses nothing.
  await hydrate();

  if (intent?.kind === 'load') {
    const info = readSlot(intent.slot);
    if (info.save) {
      loading.textContent = `loading ${info.save.map.name.toLowerCase()}…`;
      return main(info.save.map, info.save, info.save.difficulty ?? 'normal');
    }
    // The slot went missing between clicking Load and reloading. Fall through
    // to the menu rather than booting a blank world with no explanation.
    console.warn('[save] slot', intent.slot, 'could not be read:', info.error);
  }

  // The menu loops: opening the editor and coming back should land on the
  // menu again with the new map listed, not boot a game nobody asked for.
  for (;;) {
    const choice = await showMenu();
    if (choice.kind === 'play') {
      loading.textContent = `building ${choice.map.name.toLowerCase()}…`;
      return main(choice.map, null, choice.difficulty);
    }
    // The loading veil sits above the canvas; the editor draws its own world,
    // so it has to come down here and go back up before the game boots.
    loading.textContent = 'opening the editor…';
    loading.classList.add('done');
    await showEditor(MAP_W, MAP_H, choice.edit);
    loading.classList.remove('done');
  }
})()
  .catch(err => {
  document.getElementById('loading')!.textContent = `error: ${err.message}`;
  console.error(err);
});
