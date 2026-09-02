# Crusader gaps — backlog

What Stronghold Crusader had that Fiefdom did not, as an ordered work list.

**All eight tranches are done** (1.34.3 through 1.49.0). Everything below is
kept as the record of what was built and, more usefully, of what each piece
turned on — the mechanics that had to be generalised first, the three or four
places where a hand-written list silently swallowed a new thing, and the
handful of art decisions that only revealed themselves once something was
actually rendered. Four items are marked **not a gap**: the apothecary, the
ballista, the mangonel and the fork's stones, each of which is something we
already had under another name.

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

### 6. Recruitment *(done, 1.42.0 and 1.45.0-1.46.0)*

- [x] Recruiting generalised. `SoldierType.from` was a union of the only two
      buildings that existed, and the two places that switched on it wrote
      "you need a barracks" by hand -- so a guild would have told the player to
      build a barracks. It is a building name now and the message comes from
      that building's own label.
- [x] `engineers_guild` -> `engineer`, `tunnelers_guild` -> `tunneler`.
- [x] `mercenary_post` (1.45.0) and `stables` (1.46.0). Both waited on tranche
      7, exactly as written here: a post that recruits nobody and a stable with
      nothing to mount are not buildings, they are placeholders. They were
      built in the same releases as the men they sell.

The mercenary post turned out to be the more interesting of the two, because
the thing that makes it worth having is not its roster but its BILL. Every
unit it sells costs gold and nothing else, which is the one shape of army the
game could not previously field: a player with no iron, no fletcher and no
armoury had no soldiers at all, and a player whose armoury had just burned had
no way to raise any quickly. Priced above the barracks for the near-equivalent
man, so what gold buys is speed and independence rather than quality.

The stables is one building for one unit and it earns it: a barracks can arm a
man, it cannot mount one.

`SOLDIER_ORDER` was the same trap as `BUILD_MENU` -- hand-written, the only
thing the recruit panel iterates, so a unit missing from it is defined, costed,
sprited and unrecruitable in silence. `unlistedSoldiers()` guards it now,
through the same startup banner.

The two units earn their guilds by doing something no soldier does, rather than
being more soldiers: the engineer mends the nearest damaged building he is
standing by, the tunneller undermines whatever enemy building he stands beside.
Both have zero damage on purpose -- a unit that mends AND fights just replaces
the swordsman. Both rates are per second and deliberately slow: a wall that
comes back as fast as a catapult knocks it down makes siege pointless.

### 7. Troops *(done, 1.44.0-1.47.0)*

- [x] `pikeman`, `maceman`, `crossbowman` (1.44.0). Each needed a weapon we did
      not make, and the honest way to make one was Crusader's own: the
      poleturner turns spears OR pikes off the same lathe, the blacksmith beats
      swords OR maces off the same anvil, the fletcher builds bows OR
      crossbows. `alternate` on the def, `alt` on the placed building,
      `productionOf` to resolve the two. That is what makes the new units cost
      a decision rather than merely more gold: there is one lathe.
- [x] `slave`, `slinger`, `arabian_swordsman`, `assassin` (1.45.0), and
      `ladderman` at the siege camp.
- [x] `knight`, `horse_archer`, `war_dog` (1.46.0).
- [x] `lord` (1.47.0), which is not a troop at all: he is placed with the keep,
      he is the only unit whose death ends a fief, and he needed `unique` on
      the def so the "unrecruitable soldier" guard leaves him alone.
- [x] `engineer`, `tunneler` were already done in 1.42.0.

Three things worth knowing before the next unit goes in.

**The atlas was the real constraint, not the modelling.** Every sprite goes
into ONE texture -- the scene is a single back-to-front batch and sprites in
two batches cannot be sorted against each other -- so a hardware limit of 8192
is a hard cap on the whole catalogue, and at scale 3 it was already 8192x6588
with none of this in it. Twelve new bodies would not have fitted. What made
room was `trim_sprites.py` (1.43.0): crop every sprite to the pixels above the
alpha the shader already discards, move its anchor by the crop, which is an
identity. 8192x6588 became 8192x4272. Run it after every render.

**A soldier renders three clips, not five.** The army draw loop asks for idle,
walk and attack and there is no fourth case; five bodies had been carrying 640
sprites of themselves digging and swinging a pick.

**The two silhouette rules that came out of actually rendering things.** A
weapon in a rider's hand hangs at the level of the horse's barrel and is inside
the animal from half the facings -- the knight carries a lance for that reason
and no other. And an animal inside a building is a brown shape in a brown
shadow: the stables' horse stands in the open yard, which is the only place
any of the four renders can see it.

