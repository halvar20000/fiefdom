import * as THREE from 'three';
import { IsoCamera } from './engine/camera';
import { Terrain } from './engine/terrain';
import { SpriteBatch } from './engine/sprites';
import { loadTileArray, buildCombinedAtlas, type CombinedAtlas } from './engine/assets';
import { Audio } from './engine/audio';
import { Projectiles } from './engine/projectiles';
import { reportStaleAssets, missingTiles, missingSprites } from './engine/freshness';
import {
  generateMap, findSite, isBuildable, findStartSite, GROUND_TYPES, GROUND_COLOURS,
} from './game/worldgen';
import {
  TILE_PX_W, unitDirectionIndex, footprintDepthBias, depthKey, spriteAnchor,
  cameraDirection,
} from './engine/iso';
import { GameState, type PlacedBuilding } from './game/state';
import { PathGrid } from './game/pathfind';
import { Herd, HUNT_RADIUS } from './game/wildlife';
import { Army, PLAYER, SWING_TIME, DEATH_TIME } from './game/army';
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
import { MAP_W, MAP_H } from './game/maps';
import type { LordSetup } from './ui/lords';
import { SAVE_VERSION, takeBootIntent, readSlot, playTime, type SaveGame } from './game/save';
import { hydrate } from './game/backend';
import { BANNERS } from './game/banners';
import { MatchRuntime } from './net/match';
import { packBuilding, packSoldier, unpackSoldier, buildingName } from './net/wire';
import { multiplayer } from './ui/lobby';
import { net } from './net/socket';
import { accountScreen } from './ui/account';
import { showMatchChat } from './ui/gamechat';
import { toggleFullscreen, onFullscreenChange } from './ui/fullscreen';
import type { Soldier } from './game/army';
import type { NetBuilding, NetSoldier } from './net/protocol';
import {
  BUILDINGS, STORE_SPRITES, SPRITE_STANDIN, storeSquare, SOLDIER_TYPES, buildingHp,
  canGarrison, isWeapon,
  GARRISON_HEIGHT, garrisonReach, MARSH_SPEED_FOOT, MARSH_SPEED_SIEGE,
  BUILD_MENU, SOLDIER_ORDER, unlistedBuildings, unlistedSoldiers,
  unlistedResources, storeSprites,
  BURN_SECONDS, BURN_RADIUS, BURN_DPS, IGNITE_RADIUS, DEMOLISH_REFUND,
  PIT_TRIGGER_RADIUS, PIT_BLAST_RADIUS, PIT_DAMAGE, WATER_POT_RADIUS,
  OIL_POT_TRIGGER_RADIUS, OIL_POT_BLAST_RADIUS, OIL_POT_DAMAGE,
  REPAIR_RADIUS, REPAIR_PER_SECOND, UNDERMINE_RADIUS, UNDERMINE_PER_SECOND,
  SPEED_LEVELS, RESOURCE_LABELS, productionOf, goodName, HAUL_RANGE,
  DEPOT_SERVE_RANGE,
  type Resource, type Store,
} from './game/defs';

/** The shared palette, aliased: the minimap is one of three users of it. */
const MINI_COLOURS = GROUND_COLOURS;

/**
 * The stores that are PAINTED a square at a time, for the loops that lay out
 * piles. The armoury is a shed and draws its own sprite, so it is not here --
 * see STORE_SPRITES, which is the declaration these two follow from.
 */
const STORE_KINDS: readonly ('stockpile' | 'granary')[] = ['stockpile', 'granary'];

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

/**
 * How close to the window edge the pointer scrolls the map, in pixels.
 *
 * The side panels sit 12px in from the edge (#leftcol / #rightcol), so the
 * outermost strip of every edge is always bare canvas. That is what makes the
 * band work on the right at all: shoving the pointer at the edge lands it past
 * the controls panel, while moving it deliberately ONTO the panel does not
 * scroll -- which is what you want when you are reaching for a button.
 */
