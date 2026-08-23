# Fiefdom

An isometric castle-builder in the spirit of Stronghold Crusader, running in
the browser. Named for what the game is actually about: holding land, working
it, and defending what it produces.

## Licence and where the assets come from

**AGPL-3.0-only** — see [LICENSE](LICENSE).

Worth being precise about the art, since this repository is public:

* **Every sprite is generated**, not sourced. The buildings, ground, cliffs,
  vegetation, goods piles, siege engines and the gazelle are all built from
  procedural geometry by the scripts in `tools/render` and rendered through one
  shared Blender rig. Nothing is downloaded from an asset pack.
* **The human and animal motion comes from Mixamo clips** applied to a
  procedural body. The `.fbx` source files are **not** redistributed — they are
  gitignored — and only the rendered 2D output is committed, which is what
  Adobe's terms allow.
* **Screenshots of the original Stronghold Crusader** live in `reference/` as
  visual reference and are gitignored. They are Firefly Studios' copyright and
  are not ours to redistribute.

The name is Fiefdom, not Stronghold, for the same reason: Stronghold is Firefly
Studios' mark for a game in exactly this genre. Where the README and the code
comments name it, they are describing an influence.

## Running it on a server

Packaged as a container and an Unraid Community Applications template — see
[docs/INSTALL.md](docs/INSTALL.md).

```bash
docker run -d --name fiefdom -p 8080:80 ghcr.io/halvar20000/fiefdom:latest
```

The image is only nginx serving `dist/`: the simulation, the pathfinding, the
AI lord and the rendering all happen in the visitor's browser, so the server
sits near zero CPU. No database, no API keys, no accounts, and **no volume** —
there is nothing server-side to persist.

Two details that matter:

* **`index.html` is served uncacheable while the sprites are cached hard.** The
  atlas is ~1300 PNGs and wants aggressive caching, but if `index.html` is
  cached too, a browser goes on loading the previous build's fingerprinted
  script after the container is updated and the game silently stays on the old
  version.
* **Saves live in the visitor's browser**, not on the server. They do not
  follow you between devices, and clearing site data deletes them. That is the
  one thing about this container likely to surprise a self-hoster, so
  INSTALL.md says it plainly. Server-side saves would need a save API, which
  does not exist.

CI publishes amd64 **and** arm64 — plenty of home servers are ARM, and an
x86-only image fails at install time with a message nobody can act on.

## Start menu and map choice

The game opens on a title screen listing six maps. Nothing is generated until
you pick one, so the choice shapes the terrain rather than being applied to a
world that already exists.

A map is a set of BIASES on the one generator, not hand-drawn terrain:

```ts
{ seed, green, rock, marsh, trees, lords, difficulty }
```

A Crusader map is characterised by what it is short of — one is green and
wooded, another bare rock, another half bog — and biasing thresholds says that
in a few numbers where hand-drawn terrain would say it in a megabyte. `green`
shifts the moisture cut-offs, `rock` the outcrop threshold, `marsh` the bog
threshold, `trees` multiplies vegetation density.

Verified that the choice is real, not decoration:

| | The Tar Pits | The Quiet Valley |
|---|---|---|
| marsh | 22.8% | 8.2% |
| green | 28.7% | 32.7% |
| trees | 3,642 | 7,295 |
| opposition | lord active | 0 buildings, 0 soldiers after 400s |

**The pip ratings are derived from the generator numbers**, never typed in by
hand, so a card cannot promise a map something the generator will not produce.

`lords: 0` gives a pure builder's game. Rather than making every call site
handle a null lord, the map still constructs one and marks him defeated from
the start — cheaper and far less error-prone.

The menu appears instantly, before any sprite loads. That matters: the atlas is
1300-odd PNGs and on a cold cache the wait is real, so the player gets
something to read and a decision to make while it happens.

## Saving, loading and the pause menu

**Esc** pauses and opens the in-game menu: resume, save or load one of three
slots, delete a slot, or quit to the title screen. With a building in hand Esc
cancels the building instead — it means "back out of what I am doing", and
that is the building before it is the game.

### A save is a diff, not a dump

The terrain, the ground types and even the scatter of trees are deterministic
functions of the map seed — vegetation is hashed from tile position. Storing
them would mean writing down forty thousand tiles the game can recompute in a
second. A save therefore records only what changed: buildings, units, animals,
stores, the lord's economy, and which trees have been felled. **10.5 KB** for a
developed settlement.

Loading regenerates the world from the seed and lays the diff back on top.

### Workers are deliberately not saved

Their in-flight state is a tangle of paths, claims and half-finished production
cycles, and every bit of it is recoverable: `workers.sync()` puts a man back in
each staffed building and he starts his cycle again. The cost is one trip's
progress. The alternative is serialising the most mutable structure in the game
and getting it subtly wrong.

### Reload rather than rebuild in place

Loading a save and quitting to the menu both go out through `location.reload()`
with an intent in `sessionStorage`. Rebuilding takes about a second on a local
disk; unwinding three.js buffers, listeners, timers and the sprite atlas by hand
is a reliable source of leaks nobody notices until the fifth load.

### Two bugs the round-trip test caught

* **Peasants vanished on every load.** The saved `idle` count already excludes
  staffed workers, and the restore called `assignWorkers` on top — deducting
  them a second time. 25 idle in, 21 out. Staffing is now restored from the
  save rather than recomputed.
* **Workers doubled.** `sync()` drops workers whose building is gone but keeps
  any that are idle — correct during play, wrong on load, where they are
  orphans of a world that no longer exists. It then staffed the restored
  buildings on top of them: 4 workers in, 8 out. The pool is now cleared first.

A full in-memory round trip now matches on all fourteen tracked fields —
gold, stores, buildings, staffing, worker count, soldiers, felled trees, live
animals and the lord's economy.

### A measurement that proved nothing

I first "verified" that pausing stops the simulation by checking `elapsed` did
not advance while the menu was open. It did not — but neither did it advance
after resuming, because the Claude browser pane freezes `requestAnimationFrame`
when hidden. Both readings were measuring a stopped frame loop, not the pause
flag. The flag is now exposed and tested directly.

## The approach, in one paragraph

Terrain is real 3D geometry; everything standing on it — buildings, trees,
peasants — is a flat sprite that was pre-rendered in Blender. That is the same
technique the original used, and it is why the game looks "2D but somehow 3D".
The look does not come from the models. It comes from **one shared Blender
lighting rig** that every asset is rendered through, so all the sprites sit
together as if photographed in the same place at the same hour.

## Layout

```
tools/render/      the Blender pipeline (this is the important part)
  rig.py           THE shared camera + sun + render settings. Everything uses it.
  materials.py     procedural stone/timber/thatch/ground. No image textures.
  geom.py          mesh primitives built at true size
  buildings.py     parametric buildings
  props.py         palms, scrub, deadwood
  render_*.py      drivers: buildings, ground tiles, animated units
src/engine/        iso projection, camera, terrain mesh, sprite batching, loaders
src/game/          map generation
public/assets/     rendered output (PNG + JSON manifests)
reference/         Stronghold Crusader screenshots used to calibrate the look
```

## Conventions that must not drift

* **Projection is 2:1 dimetric: azimuth 45°+90°k, elevation 30°.** Not
  `atan(0.5)` — that is the angle of the diamond edge on screen, a different
  thing. `src/engine/iso.ts` and `tools/render/rig.py` both hard-code this and
  must be changed together.
* **1 Blender unit == 1 map tile.**
* **The sun is fixed in world space**, so rotating the camera genuinely shows
  lit and shadowed faces of a building. Its direction is duplicated in
  `iso.ts::SUN_DIRECTION` so terrain slope shading matches the baked sprites.
* **Buildings need 4 renders (one per camera rotation). Units need 8** — eight
  world-space facings, and camera rotation just re-indexes which one is shown.
  Rendering units 8×4 would produce 24 exact duplicates.

## Rebuilding assets

```bash
blender -b -P tools/render/render_buildings.py -- --out "$PWD/public/assets/sprites"
blender -b -P tools/render/render_ground.py    -- --out "$PWD/public/assets/tiles"
blender -b -P tools/render/render_units.py     -- --out "$PWD/public/assets/sprites"
```

Units render from the Mixamo rig in `assets/source/mixamo/`. `--body peasant`
(default) generates a hooded-tunic body onto that skeleton; `--body ybot` uses
Mixamo's own mesh instead. Six clips -- idle, walk, carry, dig, mine, chop --
are mapped to worker state and building type, so a hauler walks differently from
an empty-handed labourer and a miner swings rather than stands.

Root motion is stripped at render time by re-centring the hips each frame, so it
does not matter whether a clip was exported with Mixamo's "In Place" ticked.

## Movement

Units path with 8-connected A* on the tile grid (`src/game/pathfind.ts`), with
string-pulled smoothing so they do not staircase along diagonals.

### Cliff faces

Tiles whose corners differ by two or more height steps render with a dedicated
`cliff` texture instead of the flat top-down `rock` one. This is **render-only**
— `groundType` still reports rock, so quarry and iron-mine placement is
unchanged (a 2-step face fails the level-ground test anyway).

Two things that had to be right for it to look like rock:

* **Brightness.** The terrain shader applies a lambert term, and a 2-step face
  turned away from the sun lands at shade 0.50. A texture that looks correctly
  cliff-dark flat in Blender renders as near-black mud in game, so the cliff
  albedo is kept as bright as the plateau stone. The face reads as rock through
  its structure, not its dimness.
* **Block tone from voronoi `Color`, not `Distance`.** `Distance` domes towards
  each cell centre, shading every block identically — measured *lower* contrast
  than the plateau it was meant to beat. `Color` is random per cell and gives
  distinct blocks. Cliff now measures sd 22.5 against rock's 15.7.

The material is deliberately direction-free: tiles pick one of four UV
orientations at random, so bedding planes would point four ways along one cliff.

Only **buildings** block. Trees and rocks are deliberately passable: making
scatter block as well turns a palm grove into a maze and sends woodcutters on
absurd detours around the very trunk they are walking to. That is why there are
two grids -- `occupied` (buildings + scatter) decides where you may BUILD,
`paths.blocked` (buildings only) decides where units may WALK.

