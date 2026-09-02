# Crusader gaps — backlog

What Stronghold Crusader has that Fiefdom does not, as an ordered work list.

## Where this came from

The fork at `Dadud/fiefdom` ran a series of Cursor background agents over the
codebase as it stood on **21 Aug 2026** (`b5d3612`) and produced eleven
`cursor/*` branches and eight open pull requests of Crusader feature work.
Its `main` is an ancestor of ours and carries nothing we lack; all of the
content is on those branches, sourced from its `Dev` branch.

**This is a design backlog, not a merge queue.** The branches are not being
merged, for two concrete reasons:

1. **Their art is baked for the old zoom.** The fork's `buildings.json` holds
   516 sprites at `scale: 2`; ours holds 368 at `scale: 3`. Merging the sprite
   PR alone (206 files) would drop a large block of half-resolution art back
   into the atlas and undo the mixed-scale cleanup finished in 1.34.2.
2. **The base has moved.** We are 54+ commits past where they branched, and the
   drift is concentrated in exactly the files those PRs touch — `defs.ts`,
   `main.ts`, `assets.ts`, `sprites.ts`, and the whole sprite catalogue.

So each item below gets built our way: a `defs.ts` entry, geometry in
`tools/render/buildings.py` rendered through `rig.py` at `SPRITE_RENDER_SCALE`,
and a changelog entry. What the fork gives us is the *inventory* — a
well-researched list of what is missing — not the code.

## How the list was derived

Building and unit keys in `src/game/defs.ts` on both sides: 96 in their `Dev`
branch, 46 in ours. Everything below is in theirs and not in ours. Only
`pharmacy` runs the other way.

Already ours and therefore absent from this list: the weapons chain (fletcher,
poleturner, blacksmith, armourer, armoury), church, gallows, gatehouse,
wall-manning via towers, flying arrows and bolts (`src/engine/projectiles.ts`),
and mobile touch controls (`src/ui/touch.ts`).

## Tranches

Ordered cheapest and most self-contained first. A "simple" building is about
seventeen lines of geometry plus a registry line and a `defs.ts` entry — see
`gallows()` in `tools/render/buildings.py` for the shape of one.

### 1. Pure logic — no art *(done, 1.34.3)*

- [x] `FOOD_VARIETY_BONUS` had five slots for a five-item `FOOD_RESOURCES`, so
      the fifth kind of food earned nothing and a fishery could never pay for
      itself in popularity. Extended on our own +3-a-kind ladder, not the
      fork's numbers.
- [x] Build-menu digits `1`–`6` toggle a category shut again. The category
      buttons always toggled on click; the keys only ever opened.

### 2. Popularity buildings — simple geometry *(done, 1.35.0)*

- [x] Good: `well` (2), `pond` (5), `statue` (6), `maypole` (7),
      `dancing_bear` (9) — the number is `beauty`.
- [x] Fear: `stocks`, `dunking_stool`, `stretching_rack`, `gibbet`, `dog_cage`,
      `burning_stake`, `dungeon`, slotted around the existing `gallows` as a
      monotonic ladder from 1.3x to 2.4x tax.

Both sets extended mechanics we already had — `beauty` for the good ones,
`fear: { popularity, taxMultiplier }` for the bad — so these were art plus a
definition each, with no new systems.

Worth knowing for the tranches below: `fearEffect` picks the single strongest
fear building and ignores the rest, so those seven are a ladder to climb rather
than a set to collect, and each rung has to cost more popularity than the one
under it or it is strictly worse than its predecessor. There is a check for
that ordering. The `dancing_bear` took three attempts — stacked cylinders read
as a burnt stump every time, and it only worked once it was built the way
`_ox()` builds livestock, as one lofted skin through tapering rings.

### 3. Religion tiers *(done, 1.36.0)*

- [x] `shrine` (serves 8, 1x1), `chapel` (16), `cathedral` (72, 3x3, and the
      only building that is also worth `beauty`). `church` stays at 24.

The open question was whether religious coverage should scale with population
the way `beauty` erodes. It turned out not to need deciding: coverage is
already `sum(serves) / population`, so it thins on its own as a town grows and
a second mechanic would have been double-counting. The tiers only change how
much ground one plot buys.

`state.ts` matched `b.name === 'church'` to count coverage, which was correct
for exactly one building and silently wrong for a second -- a chapel would have
been built, paid for and counted for nothing. Buildings now declare
`coverage: 'religion' | 'health'` and the getter sums `def.serves` by kind, so
tranche 4 onward can add a coverage building without touching `state.ts`.

### 4. Economy *(done, 1.37.0)*

- [x] `tanner`, plus `hides` as a real resource and a `byproduct` field on
      `Production` to make one.
