import { BUILDINGS, type TerrainNeed } from './defs';
import type { GameState } from './state';

export interface PlacementWorld {
  /** Every tile of the footprint flat and at one level? */
  isFlat(x: number, z: number, w: number, d: number): boolean;
  /** Ground type name at a tile. */
  groundAt(x: number, z: number): string;
  /** Already taken by a building, tree or rock? */
  isOccupied(x: number, z: number): boolean;
  inBounds(x: number, z: number, w: number, d: number): boolean;
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
        if (this.world.isOccupied(x + dx, z + dz)) {
          return { ok: false, reason: 'Something is in the way' };
        }
      }
    }

    // A store grows out of itself, as in Stronghold: squares must touch what is
    // already there. Without this a "stockpile" is just a free 1x1 building you
    // sprinkle next to each workshop, and the whole point -- one place where
    // you can see everything you own -- evaporates. Each store checks only its
    // own squares, so a granary bay may not annex the yard.
    if (def.storeFor) {
      const own = this.state.storeTiles(def.storeFor);
      if (own.length
          && !own.some(t => Math.abs(t.x - x) + Math.abs(t.z - z) === 1)) {
        return {
          ok: false,
          reason: `Must touch the ${def.storeFor === 'granary' ? 'granary' : 'stockpile'}`,
        };
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

    if (!this.state.canAfford(def.cost)) {
      const missing = Object.entries(def.cost)
        .filter(([r, n]) => this.state.stock[r as never] < (n ?? 0))
        .map(([r]) => r);
      return { ok: false, reason: `Not enough ${missing.join(' and ')}` };
    }

    return { ok: true, reason: '' };
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