Three things make it actually work, and each was a separate bug:

* **Destinations are building *doors*, not centres.** `approach()` returns a
  tile just outside the footprint. Routing to the centre sent every worker
  through a wall on the last leg of every journey.
* **Targets must be reachable.** The grid keeps connected-component labels, so
  a spot sealed inside a courtyard is rejected instantly rather than discovered
  as a failed search. Work spots and doors are chosen in the worker's own
  region.
* **No straight-line fallback.** When a route genuinely does not exist the
  worker waits and the player is told. Falling back to straight-line movement
  is precisely what made units walk through buildings.

Placement refuses anything that would wall a building or a worker off
("That would block the way"), checked on commit rather than on hover -- it needs
a full connectivity rebuild, far too costly to run under the cursor every frame.
`rescueStuckWorkers()` nudges anyone already trapped back onto open ground.

There are **two** lists of figures on screen: `workers.workers` (employed) and
`wanderers` (idle townsfolk). Both need pathing, both need rescuing, and any
measurement must sample both. Before any production building exists every
figure on screen is a wanderer, so testing only workers measures a population
the player cannot yet see.

Measured across both lists: time spent standing inside a building fell from
**55% to under 0.3%**, with the opening townsfolk at 0 of 9,600 samples. The
remainder is momentary corner-clipping during turns.

## Sprite anchoring — the axis flip

`rig.py` puts the Blender camera at `-cos(az)` on Y, while `iso.ts` puts the
engine camera at `+cos(az)` on Z. The mapping between the two is therefore

    engine_x =  blender_x
    engine_y =  blender_z
    engine_z = -blender_y        <-- note the sign

Building models are authored extending into Blender **+X / +Y** from their
origin, so their +Y extent lands on engine **-z**: the sprite is drawn on the
tiles *behind* its own footprint. For a 3x3 keep that is (+96, -48) screen
pixels at zoom 2 -- three whole tiles.

`spriteAnchor(x, z, d)` returns `[x, z + d]` to slide it back on. Units need no
shift because their model is centred on its origin, which is exactly why units
looked fine while buildings did not.

**This masqueraded as a movement bug for a long time.** Units path correctly
around the real footprint, but the building is painted three tiles away from
it, so they visibly walk through the drawn building. No amount of measuring
logical positions against the footprint can detect this -- that only ever
compares logic to logic. Trees showed the same fault at half-tile scale (their
trunk sits at model centre), which is why woodcutters appeared to chop beside
a tree rather than at it.

If sprites ever look displaced again, turn on the **G** overlay: it paints every
movement-blocked tile. A building must sit exactly on its own patch.

### Two further faults in the same area

**The rig framed sprites in the wrong space.** `frame_object` read
`cam.matrix_world` before Blender had evaluated it, so the matrix was still
identity and the crop was computed from Blender world X/Y instead of camera
space. The tell was that all four rotations produced an identically sized
sprite -- impossible for anything not rotationally symmetric. `rig.py` now calls
`view_layer.update()` before reading the matrix. Verified with
`tools/render/_markers.py`, which renders emissive cubes at known Blender points
and checks their pixel offsets against the analytic prediction.

**The depth bias must be measured from the ANCHOR, not the footprint centre.**
The anchor is `(x, z + d)`, so the footprint corners relative to it are
`(0,0) (w,0) (0,-d) (w,-d)` and the bias is the nearest of those along the view
direction: `max(0, w*cx) + max(0, -d*cz)`. Getting this wrong does not move the
sprite, it *clips* it: every sprite is drawn at one uniform depth, and on flat
ground a constant-depth plane meets the terrain along a line of constant
screen-y, so an under-biased building is sliced off by its own ground in a hard
horizontal line.

## Sprite draw order

Every sprite is drawn in ONE back-to-front stream with alpha blending and no
depth writes, so painter's order is the only thing holding the scene together.
`depthKey()` must therefore exactly match the ordering of
`dot(point, cameraDirection)`:

| rotation | azimuth | key      |
|----------|---------|----------|
| 0        | 45      | `x + z`  |
| 1        | 135     | `x - z`  |
| 2        | 225     | `-x - z` |
| 3        | 315     | `z - x`  |

Rotations 1 and 3 were the negation of this for a long time. While sprites still
wrote depth the z-buffer covered for it; the moment depth writes were removed
(needed so building shadows stop occluding people) those two rotations began
painting front-to-back, and figures behind a building appeared standing on its
roof.

**A logical-position metric cannot catch this.** Counting how often a unit
stands inside a building footprint says nothing about the order its sprite is
painted in. The test that does work compares the emitted draw order against
true camera closeness -- see the pairwise check in the commit history, which
reports 0 inversions across 4,550 sprites at all four rotations.

## The campfire

A campfire is placed automatically at map generation, directly out from the
keep's door. The door is modelled on the Blender -Y face and `engine_z` is
`-blender_y`, so it faces +z: the fire goes at about `(kx + 1, kz + 4)`, one
clear tile out from the wall. It is not buildable and blocks both building and
movement, so nobody stands in the flames.

Every unemployed peasant takes a place around it and stays there, facing the
fire. Three details matter:

* Standing places are **found by searching outward for open ground**, not laid
  out geometrically. A fixed ring cannot cope: at radius 2.45 the circle reaches
  into the keep's own footprint, so those places had to be shunted and the crowd
  bunched -- with 20 idle two peasants ended up 0.32 tiles apart. Searching also
  makes the gathering grow outward on its own and flow around anything built
  nearby. `rebuildFirePosts()` re-runs whenever the scenery changes.
* They do **not** wander off. With only a handful idle, one strolling away is a
  quarter of the crowd gone, and the fire exists to show at a glance how many
  people have no work.
* The drawn crowd caps at `IDLE_WANDERERS` (48). Past that the Unemployed
  figure keeps counting but the gathering stops growing.

Measured with the search-based layout: 8 / 20 / 40 idle all reach their place,
closest pair 0.91 / 0.82 / 0.77 tiles, ring radius growing 2.2 -> 3.4 -> 4.0,
none standing inside a building.

Note `updateWanderers()` is a named function called from BOTH the render loop
and `stepSim()`. An update that lives only inside the frame loop is invisible to
every headless test -- that mistake has now been made twice here (tree regrowth,
then this).

## HUD layout

The right-hand side is **one panel with a dropdown**, showing a single view at
a time: Food & Ale, Popularity, Production, or Market. Everything used to be on
screen at once, and each new stat block squeezed the others -- the market ended
up one row tall. `M` jumps to the market (and hides the panel if already there),
`T` hides or shows it.

Views are built once and shown or hidden, never re-created. The market's buttons
carry real click handlers, so re-rendering it as innerHTML each frame would
throw them away; only the visible view's text is refreshed.

Panels are otherwise laid out by flow, not by hand-tuned offsets:

* Everything on the right (stats, market, rations/taxes) lives in `#rightcol`,
  a flex column. Any panel growing pushes the next one down instead of landing
  on top of it. The market had a hard-coded `top: 250px` and the moment the ale
  block made the stats panel taller than that, the two overlapped.
* The resource bar is anchored **between** the side panels (`left: 214px;
  right: 282px`) and wraps. Centring it with a `calc(100vw - N)` max-width is
  fragile: N has to be re-derived whenever a side panel changes width, and it
  fails silently.

Checked by measuring every pair of panel rectangles for intersection with the
market both open and closed -- eyeballing missed two of the three clashes.

## Why popularity is what it is

The stats panel (`T`) itemises every contribution: starting goodwill, rations,
taxes, food variety, ale coverage, hunger and overcrowding, then the target it
is heading for. Positives green, negatives red, zeroes dimmed.

`popularityBreakdown()` **is** the calculation -- `tickEconomy` sums that list
rather than repeating the arithmetic, so the number the player reads can never
drift from the one the simulation applies. Verified by asserting the sum of the
displayed factors equals `popularityTarget` exactly.

Hunger is eased (0..1) rather than switched. A binary "no food" penalty flipped
on and off every time the last loaf was baked and instantly eaten -- 19 flips in
300 seconds, which made popularity thrash and the panel unreadable. Easing turns
a momentarily empty granary into a small dip and sustained famine into the full
-40. Flicker measured afterwards: 1.

## The food chains

Four foods reach the granary, and **variety is what pays**: the popularity bonus
is `FOOD_VARIETY_BONUS` indexed by how many different kinds are in store, so a
fourth chain is worth +4 popularity on top of the calories.

    Wheat Farm  -> Mill -> Bakery        -> bread
    Pig Farm    -> Slaughterhouse        -> meat
    Dairy Farm                           -> cheese
    Apple Orchard                        -> apples

`FOOD_VARIETY_BONUS` must have an entry for every possible count. Adding meat
made four possible, so the table grew to `[0, 0, 4, 8, 12]` and the lookup now
clamps to `table.length - 1` rather than a hard-coded 3 -- otherwise the next
food added would silently read `undefined` and poison the popularity sum.

## Ale: the second happiness lever

`Hops Farm` (green land) -> `Brewery` (hops -> ale) -> `Inn`. The inn employs a
**drayman** who walks to the stockpile, loads four barrels and carries them
home; the inn serves from what he has actually delivered, not from the
stockpile at large. Coverage therefore depends on the ale having physically
arrived, which is the difference between a supply chain and a spreadsheet.

Stocking is a separate worker behaviour from producing (`BuildingDef.stocks`,
handled by `WorkerPool.updateStocker`). A producer turns inputs into an output;
a stocker only keeps a good on the premises. Splitting them kept the producer
path free of null recipes rather than threading an optional through every case.

* One inn serves `INN_CAPACITY` (20) people, drinking
  `ALE_PER_PERSON_PER_MIN` (0.12) each -- 2.4 ale a minute per inn.
* Coverage is `served / population`, and popularity gains
  `ALE_POPULARITY_MAX` (10) times that. Half the town drinking is +5.
* Coverage is eased rather than snapped, so running dry shows as happiness
  sliding away over a few seconds instead of falling off a cliff.
* Coverage is `min(population, innCapacity) / population`, so a growing town
  visibly outgrows its inns -- 100% at 17 people fell to 63% at 32, and the fix
  is a second inn.