- [x] ~~`apothecary`~~ — **not a gap.** Their apothecary is our `pharmacy`
      under another name: same 2x2 town building, same job ("keeps disease off
      an overcrowded town"). Theirs carries no mechanic at all beyond the
      description; ours has `serves`/coverage. Nothing to take. Worth checking
      the remaining tranches for more of these before building anything.

The tanner is a second, iron-free route to `armour` rather than a new weapon
type: the armourer forges mail from iron, the tanner cures leather from hides,
and both fill the same rack. That gives pig farming a war use and makes a
swordsman reachable without an iron mine, without touching the existing
balance — it adds a path rather than changing one.

`Production` gained a `byproduct`, because butchering yields meat *and* a hide
from one job and the worker loop carries one load to one store. The byproduct
is credited when the main load is set down, clamped to the room available, and
skipped on a drop into a relay shed. Anything else needed a second carry slot
the state machine has no state for.

### 5. Castle works *(done, 1.40.0)*

- [x] `perimeter_turret` (1x1, deck 1.14), `round_tower` (3x3, deck 1.92, hp
      900), `lookout_tower` (2x2, deck 2.30, timber and fragile with it).
- [x] `moat` (paintable, blocks, nobody mans it) and `drawbridge` (walkable
      down, solid up, G toggles them all).
- [x] `stairs` (a way up that is not a place to fight from), `killing_pit`
      and `water_pot` (both one-shot and consumed, like a pitch ditch).
- [ ] ~~`oil_smelter`~~ — **deferred to tranche 7, on purpose.** In Crusader
      the smelter fills pots that ENGINEERS carry and pour. Without engineers
      there is nobody to man it, and a smelter that boils oil onto passers-by
      by itself is a different building wearing the name. It waits for the
      troops.

The three towers reused the garrison system, but reusing it meant fixing two
things that were correct only because there had been exactly one tower.

`GARRISON_RANGE_BONUS` was flat, so a lookout tower would have seen no further
than a wall and had no reason to exist. Reach is now the base bonus plus
`GARRISON_RANGE_PER_TILE` for every tile of deck **above a plain tower's**,
measured from the tower rather than the ground so wall, tower and gatehouse
keep exactly the reach they always had. Nothing existing moved.

`STAIR_SOURCES` in `access.ts` listed the buildings a man can climb --
`tower`, `gatehouse` -- so a new tower not remembered there would be built,
look like a tower, and quietly refuse a garrison. It is inverted now:
`WALKWAY_ONLY` names the one thing that is a walkway rather than a building,
and everything else that can be garrisoned has its own stair.

Deck heights in `GARRISON_HEIGHT` are read off the Blender models and are the
top of the surface a man stands on, not the merlons above it. Changing a model
means changing that table.

The moat needed no new pathing after all: a building that is not `walkable`
already calls `markSolid` and blocks, and `wouldSealSomethingOff` already stops
a player walling themselves in. The drawbridge is the only thing in the game
whose passability changes after placement, which is why `raised` lives on the
placed building and not on the def.

**Read this before adding another building.** `BUILD_MENU` in `defs.ts` is the
only thing that makes a building placeable, and it is hand-maintained. Twenty-
one buildings from tranches 2 to 5 were defined, costed, rendered, simulated
and completely unreachable because nothing added them to it, and nothing
anywhere said so. `unlistedBuildings()` now reports it through the same loud
banner as a stale asset manifest. Keep it passing.

`stairs` turned out to be a building rather than a property of the wall, and a
useful one: it is not garrisonable, so it never appears in `GARRISON_HEIGHT`
and nobody stands on it. It works by making the garrison tiles NEXT to it into
stair sources, which is the whole idea — a way up that is not itself a place to
fight from. That keeps the perimeter turret's niche intact: the turret is
stone, is manned, and defends; stairs are timber, cheaper, and only grant
access.

The traps needed no new systems. `updateFires` was already the pattern for a
per-tick proximity scan, so `updateTraps` sits beside it in the same tick.
Both new pieces check `army.enemies` rather than every soldier, unlike a pitch
fire which burns whoever is standing in it — a trap that killed its own
garrison would be a bug, not a nuance.

### 6. Recruitment

`engineers_guild`, `tunnelers_guild`, `mercenary_post`, `stables`. Each is a
barracks-alike that recruits a different pool, so the barracks recruitment path
generalises rather than being copied four times.

### 7. Troops

`knight`, `pikeman`, `maceman`, `crossbowman`, `slinger`, `horse_archer`,
`arabian_swordsman`, `assassin`, `slave`, `ladderman`, `engineer`, `tunneler`,
`war_dog`, `lord`.

The `SOLDIERS` dict in `tools/render/render_units.py` already parameterises a
body by palette, kit and attack clip, so foot troops are comparatively cheap.
Mounted units (`horse_archer`) and `war_dog` need a new body entirely.

### 8. Siege

`ballista`, `mangonel`, `siege_tower`, `portable_shield`, `fire_thrower`,
`oil_pot`. `tools/render/siege.py` has the pattern from the catapult, ram,
trebuchet and fire ballista. Engineer-assembled engines depend on tranche 6.

## Notes

- Their PR #8 adds stones to the missile set; we already have `arrow` and
  `bolt` in `src/engine/projectiles.ts`, so that is an extension rather than a
  new system.
- Their PR #10 (mobile controls) duplicates `src/ui/touch.ts`, which already
  has the thumb bar, pinch-zoom and tap-to-order. Nothing to take.
- `tools/render/buildings.py` is large and hand-written; every new building is
  geometry authored by hand, which is what makes the tranche ordering above
  matter more than it would in a project with procedural art.