const EDGE_BAND = 20;
/** Pan speed at the edge, as a multiple of the keyboard's. Eases in over the band. */
const EDGE_SPEED_MIN = 0.5;
const EDGE_SPEED_MAX = 1.5;

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
                    difficulty: Difficulty = 'normal',
                    setup: LordSetup | null = null,
                    mp: MatchRuntime | null = null) {
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
    // Every building that is expected to have art of its own. A painted store
    // has none by design and is named by its square instead, so it is asked
    // after through storeSquare rather than skipped by name.
    ...missingSprites(
      Object.entries(BUILDINGS)
        .filter(([, def]) => !storeSquare(def))
        .map(([n]) => n),
      atlas.frames),
    // Soldiers, checked the same way. A unit with no frames does not vanish --
    // the draw loop falls back to the bare peasant body -- so a whole new
    // troop type can ship looking like an unarmed villager and nothing
    // anywhere says why. The key is `${clip}_${dir}_${frame}`, so asking after
    // `<type>_idle_0` is asking after facing 0, frame 0 of his idle.
    ...missingSprites(SOLDIER_ORDER.map(n => `${n}_idle_0`), atlas.frames),
    // And the yards. A good with no pile art is stored and counted while the
    // square it sits on draws nothing at all.
    ...missingSprites(storeSprites(), atlas.frames),
    ...unlistedBuildings(),
    ...unlistedSoldiers(),
    ...unlistedResources(),
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
  // Big enough for a dragged run of wall, not for one ghost: a stroke across
  // the map is a couple of hundred tiles and every one of them is drawn.
  const ghostBatch = new SpriteBatch(atlas.texture, 512);
  ghostBatch.mesh.renderOrder = 11;
  scene.add(sprites.mesh);
  scene.add(ghostBatch.mesh);
  const projectiles = new Projectiles();
  scene.add(projectiles.mesh);

  // --- occupancy ----------------------------------------------------------
  // Two grids, kept in step. `occupied` decides where you may BUILD;
  // `paths.blocked` decides where units may WALK. Anything solid is in both.
  //
  // Scatter used to be in `occupied` alone, on the argument that a blocking
  // palm grove is a maze. The cost of that was worse: a boulder sitting in a
  // wall line is a tile you may not build on and the enemy may walk through,
  // so a castle with a rock on its perimeter could never be closed at all --
  // and a rock, unlike a tree, can never be cleared. A tile you cannot build
  // on is now a tile nobody walks over, whatever put it there.
  //
  // The maze never turned up. Across the twelve shipped maps the thickest
  // woodland (Cedar Ridge, trees 1.9) covers 16.7% of the flat ground, well
  // under the ~40% where an 8-connected grid stops percolating: flood-filled,
  // the biggest walkable region loses at most 0.2 points of the map's open
  // ground and the trees fence off at most 56 tiles of it, usually none. A
  // forest is threaded, not sealed.
  const occupied = new Uint8Array(MAP_W * MAP_H);
  const paths = new PathGrid(MAP_W, MAP_H);
  /**
   * Which tiles hold a living tree, bush or rock.
   *
   * `occupied` cannot answer this -- a building marks it too -- and scanning
   * the decorations list cannot answer it cheaply enough for the ford search,
   * which asks about every tile it steps on.
   */
  const scatterGrid = new Uint8Array(MAP_W * MAP_H);

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

  /**
   * A tree, rock or bush arrives on a tile, or leaves it.
   *
   * One place, because the two grids must agree: scatter that is in `occupied`
   * but not in `paths` is exactly the hole a wall can never close.
   */
  const markScatter = (x: number, z: number, there: boolean) => {
    if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) return;
    if (there) {
      occupied[z * MAP_W + x] = 1;
      scatterGrid[z * MAP_W + x] = 1;
      paths.setBlocked(x, z, true);
      return;
    }
    scatterGrid[z * MAP_W + x] = 0;
    // Only give the tile back if nothing else has claimed it meanwhile. A
    // felled tree with a granary now standing on it must not un-mark the
    // granary.
    if (buildingAt(x, z)) return;
    if (allEnemyBuildings().some(b => {
      const [w, d] = BUILDINGS[b.name].footprint;
      return x >= b.x && z >= b.z && x < b.x + w && z < b.z + d;
    })) return;
    if (groundName(x, z) === 'water') return;
    occupied[z * MAP_W + x] = 0;
    paths.setBlocked(x, z, false);
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
    // Snapshot before the trial, and put back exactly what was there.
    //
    // It used to hand the tiles back CLEARED, and every caller then cleared
    // them again -- which is only right when the ground under them was open to
    // begin with. Trial a wall over a boulder or the edge of a lake and the
    // pair of them quietly unblocked a tile that has been solid since the map
    // was made: a hole in the line, on ground the player is not allowed to
    // build on, that nothing would ever close.
    const before: boolean[] = [];
    for (let dz = 0; dz < d; dz++)
      for (let dx = 0; dx < w; dx++) before.push(paths.isBlocked(x + dx, z + dz));
    paths.fill(x, z, w, d, true);
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

      if (!hasAccess(x, z, w, d, region)) return true;
      for (const b of state.buildings) {
        const [bw, bd] = b.def.footprint;
        if (!hasAccess(b.x, b.z, bw, bd, region)) return true;
      }
      for (const wk of workers.workers) {
        if (paths.regionAt(Math.floor(wk.x), Math.floor(wk.z)) !== region) return true;
      }
      return false;
    } finally {
      let i = 0;
      for (let dz = 0; dz < d; dz++)
        for (let dx = 0; dx < w; dx++) paths.setBlocked(x + dx, z + dz, before[i++]);
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
   * The table itself moved to banners.ts when the lobby needed to show the same
   * colours before a world exists to draw -- see there for why there are two
   * strengths of each.
   */
  const FACTION_COLOURS = BANNERS;

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
    /**
     * Stable for as long as the building stands.
     *
     * The player's own buildings have always had one. These did not, because
     * nothing ever had to name one from outside this file -- until multiplayer,
     * where a castle is replicated across four browsers and "the thing I just
     * hit" has to survive being sent to its owner and looked up there. An index
     * into the array would not: the array is spliced whenever anything falls.
     */
    id: number;
    name: string; x: number; z: number; hp: number;
    /** Workers the lord has put in it. He manages this; we just store it. */
    staff: number;
  }
  /** Ids for the above, unique across every faction on the map. */
  let nextEnemyBuildingId = 1;

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
    /**
     * This faction's side number ON THE WIRE, which is not its `id` here.
     *
     * In a match every client calls ITSELF side 0, because several hundred
     * lines of this file test against `PLAYER`. `MatchRuntime.local` swaps my
     * slot with 0 to get from one to the other; this is the untranslated half.
     * In single-player it is just the id.
     */
    gside: number;
    /**
     * Another player owns this one: they simulate it, we only replicate it.
     *
     * A netted faction has no lord thinking for it here, its buildings and
     * soldiers arrive as snapshots, and damage dealt to it is reported to its
     * owner rather than applied. See net/match.ts for why.
     */
    net: boolean;
  }
  const factions: Faction[] = [];

  /**
   * In a match: the wire side of each faction, in the order they are created.
   *
   * Local faction ids run 1, 2, 3... and `MatchRuntime.local` maps a wire side
   * to exactly one of them, so sorting the other sides by their local number
   * makes the i-th faction created the one whose local id is i+1. That identity
   * is what lets the rest of this file go on saying `factionOf(s.side)` without
   * knowing anything about slots.
   */
  const mpSides: number[] = mp ? mp.rivalSides : [];
  const mpNames: string[] = mp ? mpSides.map(g => mp.nameOfGlobal(g)) : [];

  /** Do these two LOCAL sides fight? Allies in a co-op match do not. */
  const atWar = (a: number, b: number): boolean =>
    mp ? mp.hostile(a, b) : a !== b;

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
      // Anything at war with this engine's side is a target -- which is what
      // lets two rival lords wreck each other's castles without a special case,
      // and what keeps an ally's gatehouse out of a catapult's list.
      if (atWar(s.side, PLAYER)) {
        for (const b of state.buildings) {
          const [w, d] = b.def.footprint;
          consider(b.x, b.z, w, d, (n) => damagePlayerBuilding(b, n));
        }
      }
      for (const f of factions) {
        if (!atWar(s.side, f.id)) continue;
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
    onIncendiary: (x, z) => lightGround(Math.floor(x), Math.floor(z)),
    // A soldier with no soldier to fight may cut down an enemy lord's labourers
    // if any stand within reach. Killing one costs that lord the man and the
    // staffed slot on the building he worked, so the job halts until refilled --
    // which is how thinning his operators actually bites into his economy.
    civilianTarget: (s, reach) => {
      let best: (typeof enemyWorkers.workers)[number] | null = null;
      let bestD = reach;
      for (const w of enemyWorkers.workers) {
        if (!atWar(s.side, w.side)) continue;   // never his own side's, nor an ally's
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
          const f = factionOf(victim.side);
          enemyWorkers.remove(victim);
          // A labourer of somebody else's is drawn from THEIR staffing, so the
          // figure vanishing here is only the arrow landing. What costs them the
          // man -- and the staffed slot on the building he worked, so the job
          // stops -- is the report, applied on their machine. Their next
          // snapshot puts our figures right.
          if (f?.net && mp) {
            const id = (b as { id?: number } | undefined)?.id;
            if (id !== undefined) mp.hit(f.gside, 'w', id, 1);
            return;
          }
          f?.lord?.loseWorker(b);
        },
      };
    },
    // Allies walk past each other. Without this every side fights every other,
    // which is exactly right for single-player and wrong the moment two humans
    // are on the same team.
    hostile: (a, b) => atWar(a, b),
    // A blow on a soldier another player owns. His health is not ours to
    // change; we say what we did and his owner says what came of it.
    onNetHit: (s, amount) => {
      const f = factionOf(s.side);
      if (f && mp && s.netId !== undefined) mp.hit(f.gside, 'u', s.netId, amount);
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
  // Three sources, most recently stated first: where the player just put his
  // keep on the placement screen, then where a hand-drawn map says, then the
  // generator's own pick. The screen wins because it is the one the player
  // was looking at a second ago.
  const placedStart = setup?.you ?? chosen.custom?.start;
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
      scatterGrid[idx] = 1;
      paths.setBlocked(t.x, t.z, true);
    }
  }

  // --- game ---------------------------------------------------------------
  const state = new GameState();
  // One speed for everybody: see GameState.speedLocked.
  state.speedLocked = !!mp;

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

  /**
   * How many of a building the stores will pay for, right now.
   *
   * A run spends as it goes, so the preview has to know where the stone runs
   * out -- otherwise a drag of forty wall tiles is drawn entirely green and
   * twelve of them get built.
   */
  function affordableCount(name: string): number {
    const cost = Object.entries(BUILDINGS[name].cost) as [Resource, number][];
    let n = Infinity;
    for (const [r, need] of cost) {
      if (!need) continue;
      n = Math.min(n, Math.floor(state.stock[r] / need));
    }
    return n;
  }

  /** "36 stone", "24 wood and 6 iron" -- what a run of `n` will cost. */
  function runCost(name: string, n: number): string {
    const parts = (Object.entries(BUILDINGS[name].cost) as [Resource, number][])
      .filter(([, need]) => need > 0)
      .map(([r, need]) => `${need * n} ${RESOURCE_LABELS[r].toLowerCase()}`);
    return parts.join(' and ') || 'free';
  }

  /** What a release would build: the stroke's tiles and which of them go up. */
  interface RunPlan {
    tiles: { x: number; z: number }[];
    legal: boolean[];
    /** How many would actually be laid. */
    count: number;
  }
  let runPlan: RunPlan = { tiles: [], legal: [], count: 0 };

  /**
   * Work out the stroke once per frame, for the ghost AND the cursor label.
   *
   * Both used to ask `placement.lastCheck`, which knows about one tile. A run
   * has to be walked in order: each tile is judged against the purse left after
   * the ones before it and against the store squares they will have added.
   */
  function planRun(name: string): RunPlan {
    const tiles = placement.run();
    const legal: boolean[] = [];
    const laid: { x: number; z: number }[] = [];
    let purse = affordableCount(name);
    for (const t of tiles) {
      const ok = purse > 0 && placement.check(name, t.x, t.z, laid).ok;
      if (ok) { purse--; laid.push(t); }
      legal.push(ok);
    }
    return { tiles, legal, count: laid.length };
  }

  /**
   * Lay every tile of a run the player has just dragged out.
   *
   * A run is the ordinary single placement generalised: a plain click hands
   * this one tile, so there is one path through the build code rather than two
   * that drift apart.
   *
   * A tile that cannot take the building is SKIPPED, not fatal. Dragging a
   * twenty-tile wall across a boulder should give nineteen tiles of wall and a
   * boulder, not nothing and a complaint -- and since the boulder is solid
   * ground now, the line it interrupts is still a closed line. The first
   * refusal is reported once at the end, so a stroke that crosses a wood does
   * not fire off thirty warnings.
   *
   * Order matters in one place: the placement check runs BEFORE the seal-off
   * trial. The trial marks the tile impassable and then hands it back, and
   * "hands it back" means UNBLOCKED -- run on a tile that was already solid
   * (a rock, a lake) it would quietly open a hole in the map that nothing
   * would ever close again.
   */
  function buildRun(name: string, tiles: { x: number; z: number }[],
                    keepTool: boolean): { built: number; refusal: string } {
    const def = BUILDINGS[name];
    const [pw, pd] = def.footprint;
    let built = 0;
    let refusal = '';
    let border = false;
    for (const t of tiles) {
      const check = placement.check(name, t.x, t.z);
      if (!check.ok) { refusal ||= check.reason; continue; }
      // A walkable building cannot seal anything off, so it skips the test --
      // which also means painting a large yard never trips "would block the way".
      if (!def.walkable && wouldSealSomethingOff(t.x, t.z, pw, pd)) {
        refusal ||= 'That would block the way';
        continue;
      }
      if (!placement.placeAt(name, t.x, t.z).ok) continue;
      const b = state.buildings[state.buildings.length - 1];
      markArea(b.x, b.z, pw, pd);
      if (!def.walkable) markSolid(b.x, b.z, pw, pd);
      if (BORDER_BUILDINGS.has(name)) border = true;
      built++;
    }
    if (built) {
      audio.play('place');
      if (border) recomputeTerritory();      // a wall claims new ground
      workers.sync();
      staticDirty = true;
      // "Wall x 13 laid", matching the label the cursor showed while the run
      // was being drawn. A plural of the building's own name is a trap -- there
      // is no "granarys" and no "wall stairss".
      if (tiles.length > 1) state.notify(`${def.label} × ${built} laid`, 'info');
    }
    if (refusal && built < tiles.length) state.notify(refusal, 'warn');
    // Keep the tool in hand for anything laid in runs -- yard squares, granary
    // bays, curtain wall -- and for a shift-click of anything else.
    if (built === 0 || keepTool || def.paintable) refreshOverlay(true);
    else placement.cancel();
    return { built, refusal };
  }

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
   *
   * A tree now blocks the way, so the spot has to be clear of the trunk's own
   * tile: 0.35 kept the woodcutter inside it, and `snapOpen` would have shunted
   * him to whatever tile it found first -- often round the far side, chopping
   * with his back to the tree. 0.8 lands him in the neighbour he came from.
   */
  function standBeside(t: Decoration, from: { x: number; z: number }) {
    return standBesidePoint({ x: t.x + 0.5, z: t.z + 0.5 }, from, 0.8);
  }

  /** Same, for something that already has a world position rather than a tile. */
  function standBesidePoint(p: { x: number; z: number }, from: { x: number; z: number },
                            off = 0.35) {
    const tx = p.x, tz = p.z;
    const dx = from.x - tx, dz = from.z - tz;
    const len = Math.hypot(dx, dz) || 1;
    // Close enough to be swinging AT the quarry, not standing back from it. Was
    // 0.55, which read as a gap between the hunter and what he is stalking. A
    // woodcutter passes more, because his tree is solid ground now.
    return { x: tx + (dx / len) * off, z: tz + (dz / len) * off };
  }

  function nearestStoreAt(kind: Store, x: number, z: number): PlacedBuilding | null {
    let best: PlacedBuilding | null = null;
    let bestD = Infinity;
    for (const b of state.buildings) {
      if (b.def.storeFor !== kind) continue;
      const d = (b.x - x) ** 2 + (b.z - z) ** 2;
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  /**
   * Is this shed a shorter walk for that workshop's inputs than the yard is?
   *
   * The ONE test, asked by both halves of the arrangement: what a shed decides
   * to keep on its shelves, and what a workshop is allowed to take off them.
   * If the two could disagree -- if a shed stocked flour for a bakery that
   * then walked past it to the stockpile anyway -- the sacks would sit on the
   * shelf out of the town's stock and out of everyone's reach, which is a leak
   * and not a feature.
   *
   * Measured between origins on both sides for the same reason.
   */
  function shedServes(shed: PlacedBuilding, b: PlacedBuilding): boolean {
    const d = (shed.x - b.x) ** 2 + (shed.z - b.z) ** 2;
    if (d > DEPOT_SERVE_RANGE ** 2) return false;
    // Every input in the game is a yard good, which is why the fetch leg is
    // hardcoded to the stockpile. The day one is not, this and that change
    // together.
    const store = nearestStoreAt('stockpile', b.x, b.z);
    if (!store) return true;
    return d < (store.x - b.x) ** 2 + (store.z - b.z) ** 2;
  }

  const workerWorld: WorkerWorld = {
    heightAt: (x, z) => terrain.heightAt(x, z),
    groundSpeed,
    nearestStore: nearestStoreAt,

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
    /**
     * What the staffed workshops around a storehouse consume.
     *
     * Measured between origins, like the ox tether's range, and only from
     * buildings with a MAN in them: an unstaffed workshop eats nothing, and a
     * shed hoarding sacks for a mill nobody works is holding them out of the
     * town's stock for no one.
     *
     * Relays are skipped, so two sheds standing near each other cannot decide
     * to stock one another.
     */
    relayDemand(b) {
      const out = new Set<Resource>();
      for (const other of state.buildings) {
        if (other.def.relay || other.staff <= 0) continue;
        const prod = productionOf(other.def, other.alt);
        if (!prod?.inputs) continue;
        if (!shedServes(b, other)) continue;
        for (const r of Object.keys(prod.inputs)) out.add(r as Resource);
      }
      return out;
    },

    /**
     * A storehouse that can supply a whole cycle without a walk to the yard.
     *
     * All of the inputs or none: a worker carries one load home and there is
     * no state for a trip that collects half a cycle here and half there.
     *
     * And only if the shed is genuinely nearer than the stockpile the worker
     * would otherwise walk to. Without that test a shed built beside the yard
     * would pull every workshop in the settlement into a detour, and a shed
     * would stop being a way to shorten a long walk and start being a tax on a
     * short one.
     */
    inputSource(b, inputs, x, z) {
      let best: PlacedBuilding | null = null;
      let bestD = Infinity;
      for (const shed of state.buildings) {
        if (!shed.def.relay) continue;
        // Only a shed that is serving THIS workshop: the same test that
        // decides what the shed keeps decides who may draw on it.
        if (!shedServes(shed, b)) continue;
        let has = true;
        for (const [r, n] of Object.entries(inputs)) {
          if ((shed.held[r as Resource] ?? 0) < (n ?? 0)) { has = false; break; }
        }
        if (!has) continue;
        const d = (shed.x - x) ** 2 + (shed.z - z) ** 2;
        if (d < bestD) { bestD = d; best = shed; }
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
        o.def.hauler &&
        Math.abs(o.x - b.x) < HAUL_RANGE && Math.abs(o.z - b.z) < HAUL_RANGE);
    },
    haulSource(b, resource, range) {
      let best: PlacedBuilding | null = null, most = 0;
      for (const o of state.buildings) {
        if (!o.def.needsHauler) continue;
        if (Math.abs(o.x - b.x) >= range || Math.abs(o.z - b.z) >= range) continue;
        const n = o.held[resource] ?? 0;
        if (n > most) { most = n; best = o; }
      }
      return best;
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
      // felling clears the land, so the spot becomes buildable -- and walkable
      markScatter(t.x, t.z, false);
      const idx = decorations.indexOf(t);
      regrowing.push(idx);
      // The trees are generated from the map seed, so index `idx` is the same
      // tree on every client -- which is what makes one number enough to keep
      // the stumps in step.
      mp?.fell(idx);
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
      // A faction another player owns has no lord here and no treasury we are
      // ever told about, so it cannot be on this chart. In a match the line is
      // the AI lords' -- and with none of them, it simply is not drawn.
      if (f.defeated || !f.lord) continue;
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
        return null;
      }
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
    f.buildings.push({
      id: nextEnemyBuildingId++, name, x, z,
      hp: buildingHp(BUILDINGS[name]), staff: 0,
    });
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
    // The placement screen is authoritative when there is one: it says both how
    // many rivals there are and where each sits. `chosen.lords` survives only
    // as the default that screen opens with, and for a save being restored.
    const seats = setup?.rivals ?? null;
    const want = seats ? Math.min(seats.length, FACTION_COLOURS.length)
                       : Math.min(chosen.lords, FACTION_COLOURS.length);
    if (want < 1) { console.log('[lords] no opposition on this map'); return; }

    const dirs: [number, number][] = [
      [1, 1], [-1, -1], [1, -1], [-1, 1], [1, 0], [0, 1], [-1, 0], [0, -1],
    ];
    const placedKeeps: { x: number; z: number }[] = [];

    for (let i = 0; i < want; i++) {
      const colour = FACTION_COLOURS[i];
      const f: Faction = {
        id: i + 1, name: mpNames[i] ?? colour.name,
        unitTint: colour.unit, stoneTint: colour.stone,
        buildings: [], keep: null, ring: [], gate: null,
        lord: null as unknown as Lord, defeated: false,
        gside: mpSides[i] ?? i + 1,
        net: mp ? mp.ownerOf(mpSides[i] ?? i + 1) !== mp.you : false,
      };

      // A hand-placed keep is taken as an instruction, with only enough search
      // room to find buildable ground under it.
      const wanted = seats?.[i] ?? chosen.custom?.keeps?.[i];
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
      if (!sited) {
        console.warn(`[lords] nowhere to seat rival ${i + 1}`);
        // In single-player a lord who cannot be seated simply is not on the
        // map. In a match the faction ids are a numbering every client shares,
        // so dropping one here would silently rename every faction after it and
        // send blows to the wrong castle. He is seated as already defeated
        // instead -- visible to nobody, but holding his place in the list.
        if (!mp) continue;
        f.defeated = true;
        f.lord = null as unknown as Lord;
      }
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
    /**
     * Open one tile of the route: dry the water, or clear what grows on it.
     *
     * Scatter is in here as well as water because scatter blocks the way now.
     * Across the twelve shipped maps it fences off at most 56 tiles of the
     * mainland and usually none, so this almost never fires -- but "almost
     * never" is not "never", and a lord walled in by his own woodland is a
     * game that cannot be won or lost, exactly like the river this function
     * was written for.
     */
    const clear = (x: number, z: number) => {
      const t = z * MAP_W + x;
      if (groundType[t] === WATER) {
        groundType[t] = SAND;
        terrain.layer[t] = tiles.layerOf('sand', hashVariant(x, z));
        paths.setBlocked(x, z, false);
        occupied[t] = 0;
        return;
      }
      if (!scatterGrid[t]) return;
      const d = decorations.find(o => o.alive && o.x === x && o.z === z);
      if (d) { d.alive = false; d.claimedBy = null; }
      markScatter(x, z, false);
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
      for (const [x, z] of ford) clear(x, z);
      // Widen the crossing to two tiles so it reads as a causeway and a column
      // does not bottleneck single file over it. Only what was IN the way is
      // opened -- `clear` ignores dry ground with nothing on it -- so the banks
      // are left alone. Thickened along whichever axis the ford runs LEAST, i.e.
      // across its length.
      if (ford.length > 1) {
        const xs = ford.map(t => t[0]), zs = ford.map(t => t[1]);
        const runsHorizontal =
          Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
        for (const [x, z] of ford) {
          clear(runsHorizontal ? x : x + 1, runsHorizontal ? z + 1 : z);
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
    // What costs a tile of clearing to cross: open water, or a tree or boulder
    // standing on dry land. Both are things this function is allowed to remove;
    // a building is not, and never becomes crossable at any price.
    const isWater = (i: number) => groundType[i] === WATER || scatterGrid[i] === 1;
    const passable = (x: number, z: number) =>
      isWater(z * MAP_W + x) || !paths.isBlocked(x, z);
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
          // `isWater` covers scatter too, so `ford` is every tile that has to
          // be opened -- drained or felled, whichever it is.
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
  /** The death clip's play length, from army.ts so the two cannot drift. */
  const DEATH_SECONDS = DEATH_TIME;

  let builtRotation = -1;
  let staticDirty = true;

  /**
   * Is anybody standing on this tile?
   *
   * Asked before a tree is allowed to grow back over it. Covers every figure
   * that has a position on the map, including the idle townsfolk -- they are
   * the only people on screen before the first workshop exists, so a list that
   * left them out would look correct in a test and wrong in a new game.
   */
  function someoneOn(x: number, z: number): boolean {
    const on = (px: number, pz: number) => Math.floor(px) === x && Math.floor(pz) === z;
    for (const w of workers.workers) if (on(w.x, w.z)) return true;
    for (const u of wanderers) if (on(u.x, u.z)) return true;
    for (const w of enemyWorkers.workers) if (on(w.x, w.z)) return true;
    for (const s of army.soldiers) if (s.hp > 0 && on(s.x, s.z)) return true;
    return false;
  }

  /** Grow felled trees back, unless something has since been built there. */
  function regrowForest(): void {
    for (let i = regrowing.length - 1; i >= 0; i--) {
      const t = decorations[regrowing[i]];
      if (!t || t.alive) { regrowing.splice(i, 1); continue; }
      if (state.elapsed < t.regrowAt) continue;
      regrowing.splice(i, 1);
      if (occupied[t.z * MAP_W + t.x]) continue;   // built over; it stays gone
      // A trunk that blocks the way must not close over somebody standing
      // there. Cheap to check -- this runs for a handful of stumps a minute --
      // and the alternative is a worker sealed inside a tree until something
      // else rescues him.
      if (someoneOn(t.x, t.z)) continue;
      t.alive = true;
      markScatter(t.x, t.z, true);
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
    // A faction another player owns is thought for on THEIR machine; here it
    // is only a picture. An unseated one has no lord at all.
    for (const f of factions) if (!f.net && f.lord) f.lord.update(dt);
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
  /**
   * Raise or drop every drawbridge, and repath around the result.
   *
   * All of them at once, like F lights the pitch: a drawbridge is a gate in a
   * line you drew, and hunting for each one under fire is not a decision, it
   * is an obstacle. Returns how many moved.
   */
  function toggleDrawbridges(): number {
    const bridges = state.buildings.filter(b => b.name === 'drawbridge');
    if (!bridges.length) return 0;
    // Follow the majority so one bridge left the wrong way up does not invert
    // the meaning of the key for the whole castle.
    const up = bridges.filter(b => b.raised).length > bridges.length / 2;
    for (const b of bridges) {
      b.raised = !up;
      // A raised bridge is the one thing that becomes solid AFTER placement.
      markSolid(b.x, b.z, 1, 1, !up);
    }
    staticDirty = true;
    return bridges.length;
  }

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
  /**
   * Spring any pit an enemy has walked onto, and empty any water pot standing
   * near a fire.
   *
   * Both are one-shot and both are the player's, so they check `army.enemies`
   * rather than every soldier -- unlike a pitch fire, which burns whoever is
   * in it. A trap that killed its own garrison would be a bug, not a nuance.
   */
  /**
   * Engineers mend, tunnellers undermine.
   *
   * Both work by standing still beside something, so neither needs an order
   * system of its own: you walk him there and he gets on with it, which is
   * also how a worker behaves. Both are per-second rates rather than per-hit,
   * because a repair that raced a catapult would make siege pointless and a
   * tunneller who dropped a gatehouse in ten seconds would make walls
   * pointless.
   */
  function updateSappers(dt: number): void {
    for (const u of army.soldiers) {
      if (u.hp <= 0 || u.moving) continue;

      if (u.type === 'engineer' && u.side === 0) {
        // The most damaged thing in reach, so a man between two ruins mends
        // the one nearer to falling rather than whichever was found first.
        let worst: PlacedBuilding | null = null;
        for (const b of state.buildings) {
          const [w, d] = b.def.footprint;
          const full = buildingHp(b.def);
          if (b.hp >= full) continue;
          if (distToFootprint(u.x, u.z, b.x, b.z, w, d) > REPAIR_RADIUS) continue;
          if (!worst || b.hp / buildingHp(b.def) < worst.hp / buildingHp(worst.def)) worst = b;
        }
        if (worst) {
          worst.hp = Math.min(buildingHp(worst.def), worst.hp + REPAIR_PER_SECOND * dt);
        }
        continue;
      }

      if (u.type === 'tunneler' && u.side === 0) {
        for (const f of factions) {
          if (f.defeated) continue;
          let hit: EnemyBuilding | null = null;
          for (const b of f.buildings) {
            const [w, d] = BUILDINGS[b.name].footprint;
            if (distToFootprint(u.x, u.z, b.x, b.z, w, d) > UNDERMINE_RADIUS) continue;
            hit = b;
            break;
          }
          if (hit) { damageEnemyBuilding(f, hit, UNDERMINE_PER_SECOND * dt); break; }
        }
      }
    }
  }

  function updateTraps(): number {
    let sprung = 0;

    for (const b of state.buildings.filter(x => x.name === 'killing_pit')) {
      const cx = b.x + 0.5, cz = b.z + 0.5;
      const trod = army.enemies.some(
        e => Math.hypot(e.x - cx, e.z - cz) <= PIT_TRIGGER_RADIUS);
      if (!trod) continue;
      // Blast wider than it triggers: a column marching in file loses more
      // than the one man who found it.
      for (const e of army.enemies) {
        if (Math.hypot(e.x - cx, e.z - cz) <= PIT_BLAST_RADIUS) e.hp -= PIT_DAMAGE;
      }
      state.removeBuilding(b);
      markArea(b.x, b.z, 1, 1, 0);
      staticDirty = true;
      sprung++;
    }
    if (sprung) state.notify(`${sprung} killing pit${sprung > 1 ? 's' : ''} sprung`, 'info');

    let tipped = 0;
    for (const b of state.buildings.filter(x => x.name === 'oil_pot')) {
      const cx = b.x + 0.5, cz = b.z + 0.5;
      const near = army.enemies.some(
        e => Math.hypot(e.x - cx, e.z - cz) <= OIL_POT_TRIGGER_RADIUS);
      if (!near) continue;
      for (const e of army.enemies) {
        if (Math.hypot(e.x - cx, e.z - cz) <= OIL_POT_BLAST_RADIUS) e.hp -= OIL_POT_DAMAGE;
      }
      // And then the ground burns, which is the half a killing pit has not
      // got: the blast is what it kills, the fire is what it denies.
      lightGround(b.x, b.z);
      state.removeBuilding(b);
      markArea(b.x, b.z, 1, 1, 0);
      staticDirty = true;
      tipped++;
    }
    if (tipped) {
      audio.play('fire');
      state.notify(`${tipped} oil pot${tipped > 1 ? 's' : ''} tipped — the ground is alight`,
                   'info');
    }
    sprung += tipped;

    if (fires.length) {
      let doused = 0;
      for (const b of state.buildings.filter(x => x.name === 'water_pot')) {
        const cx = b.x + 0.5, cz = b.z + 0.5;
        const near = fires.filter(
          f => Math.hypot(f.x + 0.5 - cx, f.z + 0.5 - cz) <= WATER_POT_RADIUS);
        if (!near.length) continue;
        for (const f of near) fires.splice(fires.indexOf(f), 1);
        state.removeBuilding(b);
        markArea(b.x, b.z, 1, 1, 0);
        staticDirty = true;
        doused += near.length;
      }
      if (doused) state.notify(`Water pots doused ${doused} fire${doused > 1 ? 's' : ''}`, 'info');
    }
    return sprung;
  }

  /**
   * Set one tile alight, or feed a fire already burning on it.
   *
   * Refreshing rather than stacking. Fires are keyed on a tile and burn
   * everyone within BURN_RADIUS once a tick however many overlap, so a second
   * entry on the same square buys nothing and a fire thrower working one spot
   * would otherwise leave a hundred of them in the list.
   */
  function lightGround(x: number, z: number, share = true): void {
    if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) return;
    // Fires are lit by incendiaries, which are simulated by whoever owns the
    // man throwing them, so they have to be told rather than each client
    // guessing. `share` is false when we are applying somebody else's, or the
    // two of us would light each other's fires for ever.
    if (share) mp?.fire(x, z);
    const at = fires.find(f => f.x === x && f.z === z);
    if (at) { at.until = state.elapsed + BURN_SECONDS; return; }
    fires.push({
      x, z, until: state.elapsed + BURN_SECONDS, seed: (x * 7 + z * 13) & 7,
    });
  }

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
        // A fire is on the GROUND. A man posted on a walkway is a storey above
        // it and does not burn -- which is both obviously right and the thing
        // that makes an oil pot on your own wall usable at all: it tips over
        // whoever is at the foot of the wall and leaves your garrison alone.
        if (u.garrison) continue;
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
    // Somebody else's stone. Whether it falls is theirs to decide, and their
    // next snapshot is the answer -- see net/match.ts. Nothing is applied here,
    // or two clients would each subtract the same blow.
    if (f.net && mp) { mp.hit(f.gside, 'b', b.id, amount); return; }
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
    if (b.name === 'keep') defeatFaction(f, `${f.name}'s keep has fallen.`);
  }

  /**
   * A rival is finished, however it happened.
   *
   * Two ways in now -- pull his keep down, or kill the man in it -- so the
   * "and then what" was extracted out of the keep's own destruction handler
   * rather than written twice and left to drift apart the first time either
   * one changed.
   */
  /** Living factions this client is actually fighting. Allies do not count. */
  const livingFoes = () => factions.filter(o => !o.defeated && atWar(PLAYER, o.id));

  /**
   * Burn a faction's castle off the map and clear the ground it stood on.
   *
   * Victory did this to every rival; a beaten player's holdings need exactly
   * the same treatment, and having written it twice once already, it is one
   * function now.
   */
  function razeFaction(f: Faction): void {
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
    staticDirty = true;
  }

  function defeatFaction(f: Faction, why: string): void {
    if (f.defeated) return;
    f.defeated = true;
    if (f.lord) f.lord.defeated = true;
    // Netted factions are beaten on their owner's machine; ours is a copy, and
    // their men stop arriving in snapshots. Clear what is left so a dead
    // player's army does not stand frozen on the field for ever.
    if (f.net) {
      army.forget(f.id);
      // Their snapshots stop arriving the moment they are beaten, so nothing
      // else will ever clear this castle. Burn it, exactly as a win does.
      razeFaction(f);
      enemyWorkers.sync(factions);
    }
    // Everyone else needs to hear that one of mine has fallen, or their copy of
    // it stands for the rest of the match.
    if (!f.net && mp) mp.declareDead(f.gside);
    // A rival's name starts lower case -- "the Red Lord" -- and this is the
    // start of a sentence.
    const line = why.charAt(0).toUpperCase() + why.slice(1);
    const left = livingFoes().length;
    if (left) {
      state.notify(`${line} ${left} rival${left === 1 ? '' : 's'} left.`, 'info');
    } else {
      state.notify(`${line} The field is yours!`, 'info');
      endGame(true, `${line} The field is yours.`);
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
    if (b.name === 'keep') {
      endGame(false, 'Your keep has fallen. The fief is lost.');
    }
  }

  /** Roll the peaks and the kill tally forward. Called each tick after combat. */
  function trackStats(): void {
    if (state.population > peakPop) peakPop = state.population;
    if (state.gold > peakGold) peakGold = state.gold;
    for (const s of army.lastFallen) {
      if (s.side === PLAYER) troopsLost++; else enemyKilled++;
      // The other way a fief ends. A keep is 900 health behind whatever wall
      // its owner has built; the man inside it is 240 and can be got at, which
      // is the whole reason to have him on the field rather than in a stat.
      if (s.type !== 'lord') continue;
      if (s.side === PLAYER) {
        state.notify('Your lord is dead. The fief is lost.', 'warn');
        endGame(false, 'Your lord is dead. A fief without a lord is no fief.');
      } else {
        const f = factionOf(s.side);
        if (f) defeatFaction(f, `${f.name} is dead.`);
      }
    }
  }

  /** One lord's greatness -- the same formula for the player and every rival. */
  function greatness(side: number): number {
    let pop: number, gold: number, buildings: number;
    if (side === PLAYER) {
      pop = state.population; gold = state.gold; buildings = state.buildings.length;
    } else {
      const f = factionOf(side);
      // A faction another player owns has no lord here -- its economy is a
      // number on their machine and not one we are told. What we CAN see is its
      // castle and its army, which is most of what greatness measures anyway.
      pop = f?.lord?.population ?? 0; gold = f?.lord?.gold ?? 0;
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

    const rivals = livingFoes();
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
  function endGame(win: boolean, reason?: string): void {
    if (gameEnded) return;
    gameEnded = true;
    nextRaid = Infinity;
    // Tell the match how it went, before anything below can throw. The others
    // need to know whether to keep fighting; the server needs to know when the
    // match is done.
    mp?.report(win);
    // A beaten player's castle would otherwise stand on every other screen for
    // the rest of the match: nothing arrives to take it down, because this
    // client stops having anything to say about it. Saying so explicitly is the
    // only way the others find out.
    if (mp && !win) {
      mp.declareDead(mp.you);
      mp.stopBroadcasting();
    }

    if (win) {
      for (const f of factions) {
        if (!atWar(PLAYER, f.id)) continue;   // an ally's town is not spoils
        razeFaction(f);
      }
      army.soldiers = army.soldiers.filter(s => !atWar(PLAYER, s.side));
      enemyWorkers.sync(factions);
    }

    audio.play(win ? 'notice' : 'warn');
    audio.say(win ? 'The field is yours, my lord.' : 'Our keep has fallen.', !win);

    const foes = factions.filter(f => atWar(PLAYER, f.id));
    const defeated = foes.filter(f => f.defeated).length;
    // Final standing. A win means every rival keep has fallen, so the player is
    // the last lord standing -- greatest by survival. Otherwise rank by score.
    titleIdx = Math.max(titleIdx, titleFor(greatness(PLAYER)));
    let standing: string;
    if (win || !foes.length) {
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
      reason,
      stats: [
        { label: 'Time', value: playTime(state.elapsed) },
        { label: 'Title earned', value: TITLES[titleIdx][1] },
        { label: 'Standing', value: standing },
        { label: 'Largest settlement', value: `${peakPop} people` },
        { label: 'Gold amassed', value: Math.floor(peakGold) },
        { label: 'Popularity', value: `${Math.round(state.popularity)}%` },
        { label: 'Buildings standing', value: state.buildings.length },
        { label: 'Rival lords defeated', value: `${defeated} of ${foes.length}` },
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
    // Netted factions get no lord: their owner runs one, and a second one here
    // would build a parallel castle nobody else can see.
    if (f.net || f.defeated) continue;
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
          return { x: b.x, z: b.z, cx: b.x + w / 2, cz: b.z + d / 2,
                   reach: garrisonReach(b.name) };
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
    // A painted store draws its square, and that beats a sprite of the same
    // name -- see storeSquare. Checked FIRST, not as a fallback, which is the
    // whole fix: the stockpile had a 3x3 shed left in the atlas from before it
    // became a yard, so the ghost, the menu icon and every rival's store
    // square drew a building nobody can build.
    const def = BUILDINGS[name];
    const square = def ? storeSquare(def) : null;
    if (square) {
      const k = `${square}_${rot}`;
      return atlas.frames[k] ? k : null;
    }
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
      // The one building that draws a different model under the same name.
      if (b.name === 'drawbridge' && b.raised) {
        push('drawbridge_raised', b.x, b.z, w, d);
        continue;
      }
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

  // Edge scrolling needs the pointer wherever it is, not only over the canvas:
  // the whole point is the last few pixels at the side of the screen. Tracked
  // separately from mouseX/mouseY, which are the position ON the world and are
  // deliberately not updated while the pointer is over a panel.
  let edgeX = -1, edgeY = -1;
  /** Over a HUD panel rather than the world. #ui is pointer-events:none, so
   *  anything that is not the canvas is a panel, a notice or an overlay. */
  let edgeOverUi = false;
  /** A real pointing device. A finger has no hover, so it must never do this. */
  let edgePointer = false;
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
    // A wall, a moat, a line of ditches: press where the run starts, release
    // where it ends. Held while the cursor moves, so the press is remembered
    // whether the player then drags out a run or simply lets go on the spot --
    // a plain click is a run of one and goes through exactly the same code.
    //
    // Mouse and pen only. On a phone the one-finger drag is the ONLY way to pan
    // (two fingers pinch), so taking it over would strand anyone laying a long
    // wall with no way to see where it is going.
    if (placement.selected && placement.runnable && !placingRally && !hud.demolishing
        && e.pointerType !== 'touch') {
      const t = pickTile(e.clientX, e.clientY);
      placement.dragFrom = { x: t.x, z: t.z };
      placement.moveTo(t.x, t.z);
      return;
    }
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
        if (army.selectAt(w.x, w.z, true, true)) return;
        const shopT = switchableAt(w.x, w.z);
        if (shopT) { toggleProduct(shopT); return; }
        army.clearSelection();
        return;
      }
      if (army.selectAt(w.x, w.z, e.shiftKey)) return;
      // Nobody under the cursor. A workshop that can cut two things is the one
      // building a bare click means something to; everything else clears the
      // selection as it always did.
      const shop = switchableAt(w.x, w.z);
      if (shop) { toggleProduct(shop); return; }
      if (!e.shiftKey) army.clearSelection();
      return;
    }

    if (placement.selected && (!dragMoved || placement.dragFrom)) {
      const pending = placement.selected;
      const tiles = placement.run();
      placement.dragFrom = null;
      if (tiles.length) buildRun(pending, tiles, e.shiftKey);
      refreshOverlay();
    }
    placement.dragFrom = null;
  });
  // On the WINDOW, not the canvas: the band this feeds is at the edge of the
  // screen, and over the side panels the canvas hears nothing.
  window.addEventListener('pointermove', e => {
    edgeX = e.clientX; edgeY = e.clientY;
    edgePointer = e.pointerType !== 'touch';
    edgeOverUi = e.target !== canvas;
  }, { passive: true });
  // Leaving the window or losing focus parks it. Without this, flicking the
  // pointer off to another monitor leaves the map scrolling for ever.
  const stopEdge = () => { edgeX = -1; edgeY = -1; };
  document.addEventListener('mouseleave', stopEdge);
  window.addEventListener('blur', stopEdge);

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
      // A run being dragged out is not a pan. The camera holds still while the
      // line is drawn -- panning under a stroke would move the far end of the
      // wall away from the cursor as fast as the cursor chased it.
      if (!placement.dragFrom) iso.panByPixels(-(e.clientX - lastX), (e.clientY - lastY));
      lastX = e.clientX; lastY = e.clientY;
    }
  });
  // A cancelled pointer -- the browser taking the gesture, a window losing
  // focus mid-stroke -- must drop the run with it. Left set, `dragFrom` anchors
  // the ghost to a tile the player pressed on minutes ago and every later click
  // lays a line back to it.
  canvas.addEventListener('pointercancel', () => {
    dragging = false; boxing = false;
    selBox.style.display = 'none';
    placement.dragFrom = null;
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
                                   Math.max(bw, bd) * 0.3,
                                   garrisonReach(post.name));
      // "They cannot reach it" is the wrong answer when the truth is that
      // every man selected is a horse. Nothing about a failed order should
      // leave the player checking the stairs for a fault that is not there.
      const sel = army.selected;
      const noStairs = sel.length > 0
        && sel.every(sd => sd.def.siege || sd.def.fourLegged);
      state.notify(
        n ? `${n} to the ${post.def.label.toLowerCase()}`
          : noStairs ? 'Nothing on four legs or wheels goes up there'
          : 'They cannot reach it',
        n ? 'info' : 'warn');
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
    if (k === 'g') {
      const n = toggleDrawbridges();
      if (!n) state.notify('You have no drawbridges', 'warn');
      else {
        const up = state.buildings.some(b => b.name === 'drawbridge' && b.raised);
        state.notify(up ? `${n} drawbridge${n > 1 ? 's' : ''} raised`
                        : `${n} drawbridge${n > 1 ? 's' : ''} dropped`, 'info');
      }
    }
    if (k === 'f' && e.shiftKey) {
      // Shift-F rather than F: F already lights the pitch ditches, and that is
      // a key you hit in a hurry with an enemy in the trench.
      e.preventDefault();
      void toggleFullscreen();
      return;
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
    // BUILD_MENU decides how many there are; '6' was hard-coded when there
    // were seven groups, so Weapons already had no key before this.
    if (k >= '1' && k <= '9' && Number(k) <= BUILD_MENU.length) {
      hud.toggleCategory(Number(k) - 1);
    }
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
  // Entering or leaving fullscreen changes the viewport, and the resize event
  // for it can arrive a frame or two late -- long enough to draw the world at
  // the old size against the new canvas, which reads as the camera jumping.
  onFullscreenChange(resize);
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
  /** "a barracks", "an engineers' guild" -- for the one message that needs it. */
  function aOrAn(label: string): string {
    const l = label.toLowerCase();
    return /^[aeiou]/.test(l) ? `an ${l}` : `a ${l}`;
  }

  /**
   * Flip a workshop between the two things it can make.
   *
   * Hung off a plain click on the building rather than a panel of its own,
   * because there is no building panel to hang it in: the game has a hover
   * tooltip and no click-to-inspect, and inventing a whole inspector for one
   * two-state switch is the wrong size of answer. The tooltip already prints
   * what a workshop is making, so the affordance sits exactly where the player
   * is already looking when they wonder about it.
   *
   * Anything already held or half-made is kept. A lathe part-way through a
   * spear does not throw the ash away because you asked for a pike next.
   */
  function toggleProduct(b: PlacedBuilding): boolean {
    if (!b.def.alternate) return false;
    b.alt = !b.alt;
    const now = productionOf(b.def, b.alt)!;
    state.notify(`${b.def.label} now makes ${RESOURCE_LABELS[now.output].toLowerCase()}`,
                 'info');
    return true;
  }

  /** The workshop under a world point, if flipping it is a thing you can do. */
  function switchableAt(wx: number, wz: number): PlacedBuilding | null {
    const b = buildingAt(Math.floor(wx), Math.floor(wz));
    return b && b.def.alternate ? b : null;
  }

  function recruit(type: string): string {
    const def = SOLDIER_TYPES[type];
    if (!def) return 'Unknown soldier';
    const from = state.buildings.find(b => b.name === def.from);
    if (!from) return `You need ${aOrAn(BUILDINGS[def.from]?.label ?? def.from)}`;
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
    //
    // Aimed a little off the flag rather than at it. Army.separate() would pull
    // the pile apart on arrival anyway, but a company that lands on one tile and
    // then visibly unpacks itself looks like a bug; spread on the way there and
    // they simply arrive as a company.
    if (soldier && rallyPoint) {
      const ra = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * 1.6;
      const rx = rallyPoint.x + Math.cos(ra) * rr;
      const rz = rallyPoint.z + Math.sin(ra) * rr;
      if (army.send(soldier, rx, rz)) soldier.ordered = true;
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


  // --- multiplayer ----------------------------------------------------------
  //
  // Everything below is inert in a single-player game: `mp` is null, none of it
  // is called, and the simulation above runs exactly as it always has. That is
  // the shape the whole feature was built to: multiplayer adds a layer that
  // SPEAKS about the world, and changes almost nothing about how it works.
  //
  // The layer does three things, once a frame:
  //
  //   send      what the factions I own look like;
  //   reconcile what everyone else has said theirs look like;
  //   apply     the blows they say they struck on mine.

  /** A faction I own, packed for the wire. */
  function netGather(g: number): { buildings: NetBuilding[]; soldiers: NetSoldier[] } {
    const side = mp!.local(g);
    const soldiers = army.soldiers
      .filter(u => u.side === side && u.hp > 0 && !u.net)
      .map(u => packSoldier(u))
      .filter((u): u is NetSoldier => u !== null);
    if (side === PLAYER) {
      return {
        buildings: state.buildings
          .map(b => packBuilding({
            id: b.id, name: b.name, x: b.x, z: b.z, hp: b.hp, staff: b.staff,
            raised: b.raised, alt: b.alt,
          }))
          .filter((b): b is NetBuilding => b !== null),
        soldiers,
      };
    }
    const f = factionOf(side);
    return {
      buildings: (f?.buildings ?? [])
        .map(b => packBuilding(b))
        .filter((b): b is NetBuilding => b !== null),
      soldiers,
    };
  }

  /**
   * Make a replicated castle match the last thing its owner said about it.
   *
   * Matched by the owner's building id, never by position in the list: a castle
   * is spliced whenever anything falls, so an index would quietly come to mean a
   * different building. Tiles are marked and unmarked exactly as they are when
   * this client raises or razes something itself, because the pathfinder has to
   * agree with the picture -- a wall that is drawn but not marked is a wall
   * soldiers walk through.
   */
  function reconcileCastle(f: Faction, list: NetBuilding[]): void {
    let changed = false;
    const seen = new Set<number>();

    for (const nb of list) {
      const name = buildingName(nb.n);
      if (!name || !BUILDINGS[name]) continue;   // a build we do not have
      seen.add(nb.i);
      const [w, d] = BUILDINGS[name].footprint;
      let had = f.buildings.find(b => b.id === nb.i);
      // An id alone is not proof it is the same building. Every castle is
      // seeded locally at the start of a match -- a keep and a hovel, from the
      // same seat list everyone has -- and those placeholders take ids from
      // this client's own counter, which begins at 1 exactly as the owner's
      // does. So id 2 here can be the hovel we guessed at and id 2 there the
      // woodcutter they actually built. Checking what it IS, not just which
      // number it wears, turns that into one building replacing another
      // instead of a phantom that keeps a wrong name and position for ever.
      if (had && (had.name !== name || had.x !== nb.x || had.z !== nb.z)) {
        const [ow, od] = BUILDINGS[had.name].footprint;
        f.buildings.splice(f.buildings.indexOf(had), 1);
        evictGarrison(had.x, had.z);
        razeTiles(had.x, had.z, ow, od);
        had = undefined;
        changed = true;
      }
      if (had) {
        had.hp = nb.h;
        had.staff = nb.s;
        continue;
      }
      f.buildings.push({ id: nb.i, name, x: nb.x, z: nb.z, hp: nb.h, staff: nb.s });
      markArea(nb.x, nb.z, w, d);
      if (!BUILDINGS[name].walkable) markSolid(nb.x, nb.z, w, d);
      if (name === 'keep') f.keep = { x: nb.x + 1, z: nb.z + 1 };
      changed = true;
    }

    for (let i = f.buildings.length - 1; i >= 0; i--) {
      const b = f.buildings[i];
      if (seen.has(b.id)) continue;
      const [w, d] = BUILDINGS[b.name].footprint;
      f.buildings.splice(i, 1);
      evictGarrison(b.x, b.z);
      razeTiles(b.x, b.z, w, d);
      changed = true;
    }
    if (changed) staticDirty = true;
  }

  /**
   * Make a replicated army match its owner's last word on it.
   *
   * A man who has stopped being listed is dead, or was never ours to know
   * about; either way he falls here, with the death clip playing, rather than
   * blinking out. Army.update leaves netted men alone apart from ageing that
   * clip, so this is the only thing that moves them.
   */
  function reconcileArmy(f: Faction, list: NetSoldier[]): void {
    const side = f.id;
    const have = new Map<number, Soldier>();
    for (const u of army.soldiers) {
      if (u.net && u.side === side && u.netId !== undefined) have.set(u.netId, u);
    }
    for (const packed of list) {
      const u = unpackSoldier(packed);
      if (!u.type) continue;
      const cur = have.get(u.id);
      if (cur) {
        have.delete(u.id);
        cur.x = u.x; cur.z = u.z; cur.heading = u.heading; cur.hp = u.hp;
      } else {
        army.adopt(side, u.id, u.type, u.x, u.z, u.heading, u.hp);
      }
    }
    // Whatever is left in `have` was not in this snapshot.
    for (const u of have.values()) {
      if (u.hp > 0 && atWar(PLAYER, side)) enemyKilled++;
      u.hp = 0;
      if (u.dying <= 0) u.dying = DEATH_TIME;
    }
  }

  /** Pull in everything the other players have said since the last frame. */
  function netReconcile(): void {
    for (const f of factions) {
      if (!f.net) continue;
      const rf = mp!.remote.get(f.gside);
      if (!rf) continue;
      if (rf.buildingsDirty) { rf.buildingsDirty = false; reconcileCastle(f, rf.buildings); }
      if (rf.soldiersDirty) { rf.soldiersDirty = false; reconcileArmy(f, rf.soldiers); }
      if (rf.defeated && !f.defeated) defeatFaction(f, `${f.name} is beaten.`);
    }
  }

  /** Apply the blows and events other players have reported. */
  function netApply(): void {
    const { hits, felled, fires: lit, finished } = mp!.drain();

    for (const h of hits) {
      const side = mp!.local(h.g);
      if (h.kind === 'b') {
        if (side === PLAYER) {
          const b = state.buildings.find(x => x.id === h.i);
          if (b) damagePlayerBuilding(b, h.n);
        } else {
          const f = factionOf(side);
          const b = f?.buildings.find(x => x.id === h.i);
          if (f && b) damageEnemyBuilding(f, b, h.n);
        }
      } else if (h.kind === 'u') {
        const u = army.byId(h.i);
        // Only ever one of my own, alive, on the side the sender named.
        if (u && !u.net && u.side === side && u.hp > 0) {
          u.hp -= h.n;
          u.ordered = false;
        }
      } else if (side !== PLAYER) {
        // A labourer cut down. The player's own villagers are never a target --
        // civilianTarget only ever looks at the rivals' figures -- so this can
        // only mean one of the AI lords I am running as host.
        const f = factionOf(side);
        const b = f?.buildings.find(x => x.id === h.i);
        if (f?.lord && b) for (let k = 0; k < h.n; k++) f.lord.loseWorker(b);
      }
    }

    for (const i of felled) {
      const t = decorations[i];
      if (!t || !t.alive) continue;
      t.alive = false;
      t.regrowAt = state.elapsed + TREE_REGROW_SECONDS;
      t.claimedBy = null;
      markScatter(t.x, t.z, false);
      regrowing.push(i);
      staticDirty = true;
    }

    for (const f of lit) lightGround(f.x, f.z, false);

    for (const done of finished) {
      const who = mp!.nameOfGlobal(done.slot);
      state.notify(`${who} has ${done.win ? 'won their war' : 'been beaten'}.`, 'info');
    }
  }

  /**
   * A cheap number that changes whenever a castle I own does.
   *
   * Deliberately a fingerprint rather than a flag set at every place a building
   * is raised, razed, damaged, staffed, raised as a drawbridge or switched to
   * its alternate product. There are a dozen such places and finding all of
   * them once is not the problem -- the problem is the thirteenth, added later,
   * whose omission shows up as a building that is a few seconds stale on
   * somebody else's screen and is never traced back here. Summing costs a pass
   * over a hundred buildings once a frame, and cannot be forgotten.
   */
  function castleSignature(): number {
    let sig = 0;
    for (const b of state.buildings) {
      sig = (sig * 31 + b.id + b.hp * 7 + b.staff * 3
             + (b.raised ? 1 : 0) + (b.alt ? 2 : 0)) | 0;
    }
    for (const f of factions) {
      if (f.net) continue;
      for (const b of f.buildings) sig = (sig * 31 + b.id + b.hp * 7 + b.staff * 3) | 0;
    }
    return sig;
  }
  let lastCastleSig = 0;

  /**
   * The whole network step, on REAL time rather than simulation time.
   *
   * Deliberately outside advanceSim: a match runs at one speed for everybody
   * (see GameState.speedLocked), so scaling the send rate by a speed nobody can
   * change would only make the rate harder to reason about.
   */
  function netTick(dt: number): void {
    if (!mp) return;
    netReconcile();
    netApply();
    const sig = castleSignature();
    if (sig !== lastCastleSig) { lastCastleSig = sig; mp.touchCastle(); }
    mp.tick(dt, netGather);
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
    updateSappers(dt);
    updateTraps();
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

    // Shove the pointer at the edge of the screen and the map follows -- what
    // the camera's own description has always claimed it did.
    //
    // Off while a button is down: a drag is already panning, a box selection is
    // being drawn, and a wall run is being laid out. Scrolling under any of the
    // three moves the thing the player is aiming at.
    if (hud.edgeScroll && edgePointer && !edgeOverUi && !dragging && !boxing
        && edgeX >= 0) {
      // How far into the band, 0 at its inner lip and 1 at the very edge, so
      // the map eases into motion instead of jumping the moment you touch it.
      const depth = (near: number) =>
        near >= EDGE_BAND ? 0 : 1 - Math.max(0, near) / EDGE_BAND;
      const w = window.innerWidth, h = window.innerHeight;
      const dLeft = depth(edgeX), dRight = depth(w - 1 - edgeX);
      const dUp = depth(edgeY), dDown = depth(h - 1 - edgeY);
      const ex = dRight - dLeft, ey = dDown - dUp;
      if (ex || ey) {
        const push = Math.min(1, Math.max(Math.abs(ex), Math.abs(ey)));
        const speed = pan * (EDGE_SPEED_MIN + (EDGE_SPEED_MAX - EDGE_SPEED_MIN) * push);
        iso.panByPixels(ex * speed, ey * speed);
      }
    }

    // --- simulation ---
    // Real seconds scaled by the chosen speed: 0 at Pause, 3x at Fast. The
    // camera, the ghost and the HUD above and below this line stay on real
    // time, so a paused settlement is still one you can look around and plan
    // in -- unlike the Esc menu, which stops the frame outright.
    advanceSim(dt * state.speedMult);
    netTick(dt);
    matchChat?.tick();

    // --- placement ghost ---
    if (placement.selected) {
      const t = pickTile(mouseX, mouseY);
      const ok = placement.moveTo(t.x, t.z);
      const def = BUILDINGS[placement.selected];
      runPlan = planRun(placement.selected);
      if (placement.dragFrom) {
        // Mid-stroke the label counts the run and prices it, because that is
        // the decision being made: not "may this tile take a wall" but "how
        // much wall am I buying".
        hud.showGhost(mouseX, mouseY,
          runPlan.count
            ? `${def.label} × ${runPlan.count} · ${runCost(placement.selected, runPlan.count)}`
            : placement.lastCheck.reason || 'Nothing can be laid here',
          runPlan.count > 0);
      } else {
        hud.showGhost(mouseX, mouseY,
          ok ? def.label : placement.lastCheck.reason, ok);
      }
    } else {
      runPlan = { tiles: [], legal: [], count: 0 };
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
      const making = productionOf(def, mine.alt);
      if (making) {
        bits.push(`${making.amount} ${goodName(making.output, making.amount)}`
                  + ` / ${making.seconds}s`);
      }
      if (def.alternate) {
        // The switch has no button anywhere, so the tooltip has to be the
        // whole instruction manual for it.
        // Plural here whatever the batch size: this names the product line
        // ("make pikes"), not a count of them the way the line above does.
        const other = productionOf(def, !mine.alt)!;
        bits.push(`click to make ${RESOURCE_LABELS[other.output].toLowerCase()}`);
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
      // A shed's stock, and equally a quarry yard's: what is standing on the
      // ground waiting to be carried is exactly what a player wondering where
      // their stone has got to needs to read.
      const what = (rows: [string, number | undefined][]) =>
        rows.map(([r, n]) => `${n} ${r}`).join(', ');
      if (def.relay && held.length) {
        // A shed's pile now has two halves that look identical and mean
        // opposite things: goods on their way IN to the store, and inputs kept
        // OUT here for the workshops around it. Saying which is which is the
        // difference between "why is there wheat in my storehouse" and reading
        // the building at a glance.
        const demand = workerWorld.relayDemand(mine);
        const out = held.filter(([r]) => !demand.has(r as Resource));
        const keep = held.filter(([r]) => demand.has(r as Resource));
        if (out.length) bits.push(`${what(out)} to go out`);
        if (keep.length) bits.push(`${what(keep)} for the workings`);
      } else if ((def.needsHauler || def.hauler) && held.length) {
        bits.push(def.needsHauler ? `${what(held)} waiting to be hauled` : what(held));
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
        // A horse or a dog does not fall over like a man. The clip is a human
        // body and there is no animal version of it, so the four-legged hold
        // their own idle for the second and a bit they lie there instead of
        // turning into a dying peasant on the way out.
        key = sd.def.fourLegged
          ? (atlas.frames[`${sd.type}_idle_${dir}_0`]
              ? `${sd.type}_idle_${dir}_0` : `idle_${dir}_0`)
          : atlas.frames[`death_${dir}_${f}`] ? `death_${dir}_${f}` : `idle_${dir}_0`;
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
        // Every tile of the dragged run, each tinted by its OWN verdict -- the
        // whole point of showing the line is seeing where it will break and
        // where the stone runs out. Not a drag: the plan is the one hovered
        // tile, so this is the single ghost it always was.
        runPlan.tiles.forEach((t, i) => {
          const [gx, gz] = spriteAnchor(t.x, t.z, d);
          ghostBatch.add(frame, atlas.size, ppuOf(frame),
            gx, terrain.heightAt(t.x, t.z), gz, footprintDepthBias(w, d, rot) + 6,
            runPlan.legal[i] ? [0.55, 1.20, 0.55] : [1.30, 0.45, 0.40]);
        });
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
        up: b.raised ? 1 : undefined,
        alt: b.alt ? 1 : undefined,
      })),
      // Factions another player owns are left out: their economy is a set of
      // numbers on someone else's machine that this client is never told, so
      // there is nothing honest to write down. A match cannot be saved anyway
      // -- the pause menu hides the slots -- and this keeps `snapshot()` from
      // throwing if anything else ever asks for one.
      factions: factions.filter(f => f.lord).map(f => ({
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
      // A drawbridge saved in the up position is solid, walkable def or not.
      b.raised = !!sb.up;
      // A workshop keeps what it was set to cut. An older save has no field
      // here, which reads as the default product -- exactly what it was making.
      b.alt = !!sb.alt;
      if (!def.walkable || b.raised) markSolid(sb.x, sb.z, w, d);
    }
    for (const sf of sv.factions) {
      const f = factionOf(sf.id);
      if (!f) continue;                    // map now has fewer rivals
      for (const sb of sf.buildings) {
        const def = BUILDINGS[sb.n];
        if (!def) continue;
        const [w, d] = def.footprint;
        // Ids are not saved: they only have to be unique and stable within one
        // run, and a single-player save has nobody to address them from.
        f.buildings.push({
          id: nextEnemyBuildingId++, name: sb.n,
          x: sb.x, z: sb.z, hp: sb.hp, staff: sb.staff,
        });
        markArea(sb.x, sb.z, w, d);
        if (!def.walkable) markSolid(sb.x, sb.z, w, d);
      }
      const ek = f.buildings.find(b => b.name === 'keep');
      if (ek) f.keep = { x: ek.x + 1, z: ek.z + 1 };
      f.defeated = sf.defeated;
      if (!f.lord) continue;
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
      markScatter(d.x, d.z, false);
      regrowing.push(i);
    }

    for (const su of sv.soldiers) {
      const u = army.recruit(su.t, su.x, su.z, su.side);
      if (!u) continue;
      u.hp = su.hp;
      if (su.h) u.hold = true;
      if (su.g) {
        // Recomputed from the building rather than serialised: a save made
        // before posts carried a reach would otherwise put a man on a lookout
        // tower with a plain tower's sight.
        u.garrison = {
          x: su.g[0], z: su.g[1], sx: su.g[2], sz: su.g[3],
          reach: garrisonReach(buildingNameAt(su.g[0], su.g[1])),
        };
      }
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
    placement.cancel();
    // In a match the world keeps turning: freezing the loop would stop this
    // castle -- and everything it is telling the other players -- while three
    // other people carried on building. So the menu opens over a running game
    // and says so.
    if (!mp) paused = true;
    showPause({
      snapshot,
      match: !!mp,
      onResume: () => { paused = false; last = performance.now(); },
    });
  }

  if (restore) applySave(restore);

  /**
   * Put a lord at every keep that has not got one.
   *
   * Called after the save is applied rather than at placement, and written as
   * "seat anyone missing" rather than "seat everyone", because it has three
   * callers' worth of situations to cover with one rule: a fresh game where
   * nobody has one, a save made after this release where everybody already
   * does, and a save made BEFORE it where the keeps are there and the lords
   * are not. The last of those is the reason it cannot simply spawn.
   */
  function seatLords(): void {
    const seated = (side: number) => army.soldiers.some(
      s => s.type === 'lord' && s.side === side && s.hp > 0);
    const free = (x: number, z: number) => {
      for (let r = 0; r <= 5; r++) {
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r;
          if (!paths.isBlocked(Math.floor(nx), Math.floor(nz))) return { x: nx, z: nz };
        }
      }
      return { x, z };
    };
    const seat = (side: number, kx: number, kz: number) => {
      if (seated(side)) return;
      const at = free(kx, kz);
      const s = army.recruit('lord', at.x, at.z, side);
      // Every lord holds his ground to begin with, the player's included.
      // The default stance is aggressive -- chase anything you notice -- and
      // for the one unit whose death ends the game that is a trap: he would
      // set off after the first raider to come within sight of the gate and
      // the player would lose a fief to a stance they never chose. The order
      // is one keypress away when they do choose it.
      if (s) s.hold = true;
    };

    const mine = state.buildings.find(b => b.name === 'keep');
    if (mine) seat(PLAYER, mine.x + 1.5, mine.z + 3.4);
    for (const f of factions) {
      if (f.defeated) continue;
      const k = f.buildings.find(b => b.name === 'keep');
      if (k) seat(f.id, k.x + 1.5, k.z + 3.4);
    }
  }
  seatLords();

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
    // A faction another player owns has no lord here to ask -- its economy is
    // a number on their machine. It reports as netted rather than throwing.
    lordStatus: (i?: number) => i === undefined
      ? factions.map(f => f.lord ? { who: f.name, ...f.lord.status() }
                                 : { who: f.name, net: true })
      : factions[i]?.lord?.status(),
    lordAttack: (i = 0) => factions[i]?.lord?.attackNow() ?? 0,
    /** Force the end screen, for testing. `win=true` also razes the rivals. */
    endGame: (win = true) => {
      if (win) for (const f of factions) { f.defeated = true; if (f.lord) f.lord.defeated = true; }
      endGame(win);
    },
    /** The match this client is in, or null in a single-player game. */
    match: () => mp && {
      you: mp.you, host: mp.host, mode: mp.mode,
      mine: mp.mine, rivals: mp.rivalSides, connected: mp.connected,
      factions: factions.map(f => ({
        id: f.id, gside: f.gside, name: f.name, net: f.net,
        defeated: f.defeated, buildings: f.buildings.length,
        soldiers: army.allOf(f.id).length,
      })),
    },
    greatness: (side = 0) => greatness(side),
    checkStanding: () => checkStanding(),
    /** Hold off the next raid. `setNextRaid(Infinity)` disables them. */
    setNextRaid: (t: number) => { nextRaid = t; },
    raidState: () => ({ nextRaid, raidNumber, elapsed: state.elapsed }),
    renderer, scene, sprites,
    occupiedAt: (x: number, z: number) => occupied[z * MAP_W + x],
    regrowForest,
    // The player's own click, with the mouse taken out of it: one tile handed
    // to the same buildRun a release calls, so a test can never pass against
    // code the game does not run.
    build: (name: string, x: number, z: number) => {
      const r = buildRun(name, [{ x, z }], true);
      placement.cancel();
      return r.built ? name : (r.refusal || 'failed');
    },
    /** Lay a run of `name` from one tile to another, as a drag would. */
    buildLine: (name: string, x1: number, z1: number, x2: number, z2: number) => {
      placement.cancel();
      placement.select(name);
      placement.dragFrom = { x: x1, z: z1 };
      placement.moveTo(x2, z2);
      const tiles = placement.run();
      const r = buildRun(name, tiles, true);
      placement.dragFrom = null;
      placement.cancel();
      return { asked: tiles.length, built: r.built, refusal: r.refusal };
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

  // The chat panel, and with it the connection light -- the only way a player
  // can tell "nobody is doing anything" from "the line has dropped".
  const matchChat = mp ? showMatchChat(mp) : null;

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
      return main(choice.map, null, choice.setup.difficulty, choice.setup);
    }
    if (choice.kind === 'multiplayer') {
      // Sign in if need be, then the lobby, then the host's placement screen.
      // Resolves only when a match actually begins; backing out at any point
      // lands back on the title screen with the loop intact.
      const started = await multiplayer(() => accountScreen());
      if (!started) continue;
      const { match: view, you } = started;
      const mp = new MatchRuntime(view, you, net);
      // The seats arrive in wire order -- the humans by slot, then the AI
      // lords. `rivalSides` puts the others into the order the game creates
      // its factions in, which is the one thing both ends have to agree on.
      const seats = view.seats ?? [];
      const setup: LordSetup = {
        you: seats[you] ?? { x: MAP_W >> 1, z: MAP_H >> 1 },
        rivals: mp.rivalSides.map(g => seats[g]).filter(Boolean),
        difficulty: view.difficulty,
      };
      loading.textContent = `mustering on ${view.map.name.toLowerCase()}…`;
      return main(view.map, null, view.difficulty, setup, mp);
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