The point is that ale is **optional**, which makes it a real decision: food
keeps people alive, ale is labour you choose to spend on making them happy.

Balance note: the drink rate started at 0.05 and one brewery then supplied 80
drinkers -- +10 popularity for a fraction of what feeding those people costs.
0.12 makes a fully-served town of 40 need roughly one hops farm and one brewery.

Verified end to end: hops 4/min -> ale 4/min; +5 popularity at 50% coverage;
and when the stock hits zero, coverage collapses and popularity drops by 8 at
83% coverage, exactly `10 x 0.83`.

## Both stores are painted areas, not sheds

The stockpile and the granary are each a set of separate 1x1 buildings carrying
`storeFor`, not one 3x3 shed. The player paints more squares from the **Stores**
menu; each must orthogonally touch an existing square **of the same store**, so
a granary bay cannot annex the yard and each store stays one place you can read
at a glance.

One `StoreLayout` in `stores.ts` drives both. They differ only in which goods
they accept, how much a square holds and which sprites they draw — and a second
copy of that logic would be the obvious place for the two to quietly drift apart.

|          | squares at start | per square | goods | sprite prefix |
|----------|-----------------|------------|-------|---------------|
| Stockpile | 4x4 = 16 (800) | 50 | the nine raw goods | `pile_` on `stockpile_deck` |
| Granary   | 3x3 = 9 (360)  | 40 | the four foods     | `bin_` on `granary_bin` |

A granary bay holds less because food is spent continuously rather than hoarded:
the bay count is a buffer measured in minutes of eating, and a big number would
make the granary a thing you build once and forget.

Things this pulled on that were not obvious:

* **Walkable.** `BuildingDef.walkable` marks both, and `markSolid` is skipped.
  Left solid, a player painting a big store builds an accidental wall through
  their own settlement, and the carriers whose whole job is to walk onto it
  would path around the edge. It also lets the seal-off test be skipped, so
  painting a store never trips "that would block the way".
* **Producers stop rather than spill.** A workshop will not begin a cycle whose
  output has nowhere to go. Without that check it keeps working and walks each
  load to a full store, burning labour and inputs every cycle — and the player
  sees the DOWNSTREAM workshop "waiting for materials" (the bakery, when it is
  really the mill that cannot store flour) with no way to trace it back.
  `deposit` still clamps as a backstop, and a part load spills: the carrier is
  already standing on the square with the goods in its arms.
* **Assignment is persistent, not recomputed.** Squares are reserved per good
  and released before new claims each pass. A fresh allocation in resource
  order looks identical most of the time and then reshuffles the whole store the
  moment an early good shrinks by one square, so a settlement that is merely
  spending wood appears to be frantically rearranging itself.
* **`syncStores` must not use `||`.** It short-circuits, and the granary would
  stop being laid out on any tick the stockpile happened to change first.

`sync()` returns whether what is *drawn* changed, so the static sprite list is
rebuilt a few times a minute rather than every frame. It compares packed
`(x, z, good, level)` ints against an `Int32Array`: exact and allocation-free.
A numeric hash would be cheaper still, but a collision silently skips a redraw
and a store showing the wrong good is precisely the bug this exists to prevent.

### Why the yard starts at 4x4

Measured on a natural build order with a 3x3 yard: 300 of 450 units are spoken
for before the player has done anything, the amber warning is on almost at once,
and by minute 15 wheat has hogged three squares, the flour has nowhere to go and
the bakery has starved. Sixteen squares opens at 37% and still needs expanding
once four or five chains are running — which is the pressure the feature is for,
just not in the first quarter of an hour.

### The sprites

Nine goods and four foods, three fill levels each, four rotations: 160 sprites
from `tools/render/piles.py`. Square and load are baked into one sprite per
level, so there is nothing to depth-sort against itself and peasants still walk
over the top of both.

Two calibrations that mattered more than expected:

* The building palette is one warm sandstone family, right for architecture and
  wrong here — rendered with it, logs, cut stone, wheat and flour all came out
  the same tan. The pile materials pull hard apart in hue on purpose.
* The granary kerb is 0.085 high, not 0.13. At 0.13 it hid a level-1 load
  completely and a bay with three loaves in it looked empty, which defeats the
  entire point of being able to see the store.

## Standing trade orders

The market (`M`) carries a standing order per good with **two independent
levels**, as in Stronghold: buy whenever the stock falls below one, sell
whenever it rises above the other. Wood set to *buy below 30, sell above 100*
holds itself anywhere in that band and only acts at the edges. Either half can
be switched on alone.

`GameState.tickTrade` settles orders every `TRADE_INTERVAL` (2s) in batches of
`TRADE_BATCH` (4), so a surplus visibly drains rather than vanishing in one
frame, and a large purchase is something you watch your gold pay for.

Rules worth keeping:

* Trading of any kind requires a **market building** -- standing orders and the
  one-off buttons alike.
* **The levels may never cross.** `setTradeLevel` keeps them `TRADE_MIN_BAND`
  apart. If buy ever rose above sell, the good would be bought and sold on
  alternate ticks and the market's spread would quietly drain the treasury.
* Only one side acts per tick per good, so a single tick can never both buy and
  sell the same thing.
* A buy order never overdraws: it buys `min(batch, shortfall, affordable)` and
  says so when it cannot afford even one.
* Orders settle to the level exactly and then stop dead -- verified at zero gold
  drift over 180 simulated seconds.
* Trades go through the ledger, so the stats panel (`T`) counts bought goods as
  production and sold goods as consumption.

It lives inside `tickEconomy`, which means the headless `stepSim` path exercises
it identically to the game.

## Workers only fetch what exists

A building with input goods (mill, bakery) checks the stockpile **before**
setting off. Without that check the worker walks to the stockpile, finds it
empty, walks home and immediately repeats -- an endless there-and-back that
reads as a broken unit to anyone watching, and wastes the trip.

Worth noting how this hid: by every state-machine measure those workers were
healthy. Their cycle was `idle > toFetch > returning > idle > ...`, all legal
transitions, no stuck states, no failed paths. It only looks wrong when you
watch it. Some faults are only visible to a human.

## M2, part one: the curtain wall

Wall is a paintable 1x1 building costing 3 stone; gatehouse and tower are 2x2.
`BuildingDef.paintable` keeps the tool in hand after each placement — laying a
twenty-tile wall while re-selecting between every tile is not a decision, it is
an obstacle. Stores use the same flag.

A wall segment is crenellated on **all four sides**. A 1x1 segment has no idea
which way the run goes — it is placed tile by tile and the player may turn a
corner anywhere — so merlons running one way only would be wrong on half the
wall. Where segments abut, the joint merlons interpenetrate, which at 45 px per
tile reads as one continuous battlement. Checked on a 50-segment ring.

The gatehouse is pierced on all four faces. Buildings here do not rotate, only
the camera does, so a gate with one fixed passage would be unusable on three
sides of a castle.

### What the seal-off guard actually protects

Worth being precise, because the obvious story is wrong. `wouldSealSomethingOff`
refuses a wall that cuts a **building** off from the keep — verified: ring a
hovel, leave one gap, and closing that gap is refused with "would block the
way", leaving the tile passable.

It does **not** stop you enclosing your entire settlement with no gate at all,
because everything inside stays connected to everything else. That is a legal
castle, and the guard has no opinion on it. What breaks is the jobs that reach
outside the wall — woodcutters, the hunter, farms on land you walled out. Those
fail loudly rather than silently: `goTo` finds no route and notifies
"<building> cannot reach its work". The gatehouse is how you avoid that, not how
you satisfy the guard.

## M2, part two: soldiers

**No weapons chain.** Stronghold routes iron through a blacksmith and an armoury
before you get a swordsman; here you buy the man at the barracks. The trade-off
is kept elsewhere and is still real: every recruit costs gold, costs a peasant
out of the idle pool, and then goes on eating and occupying housing while
producing nothing. `population` and `idle` are independent counters, so
`idle -= 1` is the whole accounting — the soldier is still a mouth to feed.

Armoured troops cost **iron directly** (swordsman: 80g + 4 iron; archer 40g +
2 wood; spearman 20g). Without that, nothing in the game consumes iron or pitch
at all — they are mined and then only ever sold — and the iron mine exists
purely for trade.

`Army` is deliberately separate from `WorkerPool`. Workers are driven BY their
building through a production state machine and have no will of their own;
soldiers are driven by the player and have no building. Folded together, every
worker would carry an unused selection flag and every soldier an unused
production cycle.

Controls: click a soldier to select, **shift**-drag to box select, right-click
to move. Left-drag already pans and taking that away would break the control
everyone has been using, so the box lives on shift. Right-click is a move order
when troops are selected and only falls back to cancelling a placement when they
are not. Move orders spread over a block around the click — a dozen soldiers
routed to one tile arrive, find it occupied by each other, and mill about.

Selected soldiers are brightened in place via the sprite tint rather than given
a marker sprite.

**Pointer handlers must ignore non-left buttons.** `pointerdown` and `pointerup`
fire for the RIGHT button too. Letting them through broke move orders entirely
and in a way that looked like the feature was simply missing: right-click's
`pointerup` ran the selection code, found no soldier under the cursor, cleared
the selection, and by the time `contextmenu` arrived there was nothing left to
order anywhere. Both handlers now return early unless `e.button === 0`, which
also makes the fix independent of platform — macOS fires `contextmenu` on mouse
DOWN and Windows after mouse up, and either order used to lose the selection.

Test the real event path, not just the function underneath it. `orderMove` was
verified directly and worked perfectly; the bug was entirely in the wiring
between the mouse and it.

### Box select must be tested in SCREEN space

The first version took the two corners of the dragged box, converted each to a
world point, and selected everything inside the world-space axis-aligned box
between them. That is a different region. A rectangle drawn on screen is a
rotated diamond in world space, so the world box built from its diagonal corners
covers a sliver that in practice contained nobody — the marquee drew correctly
over five archers and selected zero.