`SOLDIERS` in `tools/render/render_units.py` parameterises a body by palette,
kit and attack clip, so a foot soldier really is about ten lines. The mounted
units and the dog are not on that rig at all -- there is no horse in the Mixamo
set and no dog, and retargeting a biped onto four legs does not work -- so
`tools/render/mounts.py` builds them the gazelle's way, primitives posed per
frame with no armature.

### 8. Siege *(done, 1.48.0-1.49.0)*

- [x] `siege_tower`, `portable_shield` (1.48.0). Neither does any damage; what
      each carries is ACCESS. The tower grants `ladders` -- the same flag the
      ladderman has -- so it needed no new mechanic at all, only a def and a
      model. The mantlet needed one: `shields` on the def, `covered` on the
      soldier, and a `ranged` flag on the blow so cover is applied when the
      blow LANDS. A third off arrows and nothing at all off a sword.
- [ ] ~~`ballista`~~ — **not a gap.** It is our `fire_ballista`: the same
      engine, the same `targetsUnits` bolt thrower, the same siege camp. Theirs
      does not burn and ours does, which is a material and a name rather than
      a machine. Same call as the apothecary in tranche 4.
- [ ] ~~`mangonel`~~ — **not a gap either,** and this one is written down in
      our own source: `build_catapult` in `tools/render/siege.py` says "a
      torsion mangonel: a single arm cocked back off a rope skein". A mangonel
      IS the catapult we have.
- [x] `fire_thrower`, `oil_pot`, and `oil_smelter` deferred from tranche 5
      (1.49.0). All three are the same feature -- fire as a thing you place or
      throw -- and all three go through the `fires` list in main.ts that the
      pitch ditch already burns from, via one new hook (`onIncendiary`) and one
      new function (`lightGround`, which refreshes a tile rather than stacking
      a second fire on it).

      The tranche 5 note said the smelter "fills pots that ENGINEERS carry and
      pour", and that carrying step is the one thing here that is compressed:
      the smelter makes `oil` as an ordinary good and an oil pot is placed with
      it, rather than a man walking a ladle from one to the other. A carrying
      state machine for a single building is more machinery than the mechanic
      earns, and the decision the player makes -- boil pitch, then pay oil for
      each pot on the wall -- is the same one either way.

      One fix fell out of it that was always slightly wrong: a fire no longer
      burns the men standing on the wall above it. Fire is on the ground. That
      is also what makes an oil pot on your own rampart usable at all.

`tools/render/siege.py` has the pattern from the catapult, ram, trebuchet and
fire ballista. One thing that had been wrong there since the ram: the sprite
frame was a GUESS, a cylinder sized so a catapult's arm at full stretch fitted
inside it, and the siege tower stands over twice that height. It would have
rendered with its head cut off in all eight facings and nothing would have
said so. Measured now, like the units and the mounts.

## What it cost, in the end

Twelve new units, seven new buildings, three new weapon goods and one new raw
good, across sixteen releases. Four things are worth carrying forward:

**The single texture is the budget.** The whole scene is drawn as one
back-to-front batch, because sprites split across two batches cannot be sorted
against each other, so everything packs into ONE texture and one hardware limit
(8192 on a good deal of hardware) caps the entire catalogue. It was already
8192x6588 before any of this. `trim_sprites.py` is what made room, and it must
be run after every render.

**Four hand-written lists each swallowed something silently**, and each is now
guarded through the same startup banner: `BUILD_MENU` (a building that cannot
be built), `SOLDIER_ORDER` (a unit that cannot be recruited), `RESOURCE_BAR` (a
good that is invisible), and the yards' `pile_<good>_<level>` sprites (a good
whose square draws nothing). Assume there is a fifth.

**Generalise the mechanic, then add the unit.** Nearly every unit here cost a
def entry and a model because the mechanic it needed already existed or was
made general first: `climbs`/`ladders` serves the assassin, the ladderman and
the siege tower; `alternate` on a workshop serves all three new European
troops; `fires` serves the pitch ditch, the oil pot and the fire thrower. The
two that needed genuinely new machinery -- `shields` and `fourLegged` -- are
about twenty lines each.

**Render it before you believe it.** A sword in a rider's hand is inside the
horse from half the facings. An animal in a stall is a brown shape in a brown
shadow. A stripe under a tent's eaves is hidden by the tent's own skirt. A
sling at its true size is a man holding nothing. A flame that is not emissive
is not a flame. None of those were predictable from the numbers.

## Notes

- Their PR #8 adds stones to the missile set; we already have `arrow` and
  `bolt` in `src/engine/projectiles.ts`, so that is an extension rather than a
  new system.
- Their PR #10 (mobile controls) duplicates `src/ui/touch.ts`, which already
  has the thumb bar, pinch-zoom and tap-to-order. Nothing to take.
- `tools/render/buildings.py` is large and hand-written; every new building is
  geometry authored by hand, which is what makes the tranche ordering above
  matter more than it would in a project with procedural art.
