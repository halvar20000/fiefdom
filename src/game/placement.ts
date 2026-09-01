import { WATER_REACH, BUILDINGS, STORE_SPRITES, type TerrainNeed } from './defs';
import type { GameState } from './state';

export interface PlacementWorld {
  /** Every tile of the footprint flat and at one level? */
  isFlat(x: number, z: number, w: number, d: number): boolean;
  /** Ground type name at a tile. */
  groundAt(x: number, z: number): string;
  /** Already taken by a building, tree or rock? */
  isOccupied(x: number, z: number): boolean;
  inBounds(x: number, z: number, w: number, d: number): boolean;
  /**
   * Is this footprint on ground you are allowed to build on -- within your
   * lands? Border pieces (walls, towers, gatehouses) are allowed a little past
   * the edge, since planting them is how the border is pushed out.
   */
  territoryOk(name: string, x: number, z: number, w: number, d: number): boolean;
}

export interface PlacementCheck {
  ok: boolean;
  reason: string;
}

const TERRAIN_LABEL: Record<TerrainNeed, string> = {
  any: '', green: 'green land', rock: 'rock', sand: 'open ground',
  marsh: 'a pitch marsh',
};

function terrainAllows(need: TerrainNeed, ground: string): boolean {
  // Nothing but a pitch rig stands in a bog. 'any' means any DRY ground --
  // otherwise marsh would quietly become ordinary buildable land and the
  // player could pave over the one hazard the map gives them.
  // Water takes nothing at all -- not even the pitch rig that a bog takes.
  // It is checked before marsh so that 'marsh' cannot be read as "any wet
  // ground" and let a rig be floated out onto a lake.
  if (ground === 'water') return false;
  if (ground === 'marsh') return need === 'marsh';
  if (need === 'marsh') return false;
  switch (need) {
    case 'any': return true;
    case 'green': return ground === 'grass' || ground === 'grass_dark';
    case 'rock': return ground === 'rock';
    case 'sand': return ground === 'sand' || ground === 'scrub';
  }
}

/**
 * Build mode: what is selected, where the cursor is, and whether it may go there.
 *
 * The checks run in the order the player would think of them -- off the map,
 * blocked, wrong ground, too uneven, too expensive -- so the message they see
 * is the most fundamental reason rather than whichever test happened to run first.
 */
export class Placement {
  selected: string | null = null;
  hover: { x: number; z: number } | null = null;
  lastCheck: PlacementCheck = { ok: false, reason: '' };

  constructor(private world: PlacementWorld, private state: GameState) {}

  select(name: string | null): void {
    this.selected = name === this.selected ? null : name;
  }

  cancel(): void {
    this.selected = null;
    this.hover = null;
  }

  check(name: string, x: number, z: number): PlacementCheck {
    const def = BUILDINGS[name];
    if (!def) return { ok: false, reason: 'Unknown building' };
    const [w, d] = def.footprint;

    if (!this.world.inBounds(x, z, w, d)) {
      return { ok: false, reason: 'Outside the map' };
    }

    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) {
        if (!this.world.isOccupied(x + dx, z + dz)) continue;
        // Water marks itself occupied so that nothing is ever scattered or
        // pathed onto it, which means it reaches this test before the ground
        // rules below and would otherwise be reported as a tree in the way.
        return {
          ok: false,
          reason: this.world.groundAt(x + dx, z + dz) === 'water'
            ? 'You cannot build on water'
            : 'Something is in the way',
        };
      }
    }

    // A store grows out of itself, as in Stronghold: squares must touch what is
    // already there. Without this a "stockpile" is just a free 1x1 building you
    // sprinkle next to each workshop, and the whole point -- one place where
    // you can see everything you own -- evaporates. Each store checks only its
    // own squares, so a granary bay may not annex the yard.
    // Only the PAINTED stores, which is what STORE_SPRITES says. The armoury is
    // a whole building rather than a square you extend, so a second one belongs
    // wherever the workshops are, not welded to the side of the first.
    if (def.storeFor && STORE_SPRITES[def.storeFor]) {
      const own = this.state.storeTiles(def.storeFor);
      if (own.length
          && !own.some(t => Math.abs(t.x - x) + Math.abs(t.z - z) === 1)) {
        return { ok: false, reason: `Must touch the ${def.storeFor}` };
      }
    }

    // Run this for EVERY building, including terrain: 'any'.
    //
    // It used to be skipped for 'any', which quietly exempted hovels, markets,
    // walls and most of the game from the ground rules -- so a marsh could be
    // paved over with housing and stopped being a hazard at all. 'any' means
    // any DRY ground, and terrainAllows is what knows that.
    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) {
        const ground = this.world.groundAt(x + dx, z + dz);
        if (!terrainAllows(def.terrain, ground)) {
          return {
            ok: false,
            reason: ground === 'marsh' && def.terrain !== 'marsh'
              ? 'The ground is too boggy to build on'
              : `Must be built on ${TERRAIN_LABEL[def.terrain]}`,
          };
        }
      }
    }

    if (!this.world.isFlat(x, z, w, d)) {
      return { ok: false, reason: 'The ground is not level' };
    }

    // Checked after the ground and level tests on purpose: "must be built on a
    // shore" is only useful advice once the spot is otherwise legal, and a
    // player dragging a hut across open desert should be told the ordinary
    // reason first.
    if (def.needsWater && !this.nearWater(x, z, w, d)) {
      return { ok: false, reason: 'Must be built on a shore' };
    }

    // Within your own lands. Kept near the end, after the ground is otherwise
    // fine, so a spot that fails for a plainer reason is reported by that reason
    // first. Walls, towers and gatehouses are how the lands are extended, so
    // they answer to a looser boundary than everything else.
    if (!this.world.territoryOk(name, x, z, w, d)) {
      return {
        ok: false,
        reason: 'Outside your lands — extend them with walls, towers or a gatehouse',
      };
    }

    if (!this.state.canAfford(def.cost)) {
      const missing = Object.entries(def.cost)
        .filter(([r, n]) => this.state.stock[r as never] < (n ?? 0))
        .map(([r]) => r);
      return { ok: false, reason: `Not enough ${missing.join(' and ')}` };
    }

    return { ok: true, reason: '' };
  }

  /** Is there open water within reach of this footprint's edge? */
  private nearWater(x: number, z: number, w: number, d: number): boolean {
    const r = WATER_REACH;
    for (let tz = z - r; tz < z + d + r; tz++) {
      for (let tx = x - r; tx < x + w + r; tx++) {
        if (this.world.groundAt(tx, tz) === 'water') return true;
      }
    }
    return false;
  }

  /** Update the hovered tile. Returns whether it is a legal spot. */
  moveTo(x: number, z: number): boolean {
    if (!this.selected) { this.hover = null; return false; }
    this.hover = { x, z };
    this.lastCheck = this.check(this.selected, x, z);
    return this.lastCheck.ok;
  }

  /** Try to build at the hovered tile. Returns the building name if placed. */
  commit(): string | null {
    if (!this.selected || !this.hover) return null;
    const check = this.check(this.selected, this.hover.x, this.hover.z);
    if (!check.ok) {
      this.state.notify(check.reason, 'warn');
      return null;
    }
    const def = BUILDINGS[this.selected];
    this.state.spend(def.cost);
    this.state.addBuilding(this.selected, this.hover.x, this.hover.z);
    this.state.assignWorkers();
    return this.selected;
  }
}