`IsoCamera.worldToScreen` projects each soldier and the test happens in the space
the player drew in. `Army.selectWhere` takes a predicate rather than a rectangle
so the geometry stays with the camera, where it belongs. Verified 8 of 8 at all
four camera rotations, which the world-space version could never have been.

### Discoverability

Box select existed and worked from the day it was written, and the player still
asked how to select more than one unit — because the only mention of it lived in
the Barracks panel, which there is no reason to have open while commanding
troops. The troop controls are now in the always-visible controls panel, and
**double-clicking a soldier takes every one of his kind**, which is the idiom
people reach for first.

### Kit is bound to bones, not parented

`peasant.build` takes a `kit`, and each piece — helmet, spear, sword, bow,
shield — is bound to a BONE's vertex group. A spear bound to RightHand then
swings with the arm through every frame of every clip without a line of
animation code. Kit is authored in the rest pose; the arms are out to the sides
there, so a shaft drawn vertically THROUGH the hand stays vertical relative to
the hand.

### The bug that would have shipped

The renderer scaled the mesh so its z extent equalled the unit height — and the
spear is part of the mesh. Measured: a spearman's body plus spear is 0.624 where
the body alone is 0.520, so scaling to include the spear shrinks the man to
**0.433, seventeen per cent shorter than the peasant he was recruited from** —
with no cause a player could ever work out. `peasant.build` now records
`body_z_extent` before fitting the kit and the renderer scales by that.

That fix then broke the frame: at a full 0.52 the spear tip reaches 0.624, past
the fixed frame top of 0.614, and would have been sheared off. The frame now
takes `max()` of the peasant's numbers and the body's own, which is deliberate —
an unarmed body keeps exactly the 80x66 frame it always had, so every peasant
sprite already on disk stays valid. Spearmen render at 90x74.

## M2, part three: combat

Both sides live in one `Army.soldiers` list with a `side` field, because combat
is symmetric — target acquisition, cooldowns and damage are identical whoever is
swinging, and two lists would mean writing all of it twice and letting the
copies drift. The player-facing methods filter to `side === 'player'` so an
enemy can never end up selected and taking orders.

Enemies are the same three bodies under a red tint rather than three more
palettes: 288 sprites to say "not yours" is a poor trade, and side reads faster
from colour than from costume.

### Resolution is simultaneous, and it has to be

A single pass over the unit list is **not fair**. Whoever is processed later
sees positions the earlier units have already updated this tick, enters attack
range a tick sooner, and swings while its opponent is still walking. Everything
else being symmetric, that one tick decides the entire fight.

Measured before the fix: the second-created side won **16 duels out of 16 and
12 even 3v3s out of 12** — while dealing exactly the same 25 blows per 30
seconds. The rate was identical; the ordering was everything. The initial random
cooldown made no difference at all, because both sides' cooldowns run well
negative during the walk to contact and are washed out by the time blades meet.

Now every unit decides and swings against the same start-of-tick snapshot, all
blows land together, and only then does anyone move. Two units that kill each
other on the same tick both die, which is the honest outcome.

After the fix, measured: even 1v1 and 3v3 both sides annihilate (no bias),
1-vs-3 loses 6/6, 3-vs-1 wins 6/6, and a swordsman beats a spearman 6/6 **from
either side of the fight** — the check that the bias is actually gone.

Damage carries a +/-15% spread. Without it, simultaneous resolution means two
identical units ALWAYS die on the same tick: correct, but every even fight plays
out identically and reads as the simulation being stuck rather than fair.

### Archers actually work

Verified across opening distances, 8 duels each: at 3 tiles a spearman kills the
archer 8/8, at 6 and 10 tiles the archer wins 8/8, and at 16 neither notices the
other (correct — outside aggro, which is `range + 4.5`). Range is a real
advantage that has to be set up, not a stat that wins on its own.

### The animation clock must run for everyone

`phase` drives which frame of a clip is drawn, and it used to be advanced inside
the movement pass -- which skips anyone standing still or in contact. So idle
soldiers were frozen on a single frame, and the attack animation, the entire
point of having one, never played at all: a unit in contact is by definition not
moving. Wiring up a proper archery clip is what surfaced it, because there was
suddenly something worth looking at.

It now ticks for every living unit. Verified: an archer in a fight cycles
through 9 of its 10 attack frames, and a soldier standing idle advances 3.0
seconds of phase over 3 seconds.

A related gotcha when checking a newly imported clip: `retarget_action` reported
`0 channels` for Standing Draw Arrow where every other clip reports 520. That
turned out to be benign -- Mixamo's bone prefix varies per download, and this one
already matched -- but "0 channels" is also exactly what an empty action looks
like. The check that settles it is comparing rendered frames to each other: 80
to 186 changed pixels between frames, against 166 to 216 for a clip known good.

### Raids

The first comes at 8 minutes, then every 5, growing and hardening — spearmen
only for the first two waves, then archers and swordsmen. They spawn on a random
edge and march on the keep. `__game.setNextRaid(Infinity)` turns them off.

There is no building damage yet, so an unopposed raider **loots** instead: gold
off the treasury and popularity off the town while he stands in your keep.
Without a consequence, losing a battle costs nothing and combat is decoration.

### A test contaminated by its own feature

The first combat measurements said the player lost 20 duels out of 20. Raids had
just been added, `stepSim` runs them, and 20 x 30 seconds of simulated time is
long enough for several waves to spawn and swarm the lone test subject. The
combat bug turned out to be real and underneath it — but the number that
revealed it was wrong for a completely different reason first.

## A map editor, and where a painted map has to live

The six shipped maps are generator **biases** -- a seed and four numbers -- and
a saved game is a diff against the world that seed regenerates. A hand-painted
map has no seed that would reproduce it, so it is the one thing in the game
that has to carry its own tiles.

That turns out to be cheap, because the data is enormously repetitive: 40,000
ground types over six values and 40,401 corner heights over six levels.
Run-length encoded at three bytes a run, **a worked 200x200 map came out at 550
bytes** — against the ~5MB localStorage allows. Stored raw it would have been
80KB before base64; still affordable, but pointless for data this flat.

Painted maps are embedded in the save that uses one, not referenced by id, so
deleting a map cannot orphan a game you are in the middle of.

### What the editor is, and is not

You start on bare flat desert, exactly as asked, and paint: six ground types,
raise/lower for hills and cliffs, five brush sizes. Everything writes straight
into the same `Terrain` the game uses, so the editor is not a preview of the
map -- it is the map.

Two things fall out of that for free. Raised ground picks up the broken-rock
cliff texture on its own, because the `slope >= 2` test that chooses it is the
same line of code in both places. And **vegetation is not painted at all**: the
scatter is a hash over ground type, so painting a meadow grows palms on it
without the editor placing a single tree.

The brush interpolates between sampled pointer positions. Without that a quick
drag delivers a handful of positions metres apart and paints a dotted trail of
separate blobs rather than a stroke — which is exactly what the first version
did.

The view moves on **arrows or WASD**, the same keys the game uses, with
right-drag as a second way. The first cut shipped with neither: only right-drag
panned, and the drag had its Y inverted against the game's convention. On a
200-tile map showing perhaps thirty tiles at a time, that meant you could only
ever paint the middle — reported as "the view is static", which is exactly what
it was.

Saving runs an audit and warns about farmland, flat rock and level ground,
because a map with nowhere to farm opens on a settlement that can never produce
anything, and that reads as the game being broken rather than the map being
harsh. It warns rather than blocks; a cruel map is a legitimate thing to make.

### Placing the keeps, and why they used to huddle

Pick **You**, **Red**, **Blue** or **Violet** and click the map. A coloured post
and pad mark the spot, the rival count follows how many you have seated, and
saving warns if two keeps are closer than 45 tiles.

The automatic siting that came before this was worse than it looked. Rivals
were placed at `player ± 72` tiles and then **clamped to the map bounds** -- so
a start near a corner collapsed the intended separation and both keeps landed
in the same quadrant, which is how a painted map ended up with the enemy
castle in plain sight of the player's own. Candidate directions are now tried
farthest-first. Deliberately a sort and not a minimum-distance filter: a filter
can empty the list on a cramped map and lose the lord altogether, which is
worse than a near neighbour.

Hand-placed positions are taken as an instruction, with only ±8 tiles of search
to find buildable ground under the keep. Placed at the four corners of a
200x200 map, the game seated them at (35,35), (166,36), (36,166) and (166,166)
-- asked for 35 and 165, nudged at most one tile.

Both fields are optional, so maps painted before the tool existed still load
and fall back to the automatic siting rather than being rejected. A version
bump would have thrown away every map already saved.

## The asset cache, and a bug that lied

Reported: painting water produced **sand**, and the fisherman's hut **drew
nothing at all**. Both on the server build; both fine in development.

One cause. The game's own assets live under `/assets/tiles` and
`/assets/sprites`, which share a URL prefix with Vite's bundles — and nginx was
serving that whole prefix as `immutable, 1 year`. Vite's bundles are
fingerprinted so that is right for them. The game's are **not**: `tiles.json`,
`buildings.json` and the PNGs beside them keep fixed names and change whenever
the Blender pipeline runs.

So a browser that had visited before kept last build's manifests forever, and
both failure paths are silent by design:

- `layerOf()` returns **0** for a ground type it has never heard of, and layer
  0 is **sand**. Painted water therefore rendered as desert.
- `rebuildStatic`'s `push()` skips any sprite with no frame in the manifest, so
  a building the manifest predates simply does not draw.

Neither logs anything. Both look like a broken feature rather than a stale file,
which is exactly how they were reported.

### The half of the fix that never shipped

The cache fix went out and the bug stayed. The server was provably right —
`tiles.json` listed `water`, and the headers said `must-revalidate` — and water
still drew as sand.

The Dockerfile copies files by name, and `vite.config.ts` was not on the list.
It was added for the build id and never added there. Vite then ran with
defaults, `__BUILD_ID__` was never defined, and every asset URL shipped
**unversioned**. The build did not fail; nothing warned.

That is what made it survive the fix. A browser holding `tiles.json` under
`immutable, max-age=31536000` **does not re-ask for a year**, so the server's
new `must-revalidate` header never reaches it. Only a changed URL gets through —
and the changed URL was the half that did not ship.

