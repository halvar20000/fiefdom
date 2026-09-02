"""
Store squares -- the stockpile's decks and the granary's bins -- and the
goods sitting on them.

Stronghold's stockpile is not a building, it is an area: you paint squares and
each square shows what is actually stored there. That readout is the whole
point -- you glance at the yard and know you are drowning in wheat and out of
iron, without opening a panel.

Each sprite is ONE tile: the plank deck plus its load, baked together. Two
sprites per tile (deck, then pile) would have to be depth-sorted against each
other at identical depth keys, and against peasants walking over the deck;
baking them removes the question entirely.

Three fill levels per good. Two reads as a binary full/empty light, and four is
not distinguishable at 45 px per tile.
"""

from __future__ import annotations
import math

import bpy
import geom
import materials as M

REGISTRY = {}

#: Fill levels rendered per good. Keep in step with STOCKPILE_LEVELS in defs.ts.
LEVELS = (1, 2, 3)



# --- materials -------------------------------------------------------------
#
# The building palette is deliberately one warm sandstone family, which is
# right for architecture and wrong here: rendered with it, logs, cut stone,
# wheat and flour all came out the same tan and the yard read as undifferentiated
# clutter. A stockpile only works if you can name the good at a glance, so these
# pull hard away from each other in hue.

def _cut_stone(name="PileCutStone"):
    """Cool grey granite -- deliberately NOT the sandstone the castle is built of."""
    mat, nt, bsdf = M._new(name)
    pos = M._pos(nt, 1.0)
    n = M._noise(nt, pos, scale=22.0, detail=6.0, roughness=0.6)
    ramp = M._ramp(nt, [
        (0.30, (0.36, 0.37, 0.38, 1.0)),
        (0.55, (0.50, 0.51, 0.52, 1.0)),
        (0.85, (0.62, 0.63, 0.63, 1.0)),
    ], n.outputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    M._set(bsdf, "Roughness", 0.88)
    M._bump(nt, bsdf, n.outputs["Fac"], strength=0.7, distance=0.012)
    return mat


def _grain(name="PileGrain"):
    """Ripe wheat: saturated gold, well clear of the deck's timber."""
    mat, nt, bsdf = M._new(name)
    pos = M._pos(nt, 1.0)
    n = M._noise(nt, pos, scale=40.0, detail=7.0, roughness=0.7)
    ramp = M._ramp(nt, [
        (0.28, (0.60, 0.42, 0.09, 1.0)),
        (0.58, (0.82, 0.62, 0.14, 1.0)),
        (0.88, (0.94, 0.78, 0.30, 1.0)),
    ], n.outputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    M._set(bsdf, "Roughness", 0.86)
    M._bump(nt, bsdf, n.outputs["Fac"], strength=0.9, distance=0.014)
    return mat


def _bark(name="PileBark"):
    """Dark red-brown bark, so a log stack is not the colour of its own pallet."""
    mat, nt, bsdf = M._new(name)
    pos = M._pos(nt, 1.0)
    n = M._noise(nt, pos, scale=30.0, detail=8.0, roughness=0.65)
    ramp = M._ramp(nt, [
        (0.25, (0.16, 0.10, 0.06, 1.0)),
        (0.60, (0.29, 0.19, 0.11, 1.0)),
        (0.90, (0.40, 0.28, 0.17, 1.0)),
    ], n.outputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    M._set(bsdf, "Roughness", 0.90)
    M._bump(nt, bsdf, n.outputs["Fac"], strength=1.0, distance=0.018)
    return mat


# --- helpers ---------------------------------------------------------------

def _deck(parts):
    """
    The plank platform every stockpile tile stands on.

    Inset from the tile edge so a run of adjacent tiles shows seams instead of
    merging into one featureless floor.
    """
    dark = M.timber("DeckBeam", dark=True)
    light = M.timber("DeckPlank")

    parts.append(geom.box("pd_beam_a", (0.03, 0.03, 0.0), (0.94, 0.07, 0.045), dark))
    parts.append(geom.box("pd_beam_b", (0.03, 0.90, 0.0), (0.94, 0.07, 0.045), dark))
    for i in range(6):
        y = 0.045 + i * 0.152
        parts.append(geom.box(f"pd_plank_{i}", (0.03, y, 0.045),
                              (0.94, 0.132, 0.035), light))
    return 0.08          # deck top; everything else stacks from here


def _log(name, centre, length, radius, mat, segments=10, along='y'):
    """A cylinder lying flat. geom.cylinder only builds along +Z."""
    o = geom.cylinder(name, (0.0, 0.0, 0.0), radius, length, mat, segments=segments)
    cx, cy, cz = centre
    if along == 'y':
        o.rotation_euler = (-math.pi / 2.0, 0.0, 0.0)
        o.location = (cx, cy - length / 2.0, cz)
    else:
        o.rotation_euler = (0.0, math.pi / 2.0, 0.0)
        o.location = (cx - length / 2.0, cy, cz)
    return o


def _barrel(name, centre, radius, height, body, hoop):
    """Upright barrel with two iron hoops, so it is not just a plain drum."""
    out = []
    cx, cy, cz = centre
    out.append(geom.cylinder(name, (cx, cy, cz), radius, height, body, segments=12))
    for i, f in enumerate((0.22, 0.70)):
        out.append(geom.cylinder(f"{name}_h{i}", (cx, cy, cz + height * f),
                                 radius * 1.06, height * 0.08, hoop, segments=12))
    return out


def _sack(name, corner, size, mat, rot_z=0.0):
    """
    A sack: a box with a smaller box on top.

    Two stacked boxes read as a slumped bag at sprite scale, where a single box
    reads as a crate -- which matters, because crates are what the pig pens use.
    """
    w, d, h = size
    x, y, z = corner
    return [
        geom.box(name, (x, y, z), (w, d, h * 0.62), mat, rot_z=rot_z),
        geom.box(f"{name}_top", (x + w * 0.13, y + d * 0.13, z + h * 0.62),
                 (w * 0.74, d * 0.74, h * 0.38), mat, rot_z=rot_z),
    ]


def _grid(n, cols, x0, y0, dx, dy):
    """Positions for n items laid out left to right, front to back."""
    return [(x0 + (i % cols) * dx, y0 + (i // cols) * dy) for i in range(n)]


# --- the empty deck --------------------------------------------------------

def stockpile_deck():
    parts = []
    _deck(parts)
    return geom.join(parts, "stockpile_deck"), (1, 1)


REGISTRY["stockpile_deck"] = stockpile_deck


# --- one builder per good --------------------------------------------------

def _wood(level):
    parts = []
    top = _deck(parts)
    bark = _bark()
    cut = M.cloth("LogEnd", colour=(0.78, 0.66, 0.44))

    rows = {1: [3], 2: [4, 3], 3: [4, 3, 2]}[level]
    r = 0.078
    for ri, count in enumerate(rows):
        z = top + r + ri * (r * 1.72)
        x0 = 0.5 - (count - 1) * (r * 2.05) / 2.0
        for i in range(count):
            x = x0 + i * (r * 2.05)
            parts.append(_log(f"pw_{ri}_{i}", (x, 0.5, z), 0.86, r, bark))
            # pale end grain, so a stack of logs reads end-on as well as side-on
            parts.append(geom.cylinder(f"pw_end_{ri}_{i}", (x, 0.5 - 0.43, z),
                                       r * 0.97, 0.02, cut, segments=10))
    return parts


def _stone(level):
    parts = []
    top = _deck(parts)
    block = _cut_stone()
    layers = {1: 1, 2: 2, 3: 3}[level]
    bw, bd, bh = 0.30, 0.30, 0.135
    for ly in range(layers):
        n = 4 if ly < layers - 1 or level < 3 else 2
        for i, (x, y) in enumerate(_grid(n, 2, 0.16, 0.16, 0.37, 0.37)):
            # half-lap every other course, as a mason would stack them
            ox = 0.045 if ly % 2 else 0.0
            parts.append(geom.box(f"ps_{ly}_{i}", (x + ox, y, top + ly * bh),
                                  (bw, bd, bh), block))
    return parts


def _iron(level):
    parts = []
    top = _deck(parts)
    bar = M.iron()
    # Iron is dense: it ships as low, tidy bar stacks, never as a heap.
    stacks = {1: 2, 2: 4, 3: 6}[level]
    for i, (x, y) in enumerate(_grid(stacks, 3, 0.10, 0.16, 0.28, 0.36)):
        for k in range(3):
            parts.append(geom.box(f"pi_{i}_{k}", (x + (k % 2) * 0.015, y, top + k * 0.052),
                                  (0.24, 0.28, 0.05), bar))
    return parts


def _pitch(level):
    parts = []
    top = _deck(parts)
    tar, nt, bsdf = M._new("PitchTar")
    M._set(bsdf, "Base Color", (0.05, 0.045, 0.04, 1.0))
    M._set(bsdf, "Roughness", 0.28)
    band = M.iron()
    n = {1: 2, 2: 4, 3: 6}[level]
    for i, (x, y) in enumerate(_grid(n, 3, 0.20, 0.28, 0.30, 0.42)):
        parts += _barrel(f"pp_{i}", (x, y, top), 0.125, 0.30, tar, band)
    return parts


def _wheat(level):
    parts = []
    top = _deck(parts)
    straw = _grain()
    twine = M.cloth("Twine", colour=(0.40, 0.30, 0.15))
    n = {1: 3, 2: 5, 3: 8}[level]
    for i, (x, y) in enumerate(_grid(n, 3, 0.23, 0.25, 0.27, 0.26)):
        h = 0.34 + (0.035 if i % 2 else 0.0)
        parts.append(geom.cylinder(f"pwh_{i}", (x, y, top), 0.125, h, straw, segments=9))
        parts.append(geom.cone(f"pwh_t_{i}", (x, y, top + h), 0.125, 0.14, straw))
        parts.append(geom.cylinder(f"pwh_b_{i}", (x, y, top + h * 0.55),
                                   0.131, 0.032, twine, segments=9))
    return parts


def _flour(level):
    parts = []
    top = _deck(parts)
    linen = M.cloth("FlourSack", colour=(0.88, 0.86, 0.80))
    rows = {1: [3], 2: [4, 3], 3: [4, 3, 2]}[level]
    for ri, count in enumerate(rows):
        for i, (x, y) in enumerate(_grid(count, 2, 0.12, 0.14, 0.40, 0.42)):
            parts += _sack(f"pf_{ri}_{i}", (x, y, top + ri * 0.19),
                           (0.34, 0.34, 0.19), linen, rot_z=0.18 * (i % 3))
    return parts


def _hops(level):
    parts = []
    top = _deck(parts)
    wicker = M.cloth("Wicker", colour=(0.58, 0.44, 0.22))
    leaf = M.cloth("HopLeaf", colour=(0.40, 0.52, 0.20))
    n = {1: 2, 2: 4, 3: 6}[level]
    for i, (x, y) in enumerate(_grid(n, 3, 0.20, 0.28, 0.30, 0.42)):
        parts.append(geom.cylinder(f"ph_{i}", (x, y, top), 0.135, 0.22, wicker, segments=11))
        # heaped green above the rim -- the only thing separating these from flour
        parts.append(geom.cone(f"ph_c_{i}", (x, y, top + 0.22), 0.132, 0.10, leaf))
    return parts


def _ale(level):
    parts = []
    top = _deck(parts)
    oak = M.cloth("AleOak", colour=(0.42, 0.26, 0.13))
    hoop = M.iron()
    n = {1: 2, 2: 4, 3: 6}[level]
    for i, (x, y) in enumerate(_grid(n, 3, 0.20, 0.28, 0.30, 0.42)):
        parts += _barrel(f"pa_{i}", (x, y, top), 0.128, 0.32, oak, hoop)
    return parts


def _pigs(level):
    """
    Livestock waiting on the slaughterhouse, so: slatted crates, not a heap.

    A "pile of pigs" is the one good here that cannot be stacked, and drawing it
    like sacks of flour would read as a bug rather than as a stylisation.
    """
    parts = []
    top = _deck(parts)
    slat = M.timber("CrateSlat", dark=True)
    hide = M.cloth("PigHide", colour=(0.72, 0.52, 0.48))
    crates = {1: 1, 2: 2, 3: 3}[level]
    spots = [(0.28, 0.30), (0.28, 0.66), (0.66, 0.48)]
    for c in range(crates):
        cx, cy = spots[c]
        w = 0.36
        parts.append(geom.box(f"pg_base_{c}", (cx - w / 2, cy - w / 2, top),
                              (w, w, 0.03), slat))
        for si in range(4):
            a = si * math.pi / 2.0
            ox, oy = math.cos(a) * (w / 2 - 0.02), math.sin(a) * (w / 2 - 0.02)
            parts.append(geom.box(f"pg_wall_{c}_{si}", (cx + ox - 0.03, cy + oy - 0.03, top),
                                  (0.06 if si % 2 else 0.03, 0.03 if si % 2 else 0.06, 0.20),
                                  slat, rot_z=a))
        for si in range(4):
            a = si * math.pi / 2.0
            parts.append(geom.box(f"pg_rail_{c}_{si}",
                                  (cx - w / 2, cy - w / 2 + (w - 0.025) * (si % 2), top + 0.09 + 0.07 * (si // 2)),
                                  (w, 0.025, 0.035), slat))
        # the pig itself: a rounded body showing over the slats
        parts.append(geom.cylinder(f"pg_body_{c}", (cx, cy, top + 0.03), 0.115, 0.15,
                                   hide, segments=10))
        parts.append(geom.cylinder(f"pg_head_{c}", (cx + 0.10, cy, top + 0.05), 0.058, 0.11,
                                   hide, segments=8))
    return parts


def _hides(level):
    """
    Cured hides: stacked FLAT, edges out of true, one draped over the stack.

    First attempt rolled them into bundles and laid them in rows, which put a
    stack of horizontal cylinders on the deck -- pixel for pixel the log pile
    two squares away. Shape is the only thing that survives at one tile, so
    hides are the flat good: thin slabs with their corners askew, which no
    other pile in the yard looks anything like.
    """
    parts = []
    top = _deck(parts)
    tans = (M.cloth("PileHideA", colour=(0.55, 0.40, 0.25)),
            M.cloth("PileHideB", colour=(0.62, 0.47, 0.31)),
            M.cloth("PileHideC", colour=(0.48, 0.34, 0.21)))
    b = geom.rng_for(f"hides{level}")

    stacks = {1: [(0.50, 0.50, 4)], 2: [(0.40, 0.44, 6)], 3: [(0.36, 0.40, 6), (0.66, 0.62, 5)]}[level]
    for si, (cx, cy, count) in enumerate(stacks):
        z = top
        for i in range(count):
            t = 0.032 + b.random() * 0.008
            w = 0.52 + b.random() * 0.08
            d = 0.44 + b.random() * 0.08
            parts.append(geom.box(f"ph_{si}_{i}", (cx - w / 2.0, cy - d / 2.0, z), (w, d, t),
                                  tans[i % len(tans)], rot_z=(b.random() - 0.5) * 0.5))
            z += t
        # One hide hung over the side of the stack, which stops a tidy stack of
        # slabs reading as planks or cut stone.
        parts.append(geom.box(f"ph_drape_{si}", (cx - 0.30, cy - 0.26, z - 0.20),
                              (0.30, 0.42, 0.03), tans[1], rot_z=0.25))
        parts[-1].rotation_euler = (0.0, -0.85, 0.25)
    return parts


_GOODS = {
    "wood": _wood, "stone": _stone, "iron": _iron, "pitch": _pitch,
    "wheat": _wheat, "flour": _flour, "hops": _hops, "ale": _ale, "pigs": _pigs,
    "hides": _hides,
}


def _make(good, builder, level):
    def build():
        name = f"pile_{good}_{level}"
        return geom.join(builder(level), name), (1, 1)
    return build


for _good, _builder in _GOODS.items():
    for _lvl in LEVELS:
        REGISTRY[f"pile_{_good}_{_lvl}"] = _make(_good, _builder, _lvl)


# --- granary bins ----------------------------------------------------------
#
# The granary gets the same paint-a-square treatment as the yard, but it cannot
# be the same flat deck: two stores that look alike are worse than one store.
# A bin -- flagged floor, low stone kerb, four timber posts -- reads as a
# granary bay while still letting you see what is in it, which is the whole
# reason for doing this. The kerb stays low so peasants walking across it do
# not look like they are wading through masonry.

def _ball(name, centre, r, mat, segments=8):
    """A lump. geom has no sphere; two cones read as one at 45 px per tile."""
    cx, cy, cz = centre
    top = geom.cone(f"{name}_t", (cx, cy, cz), r, r, mat, segments=segments)
    bot = geom.cone(f"{name}_b", (0.0, 0.0, 0.0), r, r, mat, segments=segments)
    bot.rotation_euler = (math.pi, 0.0, 0.0)
    bot.location = (cx, cy, cz)
    return [top, bot]


def _bin(parts):
    """The empty granary bay. Returns the floor height goods stack from."""
    floor = M.flagstone()
    kerb = M.plaster(tint=(0.63, 0.57, 0.44))
    post = M.timber("BinPost", dark=True)

    parts.append(geom.box("gb_floor", (0.03, 0.03, 0.0), (0.94, 0.94, 0.05), floor))
    for i, (x, y, w, d) in enumerate([
        (0.03, 0.03, 0.94, 0.07), (0.03, 0.90, 0.94, 0.07),
        (0.03, 0.10, 0.07, 0.80), (0.90, 0.10, 0.07, 0.80),
    ]):
        # Kerb height is load-bearing, visually: at 0.13 it hid a level-1 load
        # completely and a bin with three loaves in it looked empty, which
        # defeats the point of being able to see the store at all.
        parts.append(geom.box(f"gb_kerb_{i}", (x, y, 0.05), (w, d, 0.085), kerb))
    for i, (x, y) in enumerate([(0.03, 0.03), (0.87, 0.03), (0.03, 0.87), (0.87, 0.87)]):
        parts.append(geom.box(f"gb_post_{i}", (x, y, 0.05), (0.10, 0.10, 0.30), post))
    return 0.05


def _bread(level):
    parts = []
    top = _bin(parts)
    crust = M.cloth("Crust", colour=(0.62, 0.40, 0.17))
    rows = {1: [3], 2: [4, 3], 3: [4, 4, 3]}[level]
    for ri, count in enumerate(rows):
        for i, (x, y) in enumerate(_grid(count, 2, 0.18, 0.20, 0.34, 0.34)):
            z = top + ri * 0.13
            parts.append(geom.box(f"gr_l_{ri}_{i}", (x, y, z), (0.28, 0.20, 0.08),
                                  crust, rot_z=0.15 * (i % 3)))
            parts.append(geom.box(f"gr_lt_{ri}_{i}", (x + 0.035, y + 0.025, z + 0.08),
                                  (0.21, 0.15, 0.05), crust, rot_z=0.15 * (i % 3)))
    return parts


def _cheese(level):
    parts = []
    top = _bin(parts)
    rind = M.cloth("Rind", colour=(0.86, 0.74, 0.36))
    stacks = {1: 3, 2: 4, 3: 5}[level]
    high = {1: 1, 2: 2, 3: 3}[level]
    for i, (x, y) in enumerate(_grid(stacks, 3, 0.26, 0.28, 0.26, 0.36)):
        for k in range(high):
            parts.append(geom.cylinder(f"gc_{i}_{k}", (x, y, top + k * 0.10),
                                       0.115, 0.095, rind, segments=12))
    return parts


def _apples(level):
    parts = []
    top = _bin(parts)
    skin = M.cloth("AppleSkin", colour=(0.62, 0.16, 0.12))
    r = 0.062
    # a heap: each layer smaller than the one below, nestled into its gaps
    layers = {1: [(3, 0.0)], 2: [(3, 0.0), (2, 0.0)], 3: [(4, 0.0), (3, 0.0), (2, 0.0)]}[level]
    for li, (n, _) in enumerate(layers):
        span = (n - 1) * (r * 1.95)
        for ix in range(n):
            for iy in range(n):
                x = 0.5 - span / 2 + ix * (r * 1.95)
                y = 0.5 - span / 2 + iy * (r * 1.95)
                parts += _ball(f"ga_{li}_{ix}_{iy}", (x, y, top + r + li * (r * 1.55)), r, skin)
    return parts


def _meat(level):
    parts = []
    top = _bin(parts)
    rack = M.timber("MeatRack")
    flesh = M.cloth("Flesh", colour=(0.54, 0.21, 0.19))
    rows = {1: [2], 2: [3, 2], 3: [3, 3, 2]}[level]
    for ri, count in enumerate(rows):
        z = top + ri * 0.12
        parts.append(geom.box(f"gm_rack_{ri}", (0.14, 0.16, z), (0.72, 0.68, 0.025), rack))
        for i, (x, y) in enumerate(_grid(count, 2, 0.20, 0.22, 0.32, 0.32)):
            parts.append(geom.box(f"gm_{ri}_{i}", (x, y, z + 0.025), (0.26, 0.20, 0.09),
                                  flesh, rot_z=0.12 * (i % 3)))
    return parts


def _fish(level):
    """
    Fish laid out on the slab.

    Two things had to be corrected by measurement rather than eye. The first
    pass used apple-sized lumps and came back with 1% of the bin's pixels
    reading blue at all -- at 45 px the fish simply were not there. And the
    warm sun neutralises a naturalistic silver: the colour has to be pushed
    hard toward blue in the material to arrive as blue on screen, exactly as
    the water tile did.

    Built from paired cones nose to nose, so each fish tapers at both ends. A
    fish that reads as a box is indistinguishable from the cheese.
    """
    parts = []
    top = _bin(parts)
    slab = M.timber("FishSlab", dark=True)
    scale = M.cloth("FishScale", colour=(0.30, 0.52, 0.80))
    dark = M.cloth("FishBack", colour=(0.12, 0.26, 0.52))

    rows = {1: [2], 2: [3, 2], 3: [3, 3, 2]}[level]
    for ri, count in enumerate(rows):
        z = top + ri * 0.13
        parts.append(geom.box(f"gf_slab_{ri}", (0.11, 0.13, z), (0.78, 0.74, 0.022), slab))
        for i, (x, y) in enumerate(_grid(count, 2, 0.26, 0.28, 0.34, 0.34)):
            body = dark if (i + ri) % 2 else scale
            zz = z + 0.022 + 0.10
            # head and tail: two cones meeting at the middle, laid on their side
            head = geom.cone(f"gf_h_{ri}_{i}", (x - 0.02, y, zz), 0.10, 0.20, body, segments=7)
            head.rotation_euler = (0.0, math.pi / 2.0, 0.30 * (i % 3))
            tail = geom.cone(f"gf_t_{ri}_{i}", (x - 0.02, y, zz), 0.10, 0.16, body, segments=7)
            tail.rotation_euler = (0.0, -math.pi / 2.0, 0.30 * (i % 3))
            parts += [head, tail]
    return parts


def granary_bin():
    parts = []
    _bin(parts)
    return geom.join(parts, "granary_bin"), (1, 1)


REGISTRY["granary_bin"] = granary_bin

_FOODS = {"bread": _bread, "cheese": _cheese, "apples": _apples,
          "meat": _meat, "fish": _fish}


def _make_bin(good, builder, level):
    def build():
        return geom.join(builder(level), f"bin_{good}_{level}"), (1, 1)
    return build


for _food, _fb in _FOODS.items():
    for _lvl in LEVELS:
        REGISTRY[f"bin_{_food}_{_lvl}"] = _make_bin(_food, _fb, _lvl)