Reproduced rather than assumed: building with `vite.config.ts` puts `?v=<sha>`
in the bundle and eliminates the warning branch as dead code; building without
it yields no versioned URL and leaves the warning in. Asset URLs now log an
error if the define is missing, so this cannot ship quietly again.

A third fix matters more than either: the game now **says so**. On load it
compares `GROUND_TYPES` against the tile manifest and the building list against
the atlas, and if the manifests are behind the code it puts a banner on screen
naming what is missing and telling the player to hard-refresh. A deployment
problem should never present as a broken feature.

Two more fixes, belt and braces. The client now appends `?v=<build id>` to every
asset URL, so a new build asks for URLs no cache has seen. And nginx serves
`/assets/(tiles|sprites)/` with `must-revalidate` instead of `immutable` — one
conditional request against a failure mode that renders the wrong world in
silence.

The regex location is placed **before** the PNG rule, because nginx takes the
first matching regex, not the most specific one.

## Stopping at the map edge

The clamp kept the camera's *centre* on the map, which is not the same thing as
keeping the map on screen: at the border you got half a screen of void.

The fix measures the **four screen corners projected onto the ground** and
pushes the target back by whatever hangs over the edge. An analytic version
came first — reach along each world axis from the zoom, rotation and
foreshortening — and it was arithmetically correct and still left two tiles of
void at the top corner, because the target is not the centre of what you can
see: it projects 32px below it. Rather than hunt that offset down and hard-code
it, the clamp now reads the corners it is actually trying to keep on screen, so
it cannot disagree with what is drawn.

One correction pass is exact, since moving the target translates the whole view
by the same amount; the second pass only confirms. When the map is narrower
than the view there is no legal position at all, so it centres instead of
pinning to a corner.

Verified at all four corners, all four rotations and all three zoom levels:
every view box lands exactly on 0 and 200 with no overshoot anywhere.

## The camera that would not stop

Reported: pick something from the panel dropdown at the top right, press an
arrow key, and the view scrolls away forever with no way to steer it back.

Held keys drive the camera every frame, so a key that never gets its `keyup`
pans the map into a corner and stays there. A native `<select>` popup **eats
the keyup while it is open** — the keydown reaches the window and is recorded,
the release never does, and the game goes on believing the key is down for the
rest of the session.

Three fixes, because there are three ways in. Keys are ignored entirely while a
`select`, `input` or `textarea` has focus, since that control owns the keyboard
and the game has no business recording them. The dropdown blurs itself on
change, so the arrows drive the camera again the moment you have chosen.
And every held key is dropped on window blur, which covers alt-tabbing away
mid-key — the same guard the map editor already had and the game did not.

Buttons are deliberately excluded from that list. Arrow keys mean nothing to a
button, and a HUD button keeps focus after it is clicked, so treating them the
same way would stop the camera dead the moment anyone pressed Rations.

## The Fire Ballista

The ram and the catapult both break stone, so a third wall-breaker would have
been a price tier rather than a decision. This one shoots **men**, nine tiles
out — further than any archer, and much harder — and cannot touch a wall at
all. It answers a column of soldiers or somebody else's catapult.

That needed splitting one flag into two. `siege` meant both "is a wheeled
engine" (slow, cannot man a wall, never advances on its own) and "attacks
buildings", which were only ever the same thing by accident. `targetsUnits`
now says what an engine shoots at, and a ballista is every bit as much an
engine as a catapult while wanting none of the same targets.

It keeps the standing-still rule: it never goes hunting, it holds where you put
it and covers the ground in front. That is the whole point of owning one.

**The flame had to be a light source, not a lit surface.** Modelled first with
an orange cloth material, it came back at 1% fiery pixels against the ram's 1%
baseline — the fire was not visible at all. Emissive, with tongues larger than
looked right in the viewport, it reads at 23%. The same lesson the pitch fires
taught, and one worth writing down twice: at 45 pixels a flame that is the
right size is three pixels.

Verified: killed a spearman six tiles away, never moved a tile while doing it,
and left every building's hit points untouched at 2,940.

## The minimap

A top-down canvas above the controls, at the map's own 200x200 resolution and
scaled by CSS, so the picture is one pixel per tile whatever size the box is
drawn at. Ground colours are the editor's own brush swatches, shaded by
elevation — a flat colour map of a tiered world reads as a paint chart, and the
shading is what makes the plateaus and the wadi legible.

**The view outline is the real thing**, not an estimate: the four screen
corners projected onto the ground. Deriving it from the camera target and zoom
would have been an approximation that drifts from what is actually visible; a
diamond, because a screen rectangle *is* a diamond in an isometric world.

It turns with the camera in ninety-degree steps, and click or drag sends the
view there. The forward and inverse mappings are the same rotation, so where
you click and what you get cannot disagree.

Two layout consequences, both found by measuring rather than guessing. At
620px tall the new panel squeezed the right-hand view to an 18px stub, so that
now has a floor of 140px; the controls beneath it then overflowed the window,
so they shrink and scroll instead — rations and taxes stay put and the key
hints scroll.

## Water on every map

Every shipped map now runs a river down its wadi. The wadi was always a dry
riverbed — a `river` half-width per map puts water back in the bottom of it.
The channel floor is flattened to zero rather than merely lowered, because a
bed that still steps up and down where it crosses higher ground gives a chain
of ponds rather than a river.

Pitch marsh seeps along the banks, and that rule deliberately **ignores the
map's marsh bias**. Pitch used to be a fertile-belt feature only, so Dust and
Stone and The Long Drought — which bias marsh down hard, because dryness is
their character — had none at all, and a pitch rig that could never be built
anywhere. A fixed threshold at the water guarantees every map a usable seam
while the bias still shapes everywhere else. The Long Drought now has 747 tiles
of water and 1,324 of marsh and is still unmistakably a drought.

## Naming what the cursor is over

Forty buildings in the same sandstone palette get hard to tell apart at a
glance. Hovering now names whatever is under the cursor and adds the detail
that matters for that kind: workers and output for a workshop, what is sitting
on a store square, how many a hovel houses, and hit points on anything damaged.

Written as **one** function over both sides, so a rival's barracks describes
itself exactly as yours does. Two code paths for "what is this" would drift
into two different answers, and a player scouting an enemy castle wants the
same facts they get at home.

It is kept separate from the placement ghost even though both follow the
cursor. The ghost answers "may this go here" and this answers "what is that";
they are never wanted at the same moment, and folding them together would put
a mode flag inside the one thing whose job is to be glanced at. It does show
while the wrecking tool is armed — reading "Pull down the Iron Mine", because
that is the moment the answer is worth most.

## Saying why a building is idle

Lay down an iron mine with nobody left to work it and, until now, nothing on
screen told you which of your forty buildings was the empty one. A notice
flashed once and scrolled away.

A marker now floats over any understaffed building for as long as it stays
understaffed: **"no worker"** when it is empty, **"short 2"** when it is partly
crewed. It is a DOM overlay positioned from `worldToScreen`, the same way the
placement ghost already works — no new sprite to render, and crisp at every
zoom. Elements are pooled between frames, because recreating a handful of nodes
sixty times a second to say the same thing is churn for nothing.

Two limits are deliberate. Off-screen buildings are culled before anything else
is computed, since on a 200-tile map most buildings are nowhere near the
viewport. And at most twelve markers show at once: if the whole town is
unstaffed the player has one problem, not forty, and the population figure
already says so.

## Versions

`package.json` holds the version number and nothing else does. Vite stamps it
into the bundle alongside the git sha, so the line in the corner of the title
screen, the number in `package.json` and the tag on the container image cannot
drift apart.

Both halves of that line earn their place. The version says what feature set
you have; the **sha says which build**, and two builds of "1.0.0" are otherwise
indistinguishable — which matters a great deal when the question is "did my
container actually update", as it has been more than once.

Click it, on the title screen or in the pause menu, for the release notes. A
gold dot marks a version this browser has not read yet.

`src/game/changelog.ts` is the only copy of those notes. There is deliberately
no `CHANGELOG.md`: two copies of a changelog are two copies that disagree by
the third release. It also sits under `src/`, which the Dockerfile copies
wholesale — a root-level file would need adding to that COPY list by hand, and
forgetting exactly that shipped a half-broken image once already.

Tagging `v1.0.0` publishes `ghcr.io/halvar20000/fiefdom:1.0.0` and `:1.0`
beside `:latest`, so a version can be pinned rather than tracked.

## A soldier stops being a citizen

Recruits used to stay on the population roll: still a mouth to feed, still
occupying a bed. Crusader does the opposite, and it is the better rule — arming
a man takes him out of the town.

So a recruit now leaves `population`, not merely the idle pool. Three things
follow, none of which needed separate code because they all read the same
number: he eats nothing (`foodDemandPerMin` is `population * rate`), he pays no
tax, and his bed comes free — so the ordinary growth drift walks a new peasant
in behind him. That is the "unemployed drops by one and immediately comes
back" the original is known for.

The replacement is deliberately left to that drift rather than spawned on the
spot. An instant refill would let an army be raised at any popularity at all,
and severing recruitment from popularity removes the one cost that keeps the
economy worth playing.

The same rule applies to the rival lords, in `lord.ts`. The whole point of them
is that they run the player's economy under the player's constraints.

A **Soldiers** row now sits in the stats panel, shown only when you have some.
Without it, recruiting reads as people simply vanishing.

Measured: recruiting two archers took population 8 to 6 and idle 8 to 6; a
minute later at popularity 70 the town had refilled to 10 with the two soldiers
still standing, and food consumption read 5.0/min for 10 people rather than the
6.0 twelve would have eaten.

## Demolition, and knowing what you already have

Two small things that were conspicuously missing.

**Demolish** (`X`, or the button under the category bar) arms a wrecking tool:
click a building and it comes down. It stays armed, because clearing a
misplaced row is several clicks; `Esc` or the button disarms it. The keep is
refused outright.

It gives back **half** the build cost. Not nothing and not all: nothing
punishes a misclick harder than the mistake deserves and pushes the player to
reload rather than adapt, while a full refund turns the build menu into a free
sketchpad and drains any weight from deciding where things go.

The teardown is deliberately the same code siege destruction uses — evict the
garrison, free the tiles, resync the workers — because a building removed two
different ways is a building that ends up half-removed by one of them.

**A count on each build tile** shows how many you already have, top-right. It
is blank at zero rather than showing "0": a grid of zeroes is noise, and the
number only starts being interesting once there is one to count.

Checked end to end: pulling down a hovel took the count 4 to 3, returned 3 of
its 6 wood, dropped the population cap from 40 to 32, freed the tiles for
movement, and left the badge reading 3.

## The storehouse

A distant workings is slow for one reason: the producer walks its own load
home. A **Storehouse** (2x2, 15 wood, one worker) breaks that. Producers
deliver to whichever is nearer, the real store or a storehouse, and the
storehouse's own carrier takes the load on in batches of twelve.

It does not remove the walking. It **parallelises** it — one man does the long
haul while the workings keeps producing, instead of the workings stopping for
every trip.

Measured on the same fishery, 74 tiles from its granary, over 600 seconds:

| | Fish delivered |
|---|---|
| Fishery alone | **10** |
| Fishery + storehouse | **58** |

Some deliberate choices in it:

- **Capacity is all goods together**, not per kind. It is a shed, not a set of
  bins, and a per-kind allowance would let one full good hide that the shed is
  otherwise empty.
- **A full storehouse stops attracting deliveries** rather than accepting and
  refusing them, so a shed whose carrier has fallen behind quietly drops out of
  the routing instead of becoming a place loads go to be lost.
- **The carrier does not wait for a full load.** A shed beside a lone
  woodcutter would otherwise sit on four logs forever, which looks exactly like
  a bug.
- **A load the store has no room for goes back in the shed.** The carrier is
  the one part of the chain that can turn round and bring it home; a producer
  standing on a full yard cannot.
- **Nothing routes to a storehouse unless the real store exists.** Otherwise a
  shed becomes a way to "store" goods the town can never reach.

With no storehouse on the map the routing is byte-for-byte the old behaviour:
the loop that considers relays has nothing to iterate.

## Fish, and the fisherman's hut

Water earns its keep: a **Fisherman's Hut** (2x2, 20 wood, one worker) lands
2 fish every 15 seconds straight into the granary, and **fish** is a food the
town eats like any other.

It must stand within **three tiles** of water, measured from the footprint's
edge rather than its centre so a hut with its back to the bank counts the same
as one facing it. Three rather than one because demanding the footprint
actually touch the water turns siting on a ragged imported coastline into a
pixel-hunt, and nobody will quarrel with a jetty three tiles long.

The refusals are separated deliberately. On the lake map's shore: 934 tiles
legal, 177 refused for trees in the way, 156 refused with "You cannot build on
water" — three different answers to three different problems, rather than one
vague "cannot build here".

### Two things measurement caught

**The fish were invisible.** The first bin sprite used apple-sized lumps in a
naturalistic silver and came back with **1%** of the bin's pixels reading blue
at all — at 45 px there was simply nothing there. Bigger bodies and a colour
pushed hard toward blue, exactly as the water tile needed, brought it to
**13%** against meat's 0%.

**The resource bar is not data-driven.** Fish was produced, delivered, stored,
painted into granary bins and eaten correctly while being **completely absent
from the top bar**, because that list is ordered by hand in `hud.ts` so it
reads raw goods then food. Everything else in the economy is data; that one
list is not, and a new resource has to be added there too.

### A note on siting

A fishery far from its granary is slow, because the worker walks its catch
there every cycle — 2 fish per four minutes when the lake is fifty tiles out,
against a cycle time of fifteen seconds. That is not special to fish; every
building pays it. The granary is paintable, so the answer is to grow it toward
the water rather than to expect the hut to carry further.

## Water

A seventh ground type, and the only one that is impassable in itself. Marsh
merely slows a column down; nothing in this game swims.

**Getting the colour right needed measuring, not judging.** The first render
came back at luma 163 against sand's 168 — as bright as the desert it is meant
to sit in, so it read as pale ice rather than water. The ground rig's lighting
lifts the material values a long way. Set low enough to land at **119**, beside
marsh's 117, it now carries the same visual weight as the other dark tile while
being the only genuinely blue thing in the set. That distinction matters at
zoom-out: a player must never have to work out which dark patch is bog he can
trench and which is water he cannot touch.

Water marks itself in **both** occupancy grids at load, before any building
exists — `occupied` so nothing is ever scattered onto it, `paths` so nothing
walks across it. That ordering has one consequence worth knowing: water reaches
the "something is in the way" test before the ground rules, so it needed its
own message, or a lake would report itself as a tree.

`GROUND_TYPES` is now append-only by contract. A painted map stores the ground
*index*, not the name, so reordering that array would silently rewrite every
map already saved.

Verified on an imported lake of 5,436 tiles: every sampled tile blocked, zero
decorations scattered on it, all four building kinds refused with "You cannot
build on water" — including the pitch rig, which is the one thing a bog accepts
— and a path requested straight across the lake routed around it instead.

**The six shipped maps deliberately have no water.** Their terrain is
regenerated from a seed and a save is a diff against that world, so adding
water to the generator would change the ground under every existing save.
Water is available to painted maps, where it costs nothing already saved.

### Reading a map out of a picture

**Import image…** fits a picture inside the map preserving its aspect ratio and
classifies every tile by nearest colour, with green weighted up because the
green channel is what actually separates fertile ground from sand and rock in a
top-down view. The margins are left as sand; stretching a wide image to a square
map would distort every feature on it, which defeats the point of importing.

It reads **ground only**. Elevation cannot be inferred from colour with any
confidence, so hills stay yours to paint, and the import is a starting point to
paint over rather than a finished map.

Water has no entry in the palette because the game has no water. The nearest
thing it owns is marsh, so lakes and sea import as bog — impassable-ish and
unbuildable, which is a better lie than turning a lake into open ground.

Verified against a synthetic 200x200 of known colours: 10,000 sand, 9,200 grass,
9,200 rock and 11,600 marsh, with a deliberate water stripe landing in the marsh
count exactly as intended.

Still not in this version: hand-placing individual trees, for which there is a
density setting instead.

## The siege camp had no art at all

Surfaced by giving the build menu sprite icons: the siege camp was placeable,
cost 40 wood and 10 stone, and was the only source of rams and catapults --
and it had no builder in `buildings.py` and no frames in the atlas, so
`rebuildStatic`'s `push()` found no key and drew nothing. You could buy it and
then never see it.

It is modelled as an open workshop yard rather than a shed: a pitched shelter
across the back over a workbench and stacked timber, a catapult on the stocks
with its arm cocked, a sawing trestle and a pile of shot. Open on three sides
deliberately -- a closed shed reads as one more barn at 96px, and the point of
the building is that you can watch a machine being built in it.

Two pipeline checks worth keeping: the manifest went 296 to 300 entries rather
than being replaced, which is what a partial `--only` render must do; and the
four rotations frame to 240x174, 270x174, 240x202 and 270x186. Four *different*
sizes is the tell that framing happened in camera space. Identical sizes across
all four would mean `frame_object` read a stale `matrix_world`.

## The build menu, and how much screen a HUD is allowed

Every building was listed at once down the left edge. That wanted 729px of
column — taller than most windows — so it ran up over the stats panel, and the
four buildings you actually reach for were buried under a scroll.

Now it works the way Crusader's does: a bar of six categories with **one open
at a time**. Digits `1`-`6` open a category, `B` reopens the last one, and
clicking the open category closes it. The tallest category is 233px against the
old 729px, and closed it is a 40px bar.

The icons are the game's own sprites, pulled from the atlas at load. This is
the point of doing it that way rather than drawing a second set of icons by
hand: a hand-made icon set silently stops matching the day a building is
re-rendered. Scaling is contain-but-never-upscale, so a wall reads as smaller
than a barracks instead of every icon being stretched to a uniform size.

Two stores have no building sprite of their own — they are painted yards
assembled from pile and bin sprites — so they alias to `stockpile_deck` and
`granary_bin`. 25 of the 26 menu entries draw a real sprite. The exception is
the **siege camp, which has no art at all**: it is not in `buildings.py`, so
the world draw call finds no frame and skips it. The building is invisible on
the map. That is a pre-existing gap, not something the menu introduced.

The controls hint block folds away too. It is ten lines of key bindings that
were on screen permanently; it starts open, because box select spent a while
undiscovered behind a hidden hint, and collapses to reclaim 195px once the keys
are in your fingers.

## Rival lords, and why they must not all march on you

A map now carries 0-3 rival lords. `Side` stopped being `'player' | 'enemy'`
and became a **faction number** — 0 is the player, 1.. are rivals. That one
change is what makes rivals hostile to each other for free: every check that
matters asks whether two sides *differ*, not whether one of them is the player.
Each faction owns its own buildings, keep, wall ring, gate, colour and `Lord`.

### Nearest-keep targeting is wrong, and not subtly

The player starts near the middle and rivals ring the map, so the player is
nearest to **all** of them. Measured on a three-lord map: 104 against 145 and
110, 42 against 145 and 92, 81 against 110 and 92. Three lords all beelining
the player is one lord tripled — strictly worse for the player than having a
single opponent, and none of the three-cornered war that is the entire reason
to want more than one.

So the player's distance is weighted **up**, heavily at first and decaying:
×2.6 at the start, ×1.0 by thirty minutes. The resulting arc, verified:

| | Red | Blue | Violet |
|---|---|---|---|
| at start | → Violet | → Violet | → Blue |
| at 10 min | → Violet | → **player** | → Blue |
| at 30 min | → player | → player | → player |

Early they carve each other up while you build; late they turn on you.
Confirmed in simulation with the player holding **zero soldiers**, so every
casualty had to be rival-on-rival: **26 deaths** (Red 12, Violet 14) and 79,246
ticks of rivals targeting rivals, with all 28 player buildings untouched.

### Colour has to be pushed unevenly

Sandstone is warm, so warming it further reads instantly but cooling it only
neutralises. The blue rival at the same numeric distance from neutral as the red
one came out as grey, not blue. Blue and violet are pushed harder to land at the
same *apparent* distance from the player's own stone.

### Save format

Bumped to v4: `enemyBuildings` became a `factions` array. Saves from v3 are
rejected with "from an older build" rather than loaded into a world whose
shape no longer matches them.

## M2, part four: the enemy lord

A second castle stands across the map — keep, barracks, hovels and a walled
compound, built from the player's own building set and washed red. He raises
troops at his barracks, holds five back as a garrison, and marches the rest at
your keep in waves that grow as the game goes on.

Measured over twelve minutes against a fifteen-strong garrison: 36 troops
raised, four waves sent at 7, 8 and 9 strong, and the player ground from 15
defenders down to 9 while the lord climbed to 20 — because the player stopped
recruiting and he did not.

### He runs a real economy, on the player's own rules

He starts with a keep and one hovel and **builds everything else himself**,
paying for it out of production. `BUILD_PLAN` is a running target per building,
so a name appearing twice reads as stages. A measured run:

| t | what appears |
|---|---|
| 50s | woodcutter |
| 80s | stockpile squares |
| 170s | granary |
| 220s | hunter |
| 280s | quarry, then an ox tether beside it |
| 310s | wheat farm |
| 360-380s | mill, bakery |
| **390s** | **barracks — the first military building** |
| 490s | iron mine |
| 560s | curtain wall |
| 1010s | siege camp |

Nothing military exists until the food and timber chains are running, which is
the point: he has to earn an army the way the player does.

He uses the SAME numbers throughout — the same `BUILDINGS` defs and production
rates, the same input chains (his mill needs wheat, his bakery needs flour), the
same `RATIONS` and `TAX_LEVELS` tables, the same building costs, the same
storage capacities, the same terrain rules, and the same 14-tile ox-tether test
for quarries. End state at 25 minutes: 83 buildings, population 72 of 72
housing, 186 food, no starvation, 24 troops.

**What is abstracted:** labour and haulage. His workers are a headcount, not
figures walking to and from a stockpile, and his storage capacity is pooled
across goods rather than reserved per square. Simulating either would double the
cost of the game loop to animate people nobody is looking at. Everything that
affects the outcome is real.

**And it is attackable.** Kill his woodcutters and his timber stops dead
(measured: -4 wood over two minutes instead of climbing). Kill his barracks and
recruitment stops. Kill his keep and he is finished.

### Three things that had to be fixed before any of that worked

* **A greedy plan starves its own expensive step.** He skipped anything he could
  not afford and moved to the next item — so with a gatehouse at 15 stone and a
  wall at 3, every stone he earned went into wall segments and he never
  accumulated 15 in his life. Measured: 37 walls and no gatehouse at twenty
  minutes. He now SAVES for a step he cannot afford, and only skips one whose
  ground is wrong (no amount of saving fixes that), with patience running out
  after 150 seconds so he cannot deadlock.
* **Ox tethers must be built beside the quarry, not the keep.** Placed from the
  keep like everything else they landed in the courtyard while the quarries sat
  on whatever rock the map offered, usually past the 14-tile haul range. Two
  quarries, two tethers, and **two stone in the bank after half an hour**.
* **The terrain gate was missing.** `isBuildable` only checks that ground is
  LEVEL, so without an explicit check he would have put wheat farms on sand and
  quarries on grass — the sort of quiet exemption that makes an opponent feel
  like it is cheating.

### He runs unaided, and needs nothing from the player

He starts on his own 90 seconds in — measured: 0 troops at 80s, 1 at 120s, 10 at
300s, with the player doing nothing at all. There is no switch to throw.

### His castle grows

`enemyBuildings` starts as a keep and one hovel and is added to as he can afford
things. He does not repair damage.

### He depends on his own buildings

Knocking out his **barracks stops recruitment dead** — measured 7 recruits in
120 seconds with it standing, 0 in 240 seconds without. Destroying his **keep**
ends him entirely; troops already on the field fight on, but nothing more comes.

That gate was missing at first: `muster()` returned a position cached at
worldgen, so he cheerfully went on conjuring troops out of the rubble of his own
barracks. It is checked live now, because flattening the barracks is the first
thing any player tries once they own a catapult.

### His buildings are not in `state.buildings`

Everything in that list feeds the player's economy — housing, storage, worker
slots — so putting an enemy keep in it hands the player its beds and its
granary. The lord's castle is a separate list that is marked in `occupied` and
in the path grid, and drawn through the same static sprite stream with a tint.
Checked after placing it: player housing still 24, unchanged.

### Two tints, not one

A soldier is twenty-odd pixels and must read as hostile at a glance, so his tint
is heavy. A castle covers a third of the screen, and that same heavy tint over
that much stone stops reading as a banner colour and starts reading as a broken
render. Buildings get a softer wash.

### Pick the gate, then build the wall

The first version cut a gap in the player-facing wall and placed the gatehouse
in it. On this map that exact spot was never level, three fallback offsets all
failed too, and the castle came out with an open breach and no gate. Choosing
the side by `Math.sign()` on both axes independently also cut a second gap
whenever the player was diagonally opposite.

Now every position on the ring is a candidate, sorted by distance to the player,
and the first that will take a 2x2 gets the gate; the wall is then built around
whatever the gate occupies. Verified the castle interior, the gate and the open
map are all one path region, so his troops can actually get out — which is
easy to get wrong and produces an opponent who never attacks.

## M2, part five: siege engines and destructible buildings

A **Siege Camp** builds two machines: a **battering ram** (120g + 25 wood, tough,
reach 1.7) and a **catapult** (200g + 30 wood + 10 iron, fragile, reach 7.5).
Priced well above troops on purpose — a catapult is the answer to "how do I ever
beat the lord", and it should cost a real part of an economy.

**Only siege engines damage buildings.** That is what makes them worth their
price and worth escorting: an engine ignores enemy soldiers completely and will
stand there being cut to pieces without swinging back.

Buildings carry `hp`, defaulted from the footprint by `buildingHp` so adding a
building never silently creates an indestructible one. Keep 900, tower 420,
gatehouse 340, wall 130. When one falls its tiles are freed in both the
occupancy grid and the path grid — verified: a destroyed wall tile becomes
walkable, which is the whole point of breaching one.

**Destroying the lord's keep wins.** Measured: two engines against his south
wall took it down in under 30 seconds and the tile opened; parked at the keep
they brought it down in 70 and fired the victory notice. It works both ways —
an enemy ram destroyed a player hovel in 30 seconds and housing dropped from 24
to 16 as the beds went with it.

The lord fields his own engines after ten minutes. Without them he can kill every
peasant you own and never take a single stone of your castle, so a walled player
eventually becomes untouchable and the war just stops.

### They are Soldiers

Engines reuse the whole unit system — `SOLDIER_TYPES` entries with `siege: true`,
so movement, selection, orders, tinting and the draw path all work unchanged.
The one constraint that buys: the rendered clips must be named
`${type}_${idle|walk|attack}` exactly, which is why `siege.py` emits
`ram_walk`, `catapult_attack` and so on rather than anything tidier.

### Measure to the footprint's edge

`distToFootprint` clamps the engine's position onto the building's rectangle.
Measuring to the CENTRE instead would have a catapult judge itself out of range
by half a keep and stop short of a building it was standing against — and a ram,
with reach 1.7 against a 3x3 keep whose centre is 1.5 tiles inside it, would
never connect at all.

### Modelling note

The ram was first built with a full-length roof, which covered the log
completely: the one part that says "battering ram" was invisible and it read as
a covered wagon. The shelter now stops short so the iron head projects past it,
which is how a real one is built anyway.

## M2, part six: manning the walls

Right-click one of your own walls, towers or gatehouses with troops selected and
they walk to the foot of it and climb on. A posted man:

* stands on the walkway — heights come straight from the Blender models
  (wall 0.92, tower 1.65, gatehouse 1.41 tiles)
* reaches **2.5 tiles further** — an archer goes from 6.5 to 9
* **cannot be touched by melee.** That is the whole bargain, and the whole
  point of a wall. Only attackers with reach 3 or more can hit him
* holds his post. He never climbs down to chase, and a move order is also the
  order to come down

When the thing under him falls he **drops rather than dies**, at 60% health.
Killing the garrison outright would make a breached wall an instant massacre and
punish the player twice for the same event. Verified: tower destroyed, 0 still
posted, 4 survivors on the ground at 16 hp from 26.

The lord mans his own battlements the same way, spread across gatehouse, towers
and wall segments rather than piled on one spot.

### Three things this needed before it worked

* **A one-shot check at recruitment posts nobody.** The lord raises his first
  garrison around the six-minute mark and his wall does not go up until nine, so
  every man checked for a post, found none, and never looked again — 24 troops
  and an empty wall at twenty-five minutes. He re-checks every 8 seconds.
* **The post cap has to count men still walking there.** Counting only those
  already mounted assigned an entire garrison to the same gatehouse in one tick,
  before any of them had arrived.
* **Pooled storage starved him of stone.** His capacity was shared across goods
  rather than reserved per good as the player's yard does, so 316 wood filled
  498 of his 500 raw capacity, stone never rose above 2, and he could not afford
  a single 20-stone tower all game while his quarries ran flat out with nowhere
  to put the output. One good starving another is exactly what the player's
  per-square allocation prevents, and the lord now uses the same rule. After the
  fix: 66 stone in the bank and two towers built.

### Not done yet

Enemies cannot climb walls or use ladders, so a fully walled player is safe from
everything except the lord's siege engines. Siege still cannot be aimed at a
chosen building.

**Siege engines hold position.** An engine never goes looking for a target: it
fires at whatever is already inside its reach and otherwise waits to be told
where to go. Auto-advancing meant a catapult trundled off across the map the
moment it was built, which made it impossible to keep one at home for defence.
Verified: 0 tiles moved over 150 seconds unordered, 8+ tiles on an order, and
still fires when parked beside enemy stone.

**Siege cannot be aimed.** An engine attacks the nearest enemy building in
range, so you breach the outer wall and work inwards rather than choosing a
target. Right-clicking a building to assign it is the obvious fix and is not
built.

**Engines die alone.** Twice while testing, a lone catapult sent at the lord's
castle was cut down by his garrison before it broke anything — which is the
design working (an engine ignores soldiers and never defends itself) but is
worth stating plainly: they need an escort, and a test that forgets one measures
nothing.
Archers use a real "Standing Draw Arrow" clip. It samples **10** frames where
the melee swings use 6: a draw is slow and then sudden, and six evenly spaced
samples land almost all of them on the slow part and miss the loose entirely.
`SOLDIERS[body].attack_frames` overrides the count per body.

## Pitch marsh: ground as a weapon

A sixth ground type. Boggy grey-green land where tar seeps up, seeded INSIDE
the fertile belt rather than out in dead sand — sitting on the good land it
costs something to own, which is the point.

It does three things:

* **It is the only place a pitch rig will stand.** The rig used to sit on any
  open sand; now pitch has a home and a location decision.
* **Nothing else can be built on it.** Not a hovel, not a wall.
* **It halves movement, and all but stops siege.** Foot at 0.48, wheels at
  0.26. Measured over six tiles: spearman 5.95 dry against 3.27 in the bog,
  catapult 1.80 against 0.47. A marsh across the approach means siege goes the
  long way round or does not come at all.

Speed is sampled per step from the tile underfoot, not fixed when the order is
given, so a column slows entering the bog and recovers leaving it — which is
what makes the ground readable and worth routing around. Peasants wade too: a
marsh between a woodcutter and the stockpile is an economic cost as well as a
military one.

### It has to be visible to matter

First render sat only six points cooler than `grass_dark` and read as just more
dark grass. A hazard the player is expected to route AROUND has to be
identifiable in one glance at full zoom-out. Pushed grey, the gap doubled —
warmth (R−B) of +5.7 against grass_dark's +18.2 and sand's +59.8, the coldest
tile in the set by a distance.

### A guard in the wrong place

The marsh rule went into `terrainAllows`, which looked right and did nothing:
`check()` only called that function when `def.terrain !== 'any'`, so hovels,
markets, walls and most of the game skipped the ground rules entirely and could
be built straight over a bog. The terrain test now runs for every building —
`'any'` means any DRY ground, and `terrainAllows` is what knows that.

### What pitch is for

**Pitch ditches.** 4 pitch each, laid like wall segments, walkable — and that
is the trick: the enemy crosses without a thought. Press **F** and every ditch
with an enemy standing in it catches, then the fire **spreads through the
connected trench**, which is what makes laying a line worth the pitch rather
than dotting single tiles about.

Burning pitch does 14 a second for 12 seconds: a spearman dies in three, a
swordsman in seven. Verified tick by tick — 95, 81, 67, 53, 39, 25, 11, 0.

It burns **friend and foe alike**. Fire does not check banners, and a player
who has to pull his own men clear is making a decision rather than pressing a
free win button.

#### Damage must not stack across overlapping fires

Burn radius is 1.6 tiles and ditches sit one tile apart, so the radii overlap
heavily. Applying damage per fire meant a man in the middle of a trench took
triple damage and five spearmen died in under four seconds — a line of ditches
was not a longer trap, it was a hotter one. Each man now burns once per tick
however many fires he stands in, so a longer line buys a bigger AREA to deny,
which is the trade that should be on offer.

## Wildlife and the hunter

Gazelle graze the open land in fifteen herds of three to six, seeded
deterministically from the map seed — wildlife that moved on every reload would
make any measurement of a hunter's output unrepeatable. Herds are kept off rock,
apart from each other, and at least sixteen tiles from the keep, since gazelle
in the courtyard read as a bug.

Animals are deliberately **not** decorations. Decorations are static and live in
the pre-sorted scenery list; anything that moves has to join the per-frame figure
stream with the workers, or it gets depth-sorted once and then walks through
everything it was sorted behind.

**A marked animal freezes.** When a hunter picks its quarry the animal stops and
goes on grazing — it has not noticed him. That is what lets the hut reuse the
ordinary walk-to-a-fixed-spot machinery the woodcutter already uses, instead of
needing a chase and a moving-target path. Measured: 16 samples of a marked
animal, zero drift.

The prey mark is `Worker.prey`, kept separate from `Worker.claim` rather than
overloaded onto it: one indexes the static scatter list, the other a live herd
whose members come and go, and a single field would silently mean two different
things depending on the job.

Balance, measured over 600 s with one hut beside a herd: **17 kills, 0 failed
takes, 15 respawns**, about 3.4 meat/min. The herd sustains itself at that rate
(`RESPAWN_SECONDS = 110`). Against the pig farm and slaughterhouse at roughly
13 meat/min, the hunter is the slow option that needs no green ground — which is
the point on a desert start.

### Two traps in measuring this

* **Counting dead animals is not counting kills.** With a 110 s respawn the dead
  count returns to its baseline, so a 600 s window that contained 17 kills read
  as zero and looked exactly like a hunt that was producing meat out of thin air.
  Instrument `Herd.take`, not the population.
* **Meat is food, so the stock barely moves.** It is eaten as fast as it arrives;
  the stockpile figure said 1 while production was healthy. Read
  `ledger.producedPerMin`, which is a 60-second rolling window.

### The gazelle sprites

96 sprites from `tools/render/wildlife.py` and `render_wildlife.py`: walk (6
frames), graze (4) and idle (2), each in 8 world-space facings. No armature —
a quadruped walk is four legs swinging in diagonal pairs, which is a handful of
Euler angles. `_limb` moves the mesh *below* its origin so the pivot is the hip;
geom.box would otherwise put the origin at the hoof and swing the whole animal's
foot in a circle round the ground.

Two calibrations: the neck angle was inverted at first (a negative rotation of
the +Y neck points it at the ground, so the alert pose looked like a permanent
graze and the graze clip had nowhere to go), and the first build was far too
stocky — leg length carries the whole silhouette at 16 px.

`render_wildlife.py` and `render_units.py` share `units.json` and both MERGE into
it. `render_units.py` used to overwrite it outright, which would have deleted
every animal the moment anyone re-rendered one peasant clip — the identical bug
that once wiped `buildings.json`.

## Woodcutters and the forest

Woodcutters are the one job whose destination is a real thing on the map, so
they get special handling in `workerWorld.workSpot`:

* Each worker **claims** its own tree. Without the reservation every hut sends
  its man to the same nearest trunk and they stack on one tile.
* The worker stands ~0.55 tiles from the trunk on the side facing home, which
  also leaves its walk heading pointing at the tree, so the chop animation faces
  what it is cutting.
* Finishing a cycle **fells** the tree: it disappears, the tile becomes
  buildable, and it regrows after `TREE_REGROW_SECONDS` unless something was
  built there meanwhile. Felling is what makes the wood visibly come from
  somewhere.
* No tree within `TREE_SEARCH_RADIUS` means the worker waits and warns, rather
  than miming the job at thin air.

Note `stepSim` (the headless test path on `__game`) must run the same steps as
the frame loop. It once omitted `regrowForest`, which made regrowth look broken
in tests while working fine in the game.

Add `--only keep,hovel` to re-render a subset; the manifest merges rather than
being replaced. All assets render in a single Blender process because Cycles
spends over a minute compiling Metal kernels on first use — warm renders are
under a second each.

## Running

```bash
npm install && npm run dev
```

`R` / `E` rotate, wheel zooms, drag or WASD pans.
`?view=1100x760` overrides the projected area (useful for screenshots in a
small window). `?noterrain` / `?nosprites` isolate a layer when profiling.

## Status

M0 (look test) and M1 (the economy) are built: terrain with cliff faces,
27 buildings, vegetation, Mixamo peasants, 4-way rotation, A* pathfinding,
the full food/ale/meat chains, painted stockpile and granary, standing trade
orders, gazelle herds and a hunter.

M2 is next: walls, towers, soldiers, an AI lord.

Known gaps:
* **No save/load.** A settlement does not survive a reload. The most valuable
  missing thing, and it gets harder every session the state model grows.
* **No sound at all** — not one file, not one line. Deferred until after M2.
  Web Audio synthesis is the plan (matching the generated-asset approach
  everywhere else); it cannot do voices or music.
* Ground is flatter and browner than the reference over large stretches.
* Frame rate has not been measured since sprites went to alpha blending. Draw
  calls went 4 -> 2; it was 120 fps before.

Keep this section honest. It sat here claiming "M0 is built, no gameplay yet,
there is no pathfinding" for several milestones after all three stopped being
true, while the technical sections below were kept current.

## Two fixes worth not regressing

**Sprite depth against terrain.** A sprite is a flat quad drawn at ONE depth,
taken from its tile origin -- which at most rotations is the footprint's
*farthest* corner. Every ground tile under the building is then nearer and wins
the depth test, so terrain draws over the building's base and it looks
half-buried. `footprintDepthBias()` in `iso.ts` pushes each sprite to the depth
of its *nearest* footprint corner. A 3x3 keep needs ~3.7 world units of bias;
a token nudge is nowhere near enough.

**Mixamo does not use the same bone prefix across downloads.** The Y Bot
character rigs as `mixamorig:Hips`; every animation from the same session rigs
as `mixamorig1:Hips`. Assigning such an action binds cleanly, reports success,
and animates nothing -- the figure renders in a flawless T-pose, which reads as
a posing bug rather than a naming one. `render_units.py::retarget_action`
rewrites the channel paths. Note also that Blender 5.x removed `Action.fcurves`:
actions are slotted, and fcurves live in `action.layers[].strips[].channelbags[]`.

**Never silence an unused GLSL uniform with `void(x);`.** That is a TypeScript
idiom; in GLSL `void` is a type and cannot be constructed. It fails the fragment
shader compile, three.js falls back, and the terrain renders solid black -- which
looks like a lighting or overlay bug and sends you tuning colours that were
never the problem. Delete the uniform instead. Check the console for
`Shader Error` before theorising about anything visual.

**Fill light.** Every building is seen from four sides and the two facing away
from the sun must stay readable -- the original's sprites never go to black
silhouette. The rig therefore runs a deliberately strong warm bounce
(`BOUNCE_STRENGTH = 1.45`) standing in for light off hot sand. It must stay
warm: raising the blue sky fill instead greys the sandstone, which was an
earlier wrong turn.
