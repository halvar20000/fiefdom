"""
Parametric buildings, modelled against the reference screenshots.

Each builder returns (object, footprint_tiles). The tile origin is world (0,0,0)
and the building occupies +X / +Y from there, so the game can place it by its
north-west tile corner.

Sizes come straight off the reference: the keep in Central_Building.png is a
squat 3x3 block roughly two tiles tall with a crenellated wall-walk and a
projecting door surround; the industry buildings are low, wide and timber.
"""

from __future__ import annotations
import math

import bpy

import geom
import materials as M
import props


def keep():
    """The lord's keep: 3x3, stone, battlemented, banner on the corner."""
    stone = M.castle_stone()
    dark = M.iron()
    banner = M.cloth(colour=(0.60, 0.09, 0.10))
    timber = M.timber(dark=True)

    w = d = 3.0
    body_h = 1.85
    parts = []

    # slightly battered base course reads as weight
    parts.append(geom.box("keep_plinth", (-0.06, -0.06, 0.0), (w + 0.12, d + 0.12, 0.16), stone))
    parts.append(geom.box("keep_body", (0.0, 0.0, 0.14), (w, d, body_h), stone))

    # wall-walk parapet
    parts += geom.crenellate("keep_cren", (0.0, 0.0), w, d, stone,
                             merlon=0.30, gap=0.24, height=0.30, thickness=0.16,
                             z=body_h + 0.14)

    # Corner pilasters running the full height. Four unbroken faces of ashlar
    # is a great deal of flat wall at this zoom; the pilasters give each face a
    # frame and put a hard vertical shadow at every corner.
    for (px, py) in ((-0.05, -0.05), (w - 0.13, -0.05),
                     (-0.05, d - 0.13), (w - 0.13, d - 0.13)):
        parts.append(geom.box("keep_pilaster", (px, py, 0.0),
                              (0.18, 0.18, body_h + 0.14), stone))

    # String course dividing the wall into two storeys, the way the reference
    # keep's is. Without it the height reads as one huge undifferentiated block
    # and the building loses its scale.
    parts.append(geom.box("keep_string", (-0.05, -0.05, 1.02),
                          (w + 0.10, d + 0.10, 0.09), stone))

    # projecting door surround on the -Y face, with a real boarded gate in it
    parts.append(geom.box("keep_porch", (0.85, -0.30, 0.14), (1.30, 0.32, 1.05), stone))
    parts.append(geom.arch_doorway("keep_door", (1.05, -0.36, 0.14), 0.62, 0.95, 0.10, dark))
    parts += geom.plank_door("keep_gate", (1.09, -0.40, 0.14), 0.54, 0.66,
                             timber, dark, planks=5)
    # steps up to it
    for i in range(3):
        parts.append(geom.box(f"keep_step_{i}", (0.95 - i * 0.05, -0.38 - i * 0.13, 0.0),
                              (1.10 + i * 0.10, 0.14, 0.14 - i * 0.045), stone))

    # arrow slits, splayed and hooded so they are not simply dark rectangles
    for (sx, sy, rot) in ((0.55, -0.02, 0.0), (2.30, -0.02, 0.0),
                          (-0.02, 1.10, math.pi / 2), (-0.02, 2.05, math.pi / 2)):
        parts.append(geom.box("keep_slit", (sx, sy, 0.95), (0.10, 0.06, 0.34), dark, rot_z=rot))
    for (wx, wy, rot) in ((0.42, -0.06, 0.0), (2.17, -0.06, 0.0),
                          (-0.06, 0.97, math.pi / 2), (-0.06, 1.92, math.pi / 2)):
        parts += geom.shuttered_window("keep_win", (wx, wy, 1.22), 0.24, 0.34,
                                       dark, stone, rot_z=rot, shutters=False)

    # flagstone deck inside the parapet, so the roof is not a blank plane in the
    # rotations that look down onto it
    deck = M.flagstone("KeepDeck")
    parts.append(geom.box("keep_deck", (0.16, 0.16, body_h + 0.14),
                          (w - 0.32, d - 0.32, 0.035), deck))

    # Timber hoarding on the -X wall head: the covered fighting gallery a keep
    # under threat gets, and the one thing that breaks the parapet's straight
    # top line.
    #
    # It stands ON the wall-walk, at the same height a man on the parapet
    # stands. Hung from the top of the merlons instead -- which is where the
    # first attempt put it, by measuring from the parapet's cap rather than its
    # base -- it reads as an awning floating clear of the wall, with daylight
    # under it and its posts propped on nothing.
    walk_z = body_h + 0.14
    parts.append(geom.box("keep_hoard_floor", (-0.34, 0.52, walk_z - 0.07),
                          (0.40, 1.96, 0.09), timber))
    # brackets carrying the floor out past the wall face
    brac = geom._Batch()
    for i in range(6):
        py = 0.60 + i * 0.34
        brac.rod((0.02, py, walk_z - 0.36), (-0.30, py, walk_z - 0.07), 0.035)
    parts.append(brac.finish("keep_hoard_brackets", timber))
    # posts, and a boarded outer wall with shooting gaps between the boards
    posts = geom._Batch()
    for i in range(6):
        py = 0.60 + i * 0.34
        posts.box((-0.30, py, walk_z), (0.08, 0.08, 0.62))
    for k in range(4):
        posts.box((-0.33, 0.52, walk_z + 0.06 + k * 0.14), (0.06, 1.96, 0.09))
    parts.append(posts.finish("keep_hoard_wall", timber))
    parts += geom.shingle_roof("keep_hoard", (-0.36, 0.50, walk_z + 0.62),
                               (0.46, 2.00, 0.24), M.shingle_wood("KeepHoardRoof"),
                               overhang=0.09, course=0.11, ridge_mat=timber)

    # banner pole at the +X/-Y corner -- tall enough to break the silhouette
    parts.append(geom.box("keep_pole", (2.84, 0.10, body_h + 0.14), (0.07, 0.07, 1.35), timber))
    parts.append(geom.box("keep_banner", (2.50, 0.12, body_h + 0.78), (0.36, 0.025, 0.62), banner))

    return geom.join(parts, "keep"), (3, 3)


def hovel():
    """Peasant housing: 2x2, half-timbered daub walls under heavy thatch."""
    wall = M.plaster(tint=(0.93, 0.90, 0.82))
    roof = M.thatch()
    timber = M.timber(dark=True)
    light = M.timber()
    stone = M.rough_stone()
    dark = M.iron()

    x, y, w, d, h = 0.18, 0.20, 1.62, 1.44, 0.78
    parts = []

    parts += geom.stone_footing("hovel", (x, y, 0.0), (w, d, h), stone,
                                height=0.13, block=0.24)
    parts += geom.timber_frame("hovel", (x, y, 0.0), (w, d, h), wall, timber,
                               bay=0.52, mid_rail=False)
    parts += geom.thatch_roof("hovel", (x, y, h), (w, d, 0.84), roof,
                              overhang=0.26, depth=0.11, binder_mat=timber)

    parts.append(geom.arch_doorway("hovel_door", (x + 0.60, y - 0.08, 0.0),
                                   0.40, 0.56, 0.12, dark))
    parts += geom.shuttered_window("hovel_win", (x + 1.16, y - 0.06, 0.38),
                                   0.22, 0.20, dark, timber, shutters=False)

    # A water butt by the door and firewood stacked under the eaves: the
    # smallest signs that somebody lives here, and at this zoom they are the
    # difference between a house and a shape.
    parts += geom.barrel("hovel_butt", (x + 0.30, y - 0.18, 0.0), 0.115, 0.30,
                         light, dark)
    parts += geom.log_stack("hovel_wood", (x + w + 0.03, y + 0.32, 0.0), 6,
                            0.60, 0.055, light, along='y')

    return geom.join(parts, "hovel"), (2, 2)


def woodcutter():
    """Woodcutter's hut: 2x2 open-fronted timber shed with a log pile."""
    timber_l = M.timber()
    timber_d = M.timber(dark=True)
    roof = M.shingle_wood()
    wall = M.plaster(tint=(0.90, 0.86, 0.76))
    stone = M.rough_stone()

    x, y, w, d, h = 0.20, 0.26, 1.60, 1.16, 0.88
    parts = []
    parts += geom.stone_footing("wc", (x, y, 0.0), (w, d, h), stone, height=0.11)
    # Three walls and an open working front: the shed is where the sawing
    # happens and the player should be able to see into it.
    parts += geom.timber_frame("wc", (x, y, 0.0), (w, d, h), wall, timber_d,
                               bay=0.50, wall=0.15, sides=('+y', '-x', '+x'))
    parts += geom.shingle_roof("wc", (x, y, h), (w, d, 0.52), roof,
                               overhang=0.20, ridge_mat=timber_d)
    parts += geom.rafters("wc", (x, y, 0.0), (w, d, h), timber_d, overhang=0.20)

    # sawn logs stacked beside the hut, and the chopping block
    parts += geom.log_stack("wc_logs", (0.24, 0.46, 0.0), 6, 0.70, 0.085,
                            timber_l, along='y')
    parts.append(geom.cylinder("wc_block", (1.48, 0.52, 0.0), 0.16, 0.26,
                               timber_l, segments=12))
    parts += geom.log_stack("wc_offcut", (1.30, 1.52, 0.0), 3, 0.42, 0.055,
                            timber_l, along='x')
    return geom.join(parts, "woodcutter"), (2, 2)


def stockpile():
    """3x3 flagged platform with goods stacked on it."""
    flag = M.castle_stone()
    timber_l = M.timber()
    iron = M.iron()

    parts = []
    parts.append(geom.box("sp_deck", (0.0, 0.0, 0.0), (3.0, 3.0, 0.10), flag))
    # A kerb round the paving, so the yard has an edge instead of ending
    # wherever the terrain happens to be.
    kerb = geom._Batch()
    for (kx, ky, kw, kd) in ((0.0, 0.0, 3.0, 0.10), (0.0, 2.90, 3.0, 0.10),
                             (0.0, 0.10, 0.10, 2.80), (2.90, 0.10, 0.10, 2.80)):
        kerb.box((kx, ky, 0.10), (kw, kd, 0.06))
    parts.append(kerb.finish("sp_kerb", M.rough_stone("StockpileKerb")))

    # sawn planks, stacked and slightly out of true
    planks = geom._Batch()
    rnd = geom.rng_for("stockpile_planks")
    for i in range(5):
        planks.box((0.25 + (rnd.random() - 0.5) * 0.05, 0.30, 0.16 + i * 0.072),
                   (1.05, 0.62, 0.065))
    parts.append(planks.finish("sp_planks", timber_l))
    # dressed stone blocks, courses offset
    for i, (bx, by, bz) in enumerate(((1.75, 0.35, 0.16), (2.30, 0.35, 0.16),
                                      (1.75, 0.92, 0.16), (1.98, 0.52, 0.50))):
        parts.append(geom.box(f"sp_stone_{i}", (bx, by, bz), (0.48, 0.48, 0.34), flag))
    # iron bars, round bar stock rather than flat slabs
    bars = geom._Batch()
    for row in range(3):
        for col in range(4 - row):
            bars.rod((0.35 + row * 0.06 + col * 0.115, 1.85, 0.19 + row * 0.10),
                     (0.35 + row * 0.06 + col * 0.115, 2.72, 0.19 + row * 0.10),
                     0.055, segments=6)
    parts.append(bars.finish("sp_iron", iron))
    parts += geom.barrel("sp_barrel", (2.42, 2.30, 0.16), 0.16, 0.36, timber_l, iron)
    parts += geom.crate("sp_crate", (2.28, 1.62, 0.16), (0.42, 0.38, 0.32), timber_l)
    return geom.join(parts, "stockpile"), (3, 3)


def quarry_rock():
    """Scatter prop: a rubble outcrop, 1x1."""
    stone = M.rough_stone()
    parts = [
        geom.box("rock_a", (0.18, 0.20, 0.0), (0.46, 0.40, 0.30), stone, rot_z=0.4),
        geom.box("rock_b", (0.44, 0.36, 0.0), (0.34, 0.32, 0.22), stone, rot_z=-0.7),
        geom.box("rock_c", (0.30, 0.52, 0.0), (0.26, 0.24, 0.16), stone, rot_z=1.1),
    ]
    return geom.join(parts, "rock"), (1, 1)


REGISTRY = {
    "keep": keep,
    "hovel": hovel,
    "woodcutter": woodcutter,
    "stockpile": stockpile,
    "rock": quarry_rock,
}


# ---------------------------------------------------------------------------
# M1 economy buildings
#
# Modelled against the labelled reference sheets: industry buildings are low,
# wide and timber-framed; food buildings are stone-walled with tiled or thatched
# roofs. Nothing here is taller than about 1.5 tiles except the mill, which
# earns its height by being the one silhouette you can pick out at a glance.
# ---------------------------------------------------------------------------

def _ox(name_prefix, origin, mat_hide, mat_dark, rot_z=0.0):
    """
    A draught ox.

    Used to be two boxes and four sticks, on the reasoning that at sixty pixels
    the silhouette is all that survives. At the zoom the game now reaches it is
    nearer a hundred and forty, and a cow made of cuboids is the most obviously
    unfinished thing in a farmyard -- the eye forgives a blocky building far
    more readily than a blocky animal. So: a barrel body that tapers to the
    shoulder, a dropped head, horns and a tail.
    """
    ox, oy = origin
    b = geom.rng_for(name_prefix)
    body = geom._Batch()
    # Built around the LOCAL origin and placed by finish(), never at absolute
    # coordinates. `rot_z` turns an object about its own origin, so geometry
    # baked at world coordinates gets swung around the map origin instead of
    # about the animal -- which put the dairy's cow on the byre roof.
    # barrel of the body, four tapering rings along its length
    rings = ((0.00, 0.115), (0.22, 0.150), (0.62, 0.146), (0.86, 0.112),
             (1.00, 0.085))
    seg, prev = 8, None
    for (t, r) in rings:
        n0 = len(body.verts)
        for i in range(seg):
            a = (i / seg) * math.tau
            body.verts.append((0.06 + t * 0.56,
                               0.14 + math.cos(a) * r,
                               0.34 + math.sin(a) * r * 0.92))
        if prev is not None:
            for i in range(seg):
                j = (i + 1) % seg
                body.faces.append((prev + i, prev + j, n0 + j, n0 + i))
        prev = n0
    body.faces.append(tuple(range(seg - 1, -1, -1)))
    body.faces.append(tuple(range(prev, prev + seg)))
    # neck and head, dipped toward the grass
    body.slab((0.58, 0.05, 0.30), (0.16, 0.0, -0.05),
              (0.0, 0.18, 0.0), (0.0, 0.0, 0.17))
    body.slab((0.72, 0.06, 0.20), (0.15, 0.0, -0.02),
              (0.0, 0.16, 0.0), (0.0, 0.0, 0.14))
    at = (ox, oy, 0.0)
    parts = [body.finish(f"{name_prefix}_body", mat_hide, at, rot_z)]

    dark = geom._Batch()
    for (lx, ly) in ((0.10, 0.02), (0.10, 0.20), (0.52, 0.02), (0.52, 0.20)):
        j = 0.20 + b.random() * 0.04
        dark.rod((lx, ly + 0.03, j), (lx + 0.015, ly + 0.03, 0.0), 0.030, segments=6)
    # horns and tail
    dark.rod((0.84, 0.07, 0.32), (0.90, -0.01, 0.38), 0.017, segments=5)
    dark.rod((0.84, 0.20, 0.32), (0.90, 0.28, 0.38), 0.017, segments=5)
    dark.rod((0.06, 0.14, 0.40), (-0.03, 0.14, 0.14), 0.016, segments=5)
    parts.append(dark.finish(f"{name_prefix}_dark", mat_dark, at, rot_z))
    return [p for p in parts if p is not None]


def quarry():
    """Stone quarry: a cut face, dressed blocks and a timber shear-legs hoist."""
    stone = M.castle_stone()
    rough = M.rough_stone()
    timber = M.timber(dark=True)
    rope = M.cloth("QuarryRope", colour=(0.44, 0.38, 0.26))

    parts = []
    # The worked face, broken into stepped chunks. A single tall box read as a
    # slab of marble rather than a cut hillside.
    for i, (bx, by, bw, bd, bh, rz) in enumerate((
        (0.00, 2.20, 1.30, 0.80, 0.62, 0.05),
        (1.15, 2.35, 1.10, 0.65, 0.48, -0.08),
        (2.05, 2.15, 0.95, 0.85, 0.70, 0.11),
        (0.45, 1.75, 0.85, 0.45, 0.30, -0.04),
        (1.70, 1.80, 0.80, 0.40, 0.24, 0.07),
    )):
        parts.append(geom.box(f"q_face_{i}", (bx, by, 0.0), (bw, bd, bh), rough, rot_z=rz))

    # shear legs over the cut
    for sx in (0.55, 2.25):
        parts.append(geom.box(f"q_leg_{sx}", (sx, 0.85, 0.0), (0.10, 0.10, 1.35), timber))
    parts.append(geom.box("q_beam", (0.50, 0.85, 1.30), (1.90, 0.11, 0.11), timber))
    parts.append(geom.box("q_rope", (1.40, 0.89, 0.72), (0.035, 0.035, 0.60), rope))

    # dressed blocks waiting to be hauled
    for i, (bx, by, bz) in enumerate(((0.30, 0.30, 0.0), (0.86, 0.30, 0.0),
                                      (0.30, 0.30, 0.34), (1.95, 0.45, 0.0))):
        parts.append(geom.box(f"q_block_{i}", (bx, by, bz), (0.52, 0.46, 0.32), stone))
    return geom.join(parts, "quarry"), (3, 3)


def ox_tether():
    """Ox and sledge: the stone haulier. 2x2."""
    hide = M.plaster("OxHide", tint=(0.36, 0.22, 0.13))
    dark = M.timber(dark=True)
    timber = M.timber()
    stone = M.castle_stone()

    # The ox stands IN FRONT of the sledge, not on top of it. It used to be
    # placed inside the sledge's own footprint, which at the old zoom passed as
    # a vague brown mass and now reads as an animal sunk into its cargo.
    parts = [geom.box("ot_post", (1.72, 0.98, 0.0), (0.10, 0.10, 0.70), dark)]
    parts += _ox("ot_ox", (0.86, 0.72), hide, dark)
    # sledge with a block on it, and the traces running up to the yoke
    parts.append(geom.box("ot_sledge", (0.12, 0.66, 0.0), (0.62, 0.50, 0.09), timber))
    parts.append(geom.box("ot_load", (0.20, 0.72, 0.09), (0.46, 0.38, 0.28), stone))
    for ty in (0.78, 0.98):
        parts.append(geom.box(f"ot_trace_{ty}", (0.72, ty, 0.24), (0.20, 0.035, 0.035), dark))
    return geom.join(parts, "ox_tether"), (2, 2)


def iron_mine():
    """Iron mine: timber headframe over the adit, ore heaped beside it."""
    timber = M.timber(dark=True)
    plank = M.timber()
    rough = M.rough_stone()
    ore = M.iron()

    parts = []
    parts.append(geom.box("im_platform", (0.15, 0.15, 0.0), (2.70, 2.70, 0.10), plank))
    parts.append(geom.box("im_mouth", (0.95, 1.85, 0.10), (1.10, 0.85, 0.70), rough))
    parts.append(geom.arch_doorway("im_adit", (1.15, 1.78, 0.10), 0.62, 0.60, 0.10,
                                   M.timber(dark=True)))

    # A-frame headgear
    for sx in (0.80, 2.10):
        for sy in (1.20, 1.72):
            parts.append(geom.box(f"im_leg_{sx}_{sy}", (sx, sy, 0.10), (0.09, 0.09, 1.05), timber))
    parts.append(geom.box("im_head", (0.75, 1.15, 1.12), (1.42, 0.63, 0.10), timber))

    # ore heaps
    for i, (bx, by) in enumerate(((0.40, 0.45), (0.85, 0.35), (0.45, 0.90))):
        parts.append(geom.box(f"im_ore_{i}", (bx, by, 0.10), (0.34, 0.30, 0.20), ore,
                              rot_z=0.4 * i))
    return geom.join(parts, "iron_mine"), (3, 3)


def pitch_rig():
    """Pitch rig: duckboards over the tar seep, with a collecting pot."""
    plank = M.timber()
    dark = M.timber(dark=True)
    tar, nt, bsdf = M._new("Tar")
    M._set(bsdf, "Base Color", (0.05, 0.045, 0.04, 1.0))
    M._set(bsdf, "Roughness", 0.28)
    pot = M.plaster("PitchPot", tint=(0.58, 0.32, 0.24))

    parts = []
    parts.append(geom.box("pr_pool", (0.25, 0.25, 0.0), (1.55, 1.55, 0.05), tar))
    # duckboards
    for i in range(5):
        parts.append(geom.box(f"pr_board_{i}", (0.18, 0.30 + i * 0.30, 0.05),
                              (1.70, 0.18, 0.05), plank))
    for sx in (0.20, 1.72):
        parts.append(geom.box(f"pr_rail_{sx}", (sx, 0.25, 0.05), (0.08, 1.55, 0.08), dark))
    parts.append(geom.cylinder("pr_pot", (1.55, 0.55, 0.10), 0.22, 0.30, pot, segments=12))
    return geom.join(parts, "pitch_rig"), (2, 2)


def market():
    """Market stall: striped awning, trestle of goods, a set of scales."""
    timber = M.timber()
    dark = M.timber(dark=True)
    canvas = M.cloth("Awning", colour=(0.72, 0.66, 0.50))
    stripe = M.cloth("AwningStripe", colour=(0.55, 0.16, 0.14))
    iron = M.iron()

    parts = []
    for (px, py) in ((0.25, 0.25), (2.55, 0.25), (0.25, 2.35), (2.55, 2.35)):
        parts.append(geom.box(f"mk_post_{px}_{py}", (px, py, 0.0), (0.09, 0.09, 1.15), dark))

    # A ridged, striped awning rather than a flat lid. A stall roof is cloth
    # thrown over a ridge pole; a horizontal slab reads as a table on stilts,
    # which is what this looked like once there were enough pixels to tell.
    #
    # The stripes run ACROSS the slope, alternating panel by panel. Colouring
    # one whole slope red and the other cream instead -- which is what falls
    # out of building each side as a single batch -- makes a two-tone tent, not
    # a market stall.
    parts.append(geom.box("mk_ridge", (0.18, 1.26, 1.46), (2.54, 0.08, 0.08), dark))
    panels = {0: geom._Batch(), 1: geom._Batch()}
    n = 10
    for side in (-1, 1):
        y_ridge = 1.30
        y_eave = 2.26 if side > 0 else 0.34
        for i in range(n):
            x = 0.18 + (2.54 * i) / n
            dip = 0.07 * math.sin(((i + 0.5) / n) * math.pi)
            panels[i % 2].slab(
                (x, y_ridge, 1.46 - dip),
                (2.54 / n, 0.0, 0.0),
                (0.0, y_eave - y_ridge, 1.06 - (1.46 - dip)),
                (0.0, 0.0, 0.045))
    parts.append(panels[0].finish("mk_awning_a", canvas))
    parts.append(panels[1].finish("mk_awning_b", stripe))

    parts.append(geom.box("mk_trestle", (0.40, 0.45, 0.44), (2.20, 0.70, 0.08), timber))
    for (lx, ly) in ((0.44, 0.48), (2.52, 0.48), (0.44, 1.08), (2.52, 1.08)):
        parts.append(geom.box(f"mk_leg_{lx}_{ly}", (lx, ly, 0.0), (0.08, 0.08, 0.44), dark))
    # goods on the trestle: crates, sacks and a barrel rather than six identical
    # blocks in a row
    parts += geom.crate("mk_crate_a", (0.52, 0.56, 0.52), (0.32, 0.28, 0.24), timber)
    parts += geom.crate("mk_crate_b", (0.90, 0.60, 0.52), (0.26, 0.24, 0.20), timber)
    parts += geom.crate("mk_crate_c", (0.55, 0.58, 0.76), (0.24, 0.22, 0.18), timber)
    parts += geom.barrel("mk_barrel", (1.42, 0.72, 0.52), 0.13, 0.30, timber, iron)
    for i in range(3):
        parts.append(geom.box(f"mk_sack_{i}", (1.75 + i * 0.26, 0.58 + (i % 2) * 0.18, 0.52),
                              (0.22, 0.20, 0.22), canvas, rot_z=0.25 * i))
    parts.append(geom.box("mk_scale_post", (2.30, 1.60, 0.0), (0.06, 0.06, 0.85), iron))
    parts.append(geom.box("mk_scale_beam", (2.05, 1.62, 0.82), (0.56, 0.04, 0.04), iron))
    for px in (2.08, 2.58):
        parts.append(geom.box(f"mk_pan_{px}", (px, 1.55, 0.60), (0.16, 0.16, 0.03), iron))
        parts.append(geom.box(f"mk_chain_{px}", (px + 0.075, 1.62, 0.63),
                              (0.012, 0.012, 0.20), iron))
    return geom.join(parts, "market"), (3, 3)


def granary():
    """Granary: stone-walled food store with a wide loading arch."""
    stone = M.castle_stone()
    roof = M.thatch()
    dark = M.timber(dark=True)
    plaster = M.plaster(tint=(0.92, 0.89, 0.81))
    sack = M.cloth("Sack", colour=(0.66, 0.58, 0.40))

    shingle = M.shingle_wood()
    x, y, w, d, h = 0.10, 0.25, 2.80, 2.30, 1.05

    parts = []
    parts.append(geom.box("gr_plinth", (x - 0.07, y - 0.07, 0.0),
                          (w + 0.14, d + 0.14, 0.13), stone))
    parts.append(geom.box("gr_body", (x, y, 0.11), (w, d, h), stone))
    # Timber upper storey over the stone base -- the reference granary is a
    # stone ground floor carrying a jettied timber loft, and the change of
    # material halfway up is most of what makes it read as a big building
    # rather than a big box.
    parts += geom.timber_frame("gr_loft", (x - 0.06, y - 0.06, h + 0.11),
                               (w + 0.12, d + 0.12, 0.46), plaster, dark,
                               bay=0.62, mid_rail=False)
    parts += geom.shingle_roof("gr", (x - 0.06, y - 0.06, h + 0.57),
                               (w + 0.12, d + 0.12, 0.74), shingle,
                               overhang=0.22, ridge_mat=dark)
    parts += geom.rafters("gr", (x - 0.06, y - 0.06, h + 0.57),
                          (w + 0.12, d + 0.12, 0.0), dark, overhang=0.22)

    parts.append(geom.arch_doorway("gr_door", (1.15, y - 0.10, 0.11),
                                   0.78, 0.82, 0.14, dark))
    # loading hatch and hoist beam in the gable
    parts.append(geom.box("gr_hoist", (1.38, y - 0.42, h + 0.44),
                          (0.10, 0.52, 0.10), dark))
    parts += geom.shuttered_window("gr_hatch", (1.24, y - 0.08, h + 0.16),
                                   0.38, 0.30, dark, dark)
    for i, (sx, sy) in enumerate(((0.30, 0.05), (0.62, 0.02), (2.45, 0.06))):
        parts.append(geom.box(f"gr_sack_{i}", (sx, sy, 0.0), (0.26, 0.22, 0.28), sack,
                              rot_z=0.3 * i))
    parts += geom.barrel("gr_barrel", (2.62, 0.42, 0.0), 0.13, 0.34,
                         M.timber(), M.iron())
    return geom.join(parts, "granary"), (3, 3)


def wheat_farm():
    """Farmstead: cottage plus a ploughed strip of field."""
    wall = M.plaster(tint=(0.92, 0.89, 0.80))
    roof = M.thatch()
    dark = M.timber(dark=True)
    soil = M.plaster("Furrow", tint=(0.40, 0.30, 0.20))
    crop, nt, bsdf = M._new("Wheat")
    M._set(bsdf, "Base Color", (0.72, 0.62, 0.26, 1.0))
    M._set(bsdf, "Roughness", 0.9)

    parts = []
    parts += geom.stone_footing("wf", (0.20, 1.85, 0.0), (1.65, 1.00, 0.76),
                                M.rough_stone(), height=0.11)
    parts += geom.timber_frame("wf", (0.20, 1.85, 0.0), (1.65, 1.00, 0.76),
                               wall, dark, bay=0.54, mid_rail=False)
    parts += geom.thatch_roof("wf", (0.20, 1.85, 0.76), (1.65, 1.00, 0.66),
                              roof, overhang=0.22, binder_mat=dark)
    parts.append(geom.arch_doorway("wf_door", (0.85, 1.78, 0.0), 0.38, 0.52, 0.11, dark))
    parts += geom.log_stack("wf_sheaves", (1.95, 1.92, 0.0), 3, 0.72, 0.09,
                            M.thatch(), along='y')

    # field furrows in front, planted with real stalks
    for i in range(6):
        parts.append(geom.box(f"wf_furrow_{i}", (0.15, 0.20 + i * 0.26, 0.0),
                              (2.70, 0.17, 0.05), soil))
    parts += geom.stalks("wf_crop", (0.18, 0.22, 0.04), (2.62, 1.52, 0.0), crop,
                         rows=6, spacing=0.075, height=0.26)
    return geom.join(parts, "wheat_farm"), (3, 3)


def mill():
    """Windmill. The one tall silhouette in the economy -- deliberately so."""
    stone = M.castle_stone()
    timber = M.timber(dark=True)
    sail = M.cloth("Sail", colour=(0.76, 0.72, 0.60))
    cap = M.thatch()

    shingle = M.shingle_wood("MillCap")
    parts = []
    parts.append(geom.cylinder("ml_batter", (1.5, 1.5, 0.0), 0.80, 0.18,
                               M.rough_stone("MillFooting"), segments=14))
    parts.append(geom.cylinder("ml_tower", (1.5, 1.5, 0.0), 0.72, 1.75, stone, segments=14))
    # A stage running round the tower at the height a miller reaches the sails
    # from, on brackets. The tower was a plain drum of ashlar nearly two tiles
    # tall, which at this zoom is a silo.
    parts.append(geom.cylinder("ml_stage", (1.5, 1.5, 0.86), 0.94, 0.045, timber,
                               segments=16))
    # Brackets under the stage and a post-and-rail round it. The rail is rods,
    # not a second disc: a solid ring at head height turned the mill into a
    # lighthouse with two brims.
    rail = geom._Batch()
    for i in range(14):
        a = (i / 14) * math.tau
        px, py = 1.5 + math.cos(a) * 0.70, 1.5 + math.sin(a) * 0.70
        qx, qy = 1.5 + math.cos(a) * 0.92, 1.5 + math.sin(a) * 0.92
        rail.rod((px, py, 0.58), (qx, qy, 0.86), 0.028)
        rail.rod((qx, qy, 0.90), (qx, qy, 1.18), 0.024)
        b = ((i + 1) / 14) * math.tau
        rx, ry = 1.5 + math.cos(b) * 0.90, 1.5 + math.sin(b) * 0.90
        rail.rod((qx, qy, 1.15), (rx, ry, 1.15), 0.020)
    parts.append(rail.finish("ml_stage_rail", timber))
    # A shingled conical cap. Built as one cone with thin course rings laid on
    # it, NOT as a stack of cylinders -- stacked cylinders of falling radius are
    # a beehive, or a pile of pancakes, and that is exactly how the first
    # attempt read at a hundred and fifty pixels across.
    parts.append(geom.cone("ml_cap", (1.5, 1.5, 1.75), 0.82, 0.62, shingle, segments=16))
    courses = geom._Batch()
    for r in range(4):
        t = (r + 0.5) / 5.0
        rr = 0.82 * (1.0 - t) + 0.012
        courses.rod((1.5, 1.5, 1.75 + t * 0.62), (1.5, 1.5, 1.75 + t * 0.62 + 0.025),
                    rr, segments=16)
    parts.append(courses.finish("ml_courses", shingle))
    parts.append(geom.cone("ml_finial", (1.5, 1.5, 2.35), 0.09, 0.16, cap, segments=10))
    parts += geom.plank_door("ml_door", (1.28, 0.72, 0.0), 0.46, 0.64, timber, M.iron())
    for (wx, wy) in ((1.34, 0.80), (1.34, 2.14)):
        parts += geom.shuttered_window("ml_win", (wx, wy - 0.06, 1.28), 0.26, 0.26,
                                       M.iron(), timber)

    # Sails on the -Y face. The shaft points along -Y, so the arms live in the
    # XZ plane and must rotate about Y. The first version made them long in X
    # and rotated about X, which just spun each sail about its own axis and
    # rendered as a couple of stray sticks.
    #
    # The blades are open lattice now rather than solid boards: a common sail is
    # a frame of spars that cloth is spread over, and at this size the gaps
    # between the bars are what make it a windmill rather than four paddles.
    hub = (1.5, 0.62, 1.60)
    parts.append(geom.box("ml_shaft", (1.46, 0.50, 1.56), (0.08, 0.30, 0.08), timber))
    for i in range(4):
        a = (i / 4) * math.tau + math.pi / 4
        arm = geom.box(f"ml_arm_{i}", hub, (0.055, 0.05, 1.10), timber)
        arm.rotation_euler = (0.0, a, 0.0)
        parts.append(arm)

        lat = geom._Batch()
        # whip along the blade, with bars crossing it and cloth on one side
        for k in range(7):
            z = 0.34 + k * 0.105
            lat.box((-0.115, -0.012, z), (0.24, 0.024, 0.022))
        lat.box((-0.115, -0.012, 0.30), (0.030, 0.024, 0.78))
        lat.box((0.095, -0.012, 0.30), (0.030, 0.024, 0.78))
        frame = lat.finish(f"ml_lattice_{i}", timber,
                           (hub[0], hub[1], hub[2]))
        frame.rotation_euler = (0.0, a, 0.0)
        parts.append(frame)

        cloth = geom.box(f"ml_sail_{i}", (hub[0] - 0.112, hub[1] - 0.030, hub[2] + 0.32),
                         (0.11, 0.016, 0.52), sail)
        cloth.rotation_euler = (0.0, a, 0.0)
        parts.append(cloth)
    return geom.join(parts, "mill"), (3, 3)


def bakery():
    """Bakery: oven dome and chimney against a plastered workshop."""
    wall = M.plaster(tint=(0.93, 0.90, 0.82))
    brick = M.castle_stone()
    dark = M.timber(dark=True)

    shingle = M.shingle_wood()
    x, y, w, d, h = 0.20, 0.30, 1.55, 1.40, 0.86

    parts = []
    # A flagged apron: every workshop in the reference stands on paving, and it
    # is what stops the building looking dropped onto the grass.
    parts.append(geom.box("bk_apron", (x - 0.14, y - 0.16, 0.0),
                          (w + 0.30, d + 0.30, 0.045), M.flagstone("BakeryApron")))
    parts += geom.stone_footing("bk", (x, y, 0.045), (w, d, h),
                                M.rough_stone(), height=0.12)
    parts += geom.timber_frame("bk", (x, y, 0.045), (w, d, h), wall, dark,
                               bay=0.52)
    parts += geom.shingle_roof("bk", (x, y, h + 0.045), (w, d, 0.60), shingle,
                               overhang=0.20, ridge_mat=dark)
    parts += geom.rafters("bk", (x, y, 0.045), (w, d, h), dark, overhang=0.20)

    parts += geom.plank_door("bk_door", (x + 0.60, y - 0.07, 0.045),
                             0.42, 0.60, M.timber(), dark)
    parts += geom.shuttered_window("bk_win", (x + 1.10, y - 0.06, 0.42),
                                   0.30, 0.26, M.iron(), dark)
    # oven bulge and chimney
    parts.append(geom.cylinder("bk_oven", (1.80, 1.00, 0.0), 0.34, 0.62, brick, segments=12))
    parts.append(geom.cone("bk_ovencap", (1.80, 1.00, 0.62), 0.36, 0.26, brick, segments=12))
    parts.append(geom.box("bk_chimney", (1.70, 0.94, 0.86), (0.20, 0.20, 0.68), brick))
    parts.append(geom.box("bk_chimcap", (1.65, 0.89, 1.54), (0.30, 0.30, 0.07), brick))
    parts += geom.log_stack("bk_wood", (0.24, 1.56, 0.0), 6, 0.58, 0.055,
                            M.timber(), along='x')
    return geom.join(parts, "bakery"), (2, 2)


def apple_orchard():
    """Orchard: keeper's hut with fruit trees in rows."""
    wall = M.plaster(tint=(0.92, 0.89, 0.80))
    roof = M.thatch()
    bark = M.timber(dark=True)
    leaf = M.ground_grass(dark=False)
    fruit = M.cloth("Apple", colour=(0.58, 0.14, 0.10))

    parts = []
    parts += geom.timber_frame("ao", (0.20, 2.05, 0.0), (1.10, 0.80, 0.66),
                               wall, bark, bay=0.46, mid_rail=False)
    parts += geom.thatch_roof("ao", (0.20, 2.05, 0.66), (1.10, 0.80, 0.52),
                              roof, overhang=0.18, binder_mat=bark)
    parts += geom.crate("ao_crate", (1.44, 2.16, 0.0), (0.34, 0.30, 0.26),
                        M.timber())
    for i, (tx, ty) in enumerate(((0.70, 0.55), (1.75, 0.60), (0.75, 1.35),
                                  (1.80, 1.40), (2.45, 0.95))):
        parts.append(geom.box(f"ao_trunk_{i}", (tx, ty, 0.0), (0.10, 0.10, 0.42), bark))
        # rounded crowns: cones read as conifers, which is the wrong orchard
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.30,
                                              location=(tx + 0.05, ty + 0.05, 0.58))
        crown = bpy.context.active_object
        crown.name = f"ao_crown_{i}"
        crown.scale = (1.0, 1.0, 0.80)
        bpy.ops.object.transform_apply(scale=True)
        crown.data.materials.append(leaf)
        M.uv_cube_project(crown)
        parts.append(crown)
        parts.append(geom.box(f"ao_fruit_{i}", (tx - 0.02, ty + 0.16, 0.52),
                              (0.07, 0.07, 0.07), fruit))
    return geom.join(parts, "apple_orchard"), (3, 3)


def dairy_farm():
    """Dairy: byre, fenced paddock and a cow."""
    wall = M.plaster(tint=(0.92, 0.89, 0.81))
    roof = M.thatch()
    rail = M.timber()
    dark = M.timber(dark=True)
    hide = M.plaster("CowHide", tint=(0.72, 0.68, 0.60))

    parts = []
    parts += geom.stone_footing("df", (0.20, 1.95, 0.0), (1.45, 0.90, 0.72),
                                M.rough_stone(), height=0.10)
    parts += geom.timber_frame("df", (0.20, 1.95, 0.0), (1.45, 0.90, 0.72),
                               wall, dark, bay=0.48, mid_rail=False)
    parts += geom.thatch_roof("df", (0.20, 1.95, 0.72), (1.45, 0.90, 0.58),
                              roof, overhang=0.20, binder_mat=dark)
    parts.append(geom.arch_doorway("df_door", (0.78, 1.88, 0.0), 0.38, 0.50, 0.11, dark))
    parts += geom.barrel("df_churn", (1.78, 2.02, 0.0), 0.11, 0.28, rail, dark)

    # paddock fence along the front and sides
    for i in range(7):
        parts.append(geom.box(f"df_postA_{i}", (0.25 + i * 0.42, 0.22, 0.0),
                              (0.06, 0.06, 0.42), dark))
    parts.append(geom.box("df_railA", (0.25, 0.24, 0.28), (2.60, 0.04, 0.05), rail))
    for i in range(4):
        parts.append(geom.box(f"df_postB_{i}", (0.25, 0.22 + i * 0.45, 0.0),
                              (0.06, 0.06, 0.42), dark))
    parts.append(geom.box("df_railB", (0.27, 0.24, 0.28), (0.04, 1.55, 0.05), rail))

    parts += _ox("df_cow", (1.05, 0.85), hide, dark, rot_z=0.6)
    return geom.join(parts, "dairy_farm"), (3, 3)


REGISTRY.update({
    "quarry": quarry,
    "ox_tether": ox_tether,
    "iron_mine": iron_mine,
    "pitch_rig": pitch_rig,
    "market": market,
    "granary": granary,
    "wheat_farm": wheat_farm,
    "mill": mill,
    "bakery": bakery,
    "apple_orchard": apple_orchard,
    "dairy_farm": dairy_farm,
})


# ---------------------------------------------------------------------------
# Ale chain: hops -> brewery -> inn
# ---------------------------------------------------------------------------

def hops_farm():
    """Hop garden: cottage plus rows of climbing poles strung with vines."""
    wall = M.plaster(tint=(0.92, 0.89, 0.80))
    roof = M.thatch()
    pole = M.timber(dark=True)
    dark = M.iron()
    vine = M.ground_grass(dark=False)

    parts = []
    parts += geom.stone_footing("hf", (0.20, 1.95, 0.0), (1.40, 0.90, 0.74),
                                M.rough_stone(), height=0.10)
    parts += geom.timber_frame("hf", (0.20, 1.95, 0.0), (1.40, 0.90, 0.74),
                               wall, pole, bay=0.48, mid_rail=False)
    parts += geom.thatch_roof("hf", (0.20, 1.95, 0.74), (1.40, 0.90, 0.58),
                              roof, overhang=0.20, binder_mat=pole)
    parts.append(geom.arch_doorway("hf_door", (0.78, 1.88, 0.0), 0.38, 0.50, 0.11, dark))

    # Rows of hop poles with the bines grown up them.
    #
    # These were cones, and a cone of green on a stick is a fir tree -- the hop
    # garden read as a plantation of small conifers. A bine is a climber: it
    # spirals up the pole in a loose helix of leaf, so it is modelled as one.
    poles = geom._Batch()
    bines = geom._Batch()
    rnd = geom.rng_for("hops_farm_bines")
    for row in range(3):
        for col in range(4):
            px = 0.30 + col * 0.62
            py = 0.28 + row * 0.52
            poles.box((px, py, 0.0), (0.05, 0.05, 1.05))
            turns, leaves = 2.4, 9
            for i in range(leaves):
                t = 0.10 + (i / leaves) * 0.86
                a = t * turns * math.tau + rnd.random() * 0.4
                r = 0.075 + (1.0 - t) * 0.045
                lx = px + 0.025 + math.cos(a) * r
                ly = py + 0.025 + math.sin(a) * r
                sz = 0.075 * (0.7 + rnd.random() * 0.7)
                bines.slab((lx - sz / 2, ly - sz / 2, 1.05 * t),
                           (sz, 0.0, 0.0), (0.0, sz, 0.0), (0.0, 0.0, sz * 1.5))
    parts.append(poles.finish("hf_poles", pole))
    parts.append(bines.finish("hf_bines", vine))
    return geom.join(parts, "hops_farm"), (3, 3)


def brewery():
    """Brewery: stone-built with a vat, a chimney and barrels stacked outside."""
    stone = M.castle_stone()
    roof = M.thatch()
    timber_l = M.timber()
    timber_d = M.timber(dark=True)
    copper, nt, bsdf = M._new("Copper")
    M._set(bsdf, "Base Color", (0.55, 0.32, 0.16, 1.0))
    M._set(bsdf, "Metallic", 0.75)
    M._set(bsdf, "Roughness", 0.42)

    shingle = M.shingle_wood()
    parts = []
    parts.append(geom.box("bw_plinth", (0.09, 0.79, 0.0), (1.97, 1.67, 0.12), stone))
    parts.append(geom.box("bw_body", (0.15, 0.85, 0.10), (1.85, 1.55, 1.00), stone))
    parts += geom.shingle_roof("bw", (0.15, 0.85, 1.10), (1.85, 1.55, 0.66),
                               shingle, overhang=0.20, ridge_mat=timber_d)
    parts += geom.rafters("bw", (0.15, 0.85, 1.10), (1.85, 1.55, 0.0), timber_d,
                          overhang=0.20)
    parts += geom.plank_door("bw_door", (0.85, 0.77, 0.10), 0.48, 0.68,
                             timber_l, M.iron())
    parts += geom.shuttered_window("bw_win", (0.30, 0.78, 0.52), 0.28, 0.26,
                                   M.iron(), timber_d)
    parts.append(geom.box("bw_chimney", (1.62, 1.30, 1.10), (0.24, 0.24, 0.78), stone))
    parts.append(geom.box("bw_chimcap", (1.56, 1.24, 1.88), (0.36, 0.36, 0.08), stone))

    # the copper vat under a little lean-to
    parts.append(geom.cylinder("bw_vat", (2.35, 1.55, 0.0), 0.30, 0.46, copper, segments=14))
    parts.append(geom.cone("bw_vat_cap", (2.35, 1.55, 0.46), 0.32, 0.18, copper, segments=14))
    for sx, sy in ((2.05, 1.20), (2.68, 1.20), (2.05, 1.92), (2.68, 1.92)):
        parts.append(geom.box(f"bw_leanpost_{sx}_{sy}", (sx, sy, 0.0),
                              (0.07, 0.07, 0.86), timber_d))
    parts += geom.shingle_roof("bw_lean", (2.00, 1.14, 0.86), (0.78, 0.86, 0.24),
                               shingle, overhang=0.12, course=0.13,
                               ridge_mat=timber_d)

    # barrels waiting outside, properly coopered now rather than a cylinder
    # with a flat plate stuck round its waist
    for i, (bx, by) in enumerate(((0.35, 0.30), (0.80, 0.26), (1.25, 0.32))):
        parts += geom.barrel(f"bw_barrel_{i}", (bx, by, 0.0), 0.17, 0.36,
                             timber_l, M.iron())
    parts += geom.barrel("bw_barrel_up", (0.58, 0.62, 0.0), 0.17, 0.36,
                         timber_l, M.iron())
    return geom.join(parts, "brewery"), (3, 3)


def inn():
    """Inn: a long hall with a hanging sign, benches and a barrel by the door."""
    wall = M.plaster(tint=(0.93, 0.90, 0.82))
    roof = M.thatch()
    timber_l = M.timber()
    timber_d = M.timber(dark=True)
    sign = M.cloth("InnSign", colour=(0.52, 0.16, 0.12))

    parts = []
    parts += geom.stone_footing("in", (0.18, 0.95, 0.0), (2.60, 1.75, 1.10),
                                M.rough_stone(), height=0.14)
    # The inn is the one town building tall enough for two bands of framing,
    # so it gets a mid rail and a jettied upper storey overhanging the front.
    parts += geom.timber_frame("in", (0.18, 0.95, 0.0), (2.60, 1.75, 1.10),
                               wall, timber_d, bay=0.56, mid_rail=True)
    parts += geom.timber_frame("in_upper", (0.12, 0.86, 1.10),
                               (2.72, 1.86, 0.42), wall, timber_d,
                               bay=0.56, mid_rail=False, braces=False)
    parts += geom.thatch_roof("in", (0.12, 0.86, 1.52), (2.72, 1.86, 0.86),
                              roof, overhang=0.24, binder_mat=timber_d)
    parts += geom.plank_door("in_door", (1.30, 0.86, 0.0), 0.52, 0.74,
                             timber_l, M.iron())
    for wx in (0.42, 2.02):
        parts += geom.shuttered_window(f"in_win_{wx}", (wx, 0.88, 0.52),
                                       0.34, 0.30, M.iron(), timber_d)

    # hanging sign on a bracket
    parts.append(geom.box("in_bracket", (2.60, 0.80, 0.92), (0.42, 0.06, 0.06), timber_d))
    parts.append(geom.box("in_signpost", (2.94, 0.80, 0.52), (0.04, 0.04, 0.42), timber_d))
    parts.append(geom.box("in_sign", (2.78, 0.79, 0.50), (0.34, 0.03, 0.28), sign))

    # trestle benches and barrels outside the door
    for i, by in enumerate((0.34, 0.62)):
        parts.append(geom.box(f"in_bench_{i}", (0.45, by, 0.16), (1.10, 0.16, 0.06), timber_l))
        for lx in (0.48, 1.48):
            parts.append(geom.box(f"in_leg_{i}_{lx}", (lx, by + 0.02, 0.0),
                                  (0.05, 0.11, 0.17), timber_d))
    parts += geom.barrel("in_barrel", (2.25, 0.45, 0.0), 0.19, 0.40,
                         timber_l, M.iron())
    parts += geom.barrel("in_barrel2", (1.90, 0.32, 0.0), 0.16, 0.34,
                         timber_l, M.iron())
    return geom.join(parts, "inn"), (3, 3)


REGISTRY.update({
    "hops_farm": hops_farm,
    "brewery": brewery,
    "inn": inn,
})


# ---------------------------------------------------------------------------
# Meat chain: pig farm -> slaughterhouse
# ---------------------------------------------------------------------------

def _pig(name_prefix, origin, hide, dark, rot_z=0.0):
    """A pig. Rounder and lower than the ox, or it reads as a small cow."""
    ox, oy = origin
    body = geom._Batch()
    rings = ((0.00, 0.075), (0.25, 0.105), (0.66, 0.100), (0.88, 0.070),
             (1.00, 0.048))
    seg, prev = 8, None
    for (t, r) in rings:
        n0 = len(body.verts)
        for i in range(seg):
            a = (i / seg) * math.tau
            body.verts.append((0.04 + t * 0.40,
                               0.11 + math.cos(a) * r,
                               0.20 + math.sin(a) * r * 0.90))
        if prev is not None:
            for i in range(seg):
                j = (i + 1) % seg
                body.faces.append((prev + i, prev + j, n0 + j, n0 + i))
        prev = n0
    body.faces.append(tuple(range(seg - 1, -1, -1)))
    body.faces.append(tuple(range(prev, prev + seg)))
    # snout, rooting downward
    body.slab((0.43, 0.06, 0.17), (0.09, 0.0, -0.04),
              (0.0, 0.10, 0.0), (0.0, 0.0, 0.08))
    # ears
    body.slab((0.40, 0.03, 0.24), (0.05, 0.0, 0.04),
              (0.0, 0.03, 0.0), (0.0, 0.0, 0.06))
    body.slab((0.40, 0.16, 0.24), (0.05, 0.0, 0.04),
              (0.0, 0.03, 0.0), (0.0, 0.0, 0.06))
    at = (ox, oy, 0.0)
    parts = [body.finish(f"{name_prefix}_body", hide, at, rot_z)]

    legs = geom._Batch()
    for (lx, ly) in ((0.08, 0.02), (0.08, 0.15), (0.34, 0.02), (0.34, 0.15)):
        legs.rod((lx, ly + 0.02, 0.15), (lx, ly + 0.02, 0.0), 0.024, segments=6)
    parts.append(legs.finish(f"{name_prefix}_legs", dark, at, rot_z))
    return [p for p in parts if p is not None]


def pig_farm():
    """Pig farm: a sty, a muddy pen and pigs rooting about."""
    wall = M.plaster(tint=(0.91, 0.88, 0.79))
    roof = M.thatch()
    rail = M.timber()
    dark = M.timber(dark=True)
    hide = M.plaster("PigHide", tint=(0.72, 0.55, 0.52))
    mud = M.plaster("Mud", tint=(0.34, 0.26, 0.18))

    parts = []
    parts += geom.timber_frame("pf", (0.22, 2.00, 0.0), (1.30, 0.82, 0.62),
                               wall, dark, bay=0.44, mid_rail=False)
    parts += geom.thatch_roof("pf", (0.22, 2.00, 0.62), (1.30, 0.82, 0.50),
                              roof, overhang=0.18, binder_mat=dark)
    parts.append(geom.arch_doorway("pf_door", (0.72, 1.94, 0.0), 0.36, 0.44, 0.11, dark))

    # muddy pen floor
    parts.append(geom.box("pf_mud", (0.25, 0.28, 0.0), (2.45, 1.55, 0.03), mud))

    # fence round the pen
    for i in range(7):
        parts.append(geom.box(f"pf_postA_{i}", (0.25 + i * 0.40, 0.25, 0.0),
                              (0.06, 0.06, 0.40), dark))
    parts.append(geom.box("pf_railA", (0.25, 0.27, 0.26), (2.45, 0.04, 0.05), rail))
    for i in range(4):
        parts.append(geom.box(f"pf_postB_{i}", (0.25, 0.25 + i * 0.45, 0.0),
                              (0.06, 0.06, 0.40), dark))
    parts.append(geom.box("pf_railB", (0.27, 0.27, 0.26), (0.04, 1.50, 0.05), rail))

    # a trough and three pigs
    parts.append(geom.box("pf_trough", (1.85, 0.45, 0.0), (0.55, 0.20, 0.13), rail))
    parts += _pig("pf_pig0", (0.55, 0.55), hide, dark, rot_z=0.4)
    parts += _pig("pf_pig1", (1.25, 1.05), hide, dark, rot_z=2.3)
    parts += _pig("pf_pig2", (0.70, 1.35), hide, dark, rot_z=-0.9)
    return geom.join(parts, "pig_farm"), (3, 3)


def slaughterhouse():
    """Slaughterhouse: block, cleaver, barrels and sides of meat on hooks."""
    wall = M.plaster(tint=(0.92, 0.89, 0.81))
    stone = M.castle_stone()
    timber_l = M.timber()
    timber_d = M.timber(dark=True)
    iron = M.iron()
    meat = M.cloth("Meat", colour=(0.52, 0.20, 0.18))

    shingle = M.shingle_wood()
    parts = []
    parts.append(geom.box("sl_plinth", (0.14, 0.91, 0.0), (1.83, 1.38, 0.10), stone))
    parts += geom.timber_frame("sl", (0.18, 0.95, 0.08), (1.75, 1.30, 0.94),
                               wall, timber_d, bay=0.54)
    parts += geom.shingle_roof("sl", (0.18, 0.95, 1.02), (1.75, 1.30, 0.62),
                               shingle, overhang=0.19, ridge_mat=timber_d)
    parts += geom.rafters("sl", (0.18, 0.95, 1.02), (1.75, 1.30, 0.0), timber_d,
                          overhang=0.19)
    parts += geom.plank_door("sl_door", (0.82, 0.87, 0.08), 0.46, 0.64,
                             timber_l, iron)

    # open-fronted working area with a rail of hanging meat
    for sx in (0.30, 1.72):
        parts.append(geom.box(f"sl_post_{sx}", (sx, 0.30, 0.0), (0.09, 0.09, 1.00), timber_d))
    parts.append(geom.box("sl_rail", (0.28, 0.32, 0.94), (1.55, 0.06, 0.06), timber_d))
    for i in range(3):
        parts.append(geom.box(f"sl_hook_{i}", (0.52 + i * 0.44, 0.33, 0.80),
                              (0.03, 0.03, 0.14), iron))
        parts.append(geom.box(f"sl_side_{i}", (0.45 + i * 0.44, 0.29, 0.42),
                              (0.18, 0.11, 0.40), meat))

    # chopping block with a cleaver
    parts.append(geom.cylinder("sl_block", (1.30, 0.62, 0.0), 0.22, 0.34, timber_l, segments=12))
    parts.append(geom.box("sl_cleaver", (1.24, 0.58, 0.34), (0.16, 0.03, 0.11), iron))
    parts += geom.barrel("sl_barrel", (0.42, 0.66, 0.0), 0.17, 0.36, timber_l, iron)
    return geom.join(parts, "slaughterhouse"), (2, 2)


def hunter():
    """
    Hunter's hut: a lean-to, a drying rack of hides, and a rack of horns.

    Reads as the wild end of the food chain rather than another farm building --
    no plaster, no thatch, just poles and skins.
    """
    timber_l = M.timber()
    timber_d = M.timber(dark=True)
    hide = M.cloth("StretchedHide", colour=(0.62, 0.47, 0.30))
    pale = M.cloth("HunterHorn", colour=(0.20, 0.17, 0.13))
    stone = M.rough_stone("HunterStone")

    parts = []
    # lean-to: a low back wall and a single sloped roof on poles
    parts.append(geom.box("hu_plinth", (0.10, 0.86, 0.0), (1.30, 1.02, 0.08), stone))
    parts.append(geom.box("hu_back", (0.14, 1.72, 0.08), (1.22, 0.12, 0.74), timber_d))
    for i, sx in enumerate((0.18, 1.24)):
        parts.append(geom.box(f"hu_post_{i}", (sx, 0.92, 0.08), (0.10, 0.10, 0.52), timber_d))
    # roof slopes from the tall back wall down to the short front posts
    for i in range(7):
        y = 0.90 + i * 0.135
        z = 0.60 + i * 0.038
        parts.append(geom.box(f"hu_roof_{i}", (0.10, y, z), (1.30, 0.15, 0.05), timber_l))
    # walls of stacked poles on one side only, so the front stays open
    for i in range(5):
        parts.append(geom.box(f"hu_wall_{i}", (0.14, 1.10, 0.10 + i * 0.14),
                              (0.09, 0.66, 0.11), timber_l))

    # drying rack out front with two hides stretched on it
    for i, sx in enumerate((0.22, 1.28)):
        parts.append(geom.box(f"hu_rpost_{i}", (sx, 0.18, 0.0), (0.07, 0.07, 0.80), timber_d))
    parts.append(geom.box("hu_rail", (0.20, 0.20, 0.74), (1.14, 0.05, 0.05), timber_d))
    for i in range(2):
        parts.append(geom.box(f"hu_hide_{i}", (0.34 + i * 0.50, 0.17, 0.30),
                              (0.40, 0.02, 0.44), hide))

    # a pair of horns nailed up on the back wall
    for i, sx in enumerate((0.62, 0.80)):
        parts.append(geom.box(f"hu_horn_{i}", (sx, 1.70, 0.62), (0.035, 0.04, 0.24), pale))

    parts.append(geom.cylinder("hu_barrel", (1.10, 0.55, 0.0), 0.16, 0.32, timber_l, segments=10))
    return geom.join(parts, "hunter"), (2, 2)


# --- fortifications --------------------------------------------------------

def wall():
    """
    One tile of curtain wall.

    Crenellated on all four sides rather than along its length. A 1x1 segment
    has no idea which way the run goes -- it is placed tile by tile and the
    player may turn a corner anywhere -- so merlons that only ran one way would
    be wrong on half the wall. Where two segments abut, the joint merlons
    interpenetrate, which at 45 px per tile reads as a continuous battlement.
    """
    stone = M.castle_stone()
    rough = M.rough_stone("WallFooting")
    parts = []
    h = 0.92
    parts.append(geom.box("wl_body", (0.0, 0.0, 0.0), (1.0, 1.0, h), stone))
    # a slight batter at the foot, so a long run is not a flat slab
    parts.append(geom.box("wl_foot", (-0.03, -0.03, 0.0), (1.06, 1.06, 0.14), stone))
    # Undressed rubble at the very base. A run of wall meets the ground along
    # one dead-straight line for its whole length, and at three times tile
    # scale that line is the most artificial thing on the map.
    parts += geom.stone_footing("wl", (-0.03, -0.03, 0.0), (1.06, 1.06, h), rough,
                                height=0.10, block=0.22, proud=0.035)
    # A string course under the parapet, and a flagged walkway on top: the two
    # places a wall reads as something men stand on rather than a extruded box.
    parts.append(geom.box("wl_string", (-0.045, -0.045, h - 0.13),
                          (1.09, 1.09, 0.06), stone))
    parts.append(geom.box("wl_walk", (0.14, 0.14, h),
                          (0.72, 0.72, 0.03), M.flagstone("WallWalk")))
    parts += geom.crenellate("wl_cr", (0.0, 0.0), 1.0, 1.0, stone,
                             merlon=0.24, gap=0.18, height=0.20, thickness=0.14, z=h)
    return geom.join(parts, "wall"), (1, 1)


def tower():
    """Square tower, head and shoulders above the curtain so it reads as a tower."""
    stone = M.castle_stone()
    rough = M.rough_stone("TowerFooting")
    parts = []
    h = 1.55
    parts.append(geom.box("tw_plinth", (-0.06, -0.06, 0.0), (2.12, 2.12, 0.18), rough))
    parts.append(geom.box("tw_body", (0.0, 0.0, 0.0), (2.0, 2.0, h), stone))
    # string course, to break up two units of blank wall
    parts.append(geom.box("tw_band", (-0.05, -0.05, h - 0.42), (2.10, 2.10, 0.09), stone))
    parts.append(geom.box("tw_deck", (-0.09, -0.09, h), (2.18, 2.18, 0.10), stone))
    # Corbels carrying the projecting deck. The deck already oversails the wall
    # by nine hundredths of a tile and used to do it on nothing at all, which
    # at this zoom looks like a shelf floating off a cliff.
    corbels = geom._Batch()
    n = 7
    for i in range(n):
        t = 0.06 + (i / (n - 1)) * 1.88
        for (cx, cy, cw, cd) in ((t, -0.09, 0.11, 0.10), (t, 2.0, 0.11, 0.10),
                                 (-0.09, t, 0.10, 0.11), (2.0, t, 0.10, 0.11)):
            corbels.box((cx, cy, h - 0.11), (cw, cd, 0.12))
    parts.append(corbels.finish("tw_corbels", stone))
    parts.append(geom.box("tw_walk", (0.06, 0.06, h + 0.10),
                          (1.88, 1.88, 0.03), M.flagstone("TowerWalk")))
    parts += geom.crenellate("tw_cr", (-0.09, -0.09), 2.18, 2.18, stone,
                             merlon=0.26, gap=0.20, height=0.26, thickness=0.16, z=h + 0.10)
    # arrow slits on each face
    for i, (x, y, w, d) in enumerate([
        (0.92, -0.01, 0.16, 0.06), (0.92, 1.95, 0.16, 0.06),
        (-0.01, 0.92, 0.06, 0.16), (1.95, 0.92, 0.06, 0.16),
    ]):
        parts.append(geom.box(f"tw_slit_{i}", (x, y, 0.78), (w, d, 0.34),
                              M.timber("SlitDark", dark=True)))
    return geom.join(parts, "tower"), (2, 2)


def gatehouse():
    """
    Gate tower with an arch on every face.

    Buildings in this game do not rotate -- only the camera does -- so a gate
    with a single fixed passage would be unusable on three sides of a castle.
    Opening all four faces makes it correct from any approach, and a gate tower
    pierced both ways is a real enough thing to look deliberate.
    """
    stone = M.castle_stone()
    rough = M.rough_stone("GateFooting")
    timber_d = M.timber("GateTimber", dark=True)
    parts = []
    h = 1.30

    parts.append(geom.box("gh_plinth", (-0.06, -0.06, 0.0), (2.12, 2.12, 0.16), rough))
    # four corner piers with the passage crossing between them
    for i, (x, y) in enumerate([(0.0, 0.0), (1.32, 0.0), (0.0, 1.32), (1.32, 1.32)]):
        parts.append(geom.box(f"gh_pier_{i}", (x, y, 0.0), (0.68, 0.68, h), stone))
    # lintel band tying the piers together above the openings
    parts.append(geom.box("gh_lintel", (0.0, 0.0, h - 0.30), (2.0, 2.0, 0.30), stone))
    parts.append(geom.box("gh_deck", (-0.10, -0.10, h), (2.20, 2.20, 0.11), stone))
    parts += geom.crenellate("gh_cr", (-0.10, -0.10), 2.20, 2.20, stone,
                             merlon=0.26, gap=0.20, height=0.24, thickness=0.16, z=h + 0.11)
    # Portcullis grilles set back in each opening, with real bars rather than a
    # solid slab -- a portcullis you cannot see through is just a lintel.
    steel = M.iron()
    bars = geom._Batch()
    for i in range(2):
        y = 0.62 + i * 0.74
        for k in range(5):
            u = 0.68 + k * 0.155
            bars.box((u, y, 0.62), (0.035, 0.05, 0.40))
            bars.box((y, u, 0.62), (0.05, 0.035, 0.40))
        for z in (0.66, 0.94):
            bars.box((0.66, y, z), (0.68, 0.05, 0.035))
            bars.box((y, 0.66, z), (0.05, 0.68, 0.035))
    parts.append(bars.finish("gh_grille", steel))
    # Arch rings over each opening, so the passage is an arch and not a gap
    # between two piers.
    rings = geom._Batch()
    for i in range(2):
        y = 0.62 + i * 0.74
        rings.box((0.62, y - 0.10, 0.98), (0.76, 0.20, 0.10))
        rings.box((y - 0.10, 0.62, 0.98), (0.20, 0.76, 0.10))
    parts.append(rings.finish("gh_arch", stone))
    return geom.join(parts, "gatehouse"), (2, 2)


def barracks():
    """Barracks: hall, weapon racks and a pell for practice, behind a low wall."""
    stone = M.castle_stone()
    rough = M.rough_stone("BarracksFooting")
    roof = M.shingle_wood("BarracksRoof")
    timber_l = M.timber()
    timber_d = M.timber(dark=True)
    steel = M.iron()
    banner = M.cloth("BarracksBanner", colour=(0.58, 0.14, 0.12))

    parts = []
    parts.append(geom.box("ba_plinth", (0.08, 1.28, 0.0), (2.84, 1.64, 0.12), rough))
    parts.append(geom.box("ba_hall", (0.14, 1.34, 0.0), (2.72, 1.52, 1.02), stone))
    parts += geom.shingle_roof("ba", (0.14, 1.34, 1.02), (2.72, 1.52, 0.68),
                               roof, overhang=0.20, ridge_mat=timber_d)
    parts += geom.rafters("ba", (0.14, 1.34, 1.02), (2.72, 1.52, 0.0), timber_d,
                          overhang=0.20)
    parts.append(geom.arch_doorway("ba_door", (1.28, 1.26, 0.0), 0.50, 0.70, 0.12, timber_d))

    # low wall enclosing the training yard at the front
    for i, (x, y, w, d) in enumerate([
        (0.08, 0.10, 2.84, 0.10), (0.08, 0.10, 0.10, 1.20), (2.82, 0.10, 0.10, 1.20),
    ]):
        parts.append(geom.box(f"ba_yard_{i}", (x, y, 0.0), (w, d, 0.30), stone))

    # pell -- the practice post, scarred with a couple of hoops
    parts.append(geom.cylinder("ba_pell", (0.80, 0.72, 0.0), 0.10, 0.86, timber_d, segments=10))
    for i, z in enumerate((0.34, 0.62)):
        parts.append(geom.cylinder(f"ba_pellband_{i}", (0.80, 0.72, z), 0.115, 0.05,
                                   steel, segments=10))

    # weapon rack with spears standing in it
    parts.append(geom.box("ba_rack", (1.70, 0.44, 0.0), (1.00, 0.14, 0.20), timber_l))
    parts.append(geom.box("ba_rackbar", (1.70, 0.46, 0.62), (1.00, 0.06, 0.06), timber_l))
    for i in range(5):
        x = 1.78 + i * 0.21
        parts.append(geom.cylinder(f"ba_spear_{i}", (x, 0.50, 0.10), 0.022, 0.86,
                                   timber_d, segments=6))
        parts.append(geom.cone(f"ba_tip_{i}", (x, 0.50, 0.96), 0.038, 0.13, steel))

    # banner on the hall front
    parts.append(geom.box("ba_pole", (0.42, 1.24, 0.0), (0.07, 0.07, 1.60), timber_d))
    parts.append(geom.box("ba_flag", (0.49, 1.25, 1.06), (0.42, 0.03, 0.44), banner))
    return geom.join(parts, "barracks"), (3, 3)


def _upright_wheel(name, centre, radius, width, mat, segments=12):
    """A wheel standing on its rim, axle along X."""
    o = geom.cylinder(name, (0.0, 0.0, 0.0), radius, width, mat, segments=segments)
    o.rotation_euler = (0.0, math.pi / 2.0, 0.0)
    cx, cy, cz = centre
    o.location = (cx - width / 2.0, cy, cz)
    return o


def _beam_y(name, centre, length, radius, mat, segments=8):
    """A log lying along Y, centred on `centre`."""
    o = geom.cylinder(name, (0.0, 0.0, 0.0), radius, length, mat, segments=segments)
    o.rotation_euler = (-math.pi / 2.0, 0.0, 0.0)
    cx, cy, cz = centre
    o.location = (cx, cy + length / 2.0, cz)
    return o


def siege_camp():
    """Siege camp: an open workshop yard where rams and catapults are built.

    Open on three sides on purpose. A closed shed reads as one more barn at
    this size, and the point of the building is that you can see a machine
    on the stocks.
    """
    rough = M.rough_stone("SiegeFooting")
    timber_l = M.timber("SiegeTimber")
    timber_d = M.timber("SiegeTimberDark", dark=True)
    roof = M.shingle_wood("SiegeRoof")
    steel = M.iron()
    shot = M.castle_stone()

    parts = []

    # trampled working yard
    parts.append(geom.box("sc_yard", (0.06, 0.06, 0.0), (2.88, 2.88, 0.06), rough))

    # open shelter across the back: posts, wall plates and a pitched roof
    for i, x in enumerate((0.26, 1.46, 2.66)):
        for j, y in enumerate((1.74, 2.76)):
            parts.append(geom.box(f"sc_post_{i}_{j}", (x - 0.07, y - 0.07, 0.06),
                                  (0.14, 0.14, 0.94), timber_d))
    parts.append(geom.box("sc_plate_f", (0.12, 1.67, 1.00), (2.72, 0.14, 0.10), timber_d))
    parts.append(geom.box("sc_plate_b", (0.12, 2.69, 1.00), (2.72, 0.14, 0.10), timber_d))
    parts += geom.shingle_roof("sc", (0.12, 1.67, 1.10), (2.72, 1.16, 0.50),
                               roof, overhang=0.19, ridge_mat=timber_d)
    parts += geom.rafters("sc", (0.12, 1.67, 1.10), (2.72, 1.16, 0.0), timber_d,
                          overhang=0.19)
    # planked back wall, so the shelter has a mass to read against
    for i in range(5):
        parts.append(geom.box(f"sc_plank_{i}", (0.14, 2.78, 0.10 + i * 0.19),
                              (2.68, 0.06, 0.16), timber_l))

    # timber stock under the shelter, cut to length and stacked
    for i in range(3):
        parts.append(_beam_y(f"sc_log_{i}", (0.52 + i * 0.15, 1.92, 0.14), 0.86, 0.065, timber_l))
    for i in range(2):
        parts.append(_beam_y(f"sc_log2_{i}", (0.60 + i * 0.15, 1.96, 0.27), 0.86, 0.065, timber_d))

    # workbench with a hewn beam clamped on it
    parts.append(geom.box("sc_bench", (1.86, 2.14, 0.06), (0.92, 0.34, 0.52), timber_d))
    parts.append(geom.box("sc_benchtop", (1.80, 2.08, 0.58), (1.04, 0.46, 0.07), timber_l))
    parts.append(geom.box("sc_workpiece", (1.92, 2.18, 0.65), (0.72, 0.16, 0.11), timber_l))
    parts.append(geom.box("sc_saw", (2.40, 2.02, 0.65), (0.05, 0.44, 0.14), steel))

    # a catapult on the stocks, arm cocked back -- the machine being built
    cx, cy = 0.92, 0.72
    parts.append(geom.box("sc_cat_deck", (cx - 0.30, cy - 0.48, 0.22), (0.60, 0.96, 0.08), timber_d))
    for i, (sx, sy) in enumerate([(-1, -1), (1, -1), (-1, 1), (1, 1)]):
        parts.append(_upright_wheel(f"sc_cat_wheel_{i}",
                                    (cx + sx * 0.33, cy + sy * 0.31, 0.19),
                                    0.19, 0.07, timber_d))
        parts.append(_upright_wheel(f"sc_cat_hub_{i}",
                                    (cx + sx * 0.33, cy + sy * 0.31, 0.19),
                                    0.055, 0.08, steel, segments=8))
    # A-frame the throwing arm swings in
    for i, sx in enumerate((-1, 1)):
        parts.append(geom.box(f"sc_cat_leg_{i}", (cx + sx * 0.22 - 0.05, cy - 0.06, 0.30),
                              (0.10, 0.10, 0.54), timber_d))
    parts.append(geom.box("sc_cat_axle", (cx - 0.34, cy - 0.04, 0.82), (0.68, 0.07, 0.07), steel))
    arm = geom.box("sc_cat_arm", (cx - 0.05, cy - 0.02, 0.84), (0.10, 1.02, 0.09), timber_l)
    arm.rotation_euler = (0.62, 0.0, 0.0)
    parts.append(arm)
    bucket = geom.box("sc_cat_bucket", (cx - 0.11, cy + 0.92, 0.86), (0.22, 0.20, 0.16), timber_d)
    bucket.rotation_euler = (0.62, 0.0, 0.0)
    parts.append(bucket)

    # sawing trestle with a beam across it, front right
    for i, y in enumerate((0.42, 1.06)):
        parts.append(geom.box(f"sc_trestle_{i}", (2.06, y - 0.06, 0.06), (0.52, 0.12, 0.40), timber_d))
        parts.append(geom.box(f"sc_trestle_x{i}", (2.16, y - 0.05, 0.20), (0.32, 0.10, 0.08), timber_d))
    parts.append(_beam_y("sc_trestle_beam", (2.32, 0.30, 0.50), 0.94, 0.085, timber_l))

    # stone shot, stacked where the crew can reach it
    for i, (dx, dy, dz) in enumerate([(0.0, 0.0, 0.0), (0.24, 0.05, 0.0), (0.12, 0.26, 0.0),
                                      (0.12, 0.10, 0.19)]):
        parts.append(geom.cylinder(f"sc_shot_{i}", (2.52 + dx, 1.44 + dy, 0.06 + dz),
                                   0.115, 0.19, shot, segments=8))

    return geom.join(parts, "siege_camp"), (3, 3)


def fishery():
    """
    Fisherman's hut: a hut on the bank with a jetty running out from it.

    The jetty is the whole point of the silhouette. A 2x2 hut on a shore is
    otherwise the same shape as a hovel, and the player needs to see at a
    glance which of the two small buildings by the water is the one making
    food. Nets on a drying frame do the rest.
    """
    plaster = M.plaster()
    roof = M.thatch()
    timber_l = M.timber("FishTimber")
    timber_d = M.timber("FishTimberDark", dark=True)
    net = M.cloth("FishNet", colour=(0.58, 0.55, 0.42))

    parts = []
    parts += geom.timber_frame("fh", (0.12, 0.98, 0.0), (1.06, 0.88, 0.64),
                               plaster, timber_d, bay=0.44, mid_rail=False)
    parts += geom.thatch_roof("fh", (0.12, 0.98, 0.64), (1.06, 0.88, 0.50),
                              roof, overhang=0.17, binder_mat=timber_d)
    parts.append(geom.box("fh_door", (0.52, 0.92, 0.0), (0.26, 0.08, 0.42), timber_d))

    # jetty running out toward the water, on posts
    parts.append(geom.box("fh_jetty", (0.62, 0.06, 0.20), (0.46, 0.94, 0.06), timber_l))
    for i, y in enumerate((0.14, 0.50, 0.86)):
        for j, x in enumerate((0.66, 1.02)):
            parts.append(geom.cylinder(f"fh_post_{i}_{j}", (x, y, 0.0), 0.038, 0.22,
                                       timber_d, segments=6))

    # drying frame with a net slung on it
    for i, x in enumerate((0.14, 0.52)):
        parts.append(geom.cylinder(f"fh_frame_{i}", (x, 0.60, 0.0), 0.032, 0.56,
                                   timber_d, segments=6))
    parts.append(geom.cylinder("fh_bar", (0.14, 0.60, 0.54), 0.028, 0.40, timber_d,
                               segments=6))
    parts[-1].rotation_euler = (0.0, math.pi / 2.0, 0.0)
    parts.append(geom.box("fh_net", (0.15, 0.58, 0.18), (0.36, 0.04, 0.36), net))

    # a couple of creels by the door
    for i, (x, y) in enumerate(((0.24, 0.86), (0.40, 0.80))):
        parts.append(geom.cylinder(f"fh_creel_{i}", (x, y, 0.0), 0.085, 0.13,
                                   timber_l, segments=8))
    return geom.join(parts, "fishery"), (2, 2)


def depot():
    """
    Storehouse: an open-fronted shed with goods stacked under it.

    Open at the front on purpose. Every other 2x2 in the game is a closed hut,
    and the one thing the player needs to read here is that this is a place
    things are PUT -- so the load is visible from the road, and a barrow stands
    outside it.
    """
    plaster = M.plaster(tint=(0.92, 0.89, 0.80))
    roof = M.shingle_wood("DepotRoof")
    timber_l = M.timber("DepotTimber")
    timber_d = M.timber("DepotTimberDark", dark=True)
    sack = M.cloth("DepotSack", colour=(0.58, 0.52, 0.36))
    stone = M.rough_stone("DepotFooting")

    parts = []
    parts.append(geom.box("dp_pad", (0.06, 0.06, 0.0), (1.88, 1.88, 0.08), stone))
    # back and side walls; the front stands on posts
    parts.append(geom.box("dp_back", (0.10, 1.62, 0.08), (1.80, 0.24, 0.86), plaster))
    parts.append(geom.box("dp_left", (0.10, 0.72, 0.08), (0.22, 0.92, 0.80), plaster))
    for i, x in enumerate((1.62, 1.62)):
        parts.append(geom.box(f"dp_post_{i}", (x, 0.30 + i * 0.0, 0.08), (0.16, 0.16, 0.86),
                              timber_d))
    parts.append(geom.box("dp_post_l", (0.16, 0.30, 0.08), (0.16, 0.16, 0.86), timber_d))
    parts.append(geom.box("dp_lintel", (0.10, 0.28, 0.94), (1.80, 0.20, 0.12), timber_d))
    parts += geom.shingle_roof("dp", (0.10, 0.28, 1.02), (1.80, 1.58, 0.58),
                               roof, overhang=0.21, ridge_mat=timber_d)
    parts += geom.rafters("dp", (0.10, 0.28, 1.02), (1.80, 1.58, 0.0), timber_d,
                          overhang=0.21)

    # the load: crates and sacks under the open front
    for i, (x, y, w_, d_, h) in enumerate([
        (0.34, 0.60, 0.40, 0.36, 0.34), (0.80, 0.56, 0.34, 0.32, 0.28),
        (0.36, 1.02, 0.36, 0.34, 0.26), (1.16, 0.62, 0.36, 0.34, 0.30),
    ]):
        parts.append(geom.box(f"dp_crate_{i}", (x, y, 0.08), (w_, d_, h), timber_l,
                              rot_z=0.10 * (i % 3)))
    for i, (x, y) in enumerate(((0.86, 1.04), (1.20, 1.06))):
        parts.append(geom.cylinder(f"dp_sack_{i}", (x, y, 0.08), 0.15, 0.30, sack,
                                   segments=8))

    # a barrow outside, so it reads as a place things move through
    parts.append(geom.box("dp_barrow", (1.30, 0.10, 0.16), (0.44, 0.30, 0.14), timber_l))
    parts.append(geom.cylinder("dp_wheel", (1.34, 0.10, 0.10), 0.10, 0.05, timber_d,
                               segments=10))
    parts[-1].rotation_euler = (0.0, math.pi / 2.0, 0.0)
    return geom.join(parts, "depot"), (2, 2)



def church():
    """A small domed chapel: an octagonal stone drum under a pale cupola, a
    lantern and finial on top, an arched door and tall window niches. Replaces
    the old spired parish church with the round-domed shrine Thomas asked for."""
    stone = M.castle_stone()
    rough = M.rough_stone("ChapelFooting")
    pale = M.plaster(tint=(0.87, 0.84, 0.76))     # the cupola: light lead/plaster
    trim = M.plaster(tint=(0.80, 0.77, 0.70))
    dark = M.timber("ChapelDoor", dark=True)      # recessed door / window shadow
    iron = M.iron()

    cx, cy = 0.96, 0.96
    A = math.pi / 8.0        # turn the octagon so a flat face points each way
    parts = []
    # stepped stone base
    parts.append(geom.box("cp_plinth", (0.06, 0.06, 0.0), (1.80, 1.80, 0.12), rough))
    parts.append(geom.box("cp_step", (0.20, 0.20, 0.12), (1.52, 1.52, 0.08), stone))
    # octagonal drum, its cornice, and the pale cupola
    parts.append(geom.cylinder("cp_drum", (cx, cy, 0.20), 0.74, 0.90, stone,
                               segments=8, angle0=A))
    parts.append(geom.cylinder("cp_cornice", (cx, cy, 1.06), 0.80, 0.10, trim,
                               segments=8, angle0=A))
    parts.append(geom.dome("cp_dome", (cx, cy, 1.16), 0.74, 0.60, pale))
    # a little lantern with its own cupola and a finial
    parts.append(geom.cylinder("cp_lantern", (cx, cy, 1.70), 0.15, 0.18, stone, segments=8))
    parts.append(geom.dome("cp_lantern_top", (cx, cy, 1.88), 0.15, 0.13, pale))
    parts.append(geom.cylinder("cp_finial", (cx, cy, 2.01), 0.028, 0.14, iron, segments=6))
    parts.append(geom.box("cp_ball", (cx - 0.05, cy - 0.05, 2.11), (0.10, 0.10, 0.10), iron))
    # arched door on the front (-Y) face, with boards and a ring handle in it
    parts.append(geom.arch_doorway("cp_door", (cx - 0.22, 0.14, 0.20), 0.44, 0.64, 0.16, dark))
    parts += geom.plank_door("cp_leaf", (cx - 0.18, 0.10, 0.20), 0.36, 0.46,
                             M.timber("ChapelLeaf"), iron, planks=3)
    # tall window niches on the other faces, so the side rotations aren't blank,
    # each in a stone surround -- an unframed dark rectangle in an ashlar wall
    # reads as a hole punched in it, not a window
    for (nm, wx, wy, ww, wd) in (("e", 1.60, cy - 0.15, 0.06, 0.30),
                                 ("w", 0.28, cy - 0.15, 0.06, 0.30),
                                 ("n", cx - 0.15, 1.60, 0.30, 0.06)):
        parts.append(geom.box(f"cp_win_{nm}", (wx, wy, 0.60), (ww, wd, 0.42), dark))
        parts.append(geom.box(f"cp_sill_{nm}", (wx - 0.03, wy - 0.05, 0.55),
                              (ww + 0.06, wd + 0.10, 0.05), trim))
        parts.append(geom.box(f"cp_head_{nm}", (wx - 0.03, wy - 0.05, 1.02),
                              (ww + 0.06, wd + 0.10, 0.05), trim))
    # steps up to the door
    for i in range(2):
        parts.append(geom.box(f"cp_step_{i}", (cx - 0.42 - i * 0.06, 0.02 - i * 0.11, 0.0),
                              (0.84 + i * 0.12, 0.14, 0.20 - i * 0.08), stone))
    return geom.join(parts, "church"), (2, 2)


def pharmacy():
    """A flat-roofed apothecary: a stone block with a rooftop terrace of potted
    herbs under an awning, stacked crates and a small upper room. The town's
    second wellbeing building -- it tends the body as the chapel tends the soul.
    Modelled from Thomas's reference of a herb-drying rooftop house."""
    stone = M.castle_stone()
    rough = M.rough_stone("PharmaFooting")
    terra = M.plaster("PharmaPot", tint=(0.72, 0.42, 0.30))       # terracotta pots
    canvas = M.cloth("PharmaCanvas", colour=(0.90, 0.87, 0.78))   # off-white awning
    leaf = M.cloth("PharmaLeaf", colour=(0.28, 0.46, 0.20))
    leaf2 = M.cloth("PharmaLeaf2", colour=(0.42, 0.56, 0.26))
    timber_l = M.timber("PharmaTimber")
    dark = M.timber("PharmaDark", dark=True)                      # door/window shadow

    parts = []
    # footing and the main stone block
    parts.append(geom.box("ph_plinth", (0.05, 0.05, 0.0), (1.84, 1.84, 0.10), rough))
    parts.append(geom.box("ph_block", (0.14, 0.14, 0.10), (1.62, 1.62, 0.90), stone))
    # the flat roof terrace, walled by a low parapet (taller at the back)
    parts.append(geom.box("ph_deck", (0.16, 0.16, 0.98), (1.58, 1.58, 0.05), M.flagstone()))
    parts.append(geom.box("ph_par_f", (0.14, 0.14, 1.00), (1.62, 0.12, 0.18), stone))
    parts.append(geom.box("ph_par_b", (0.14, 1.64, 1.00), (1.62, 0.12, 0.30), stone))
    parts.append(geom.box("ph_par_l", (0.14, 0.14, 1.00), (0.12, 1.62, 0.24), stone))
    parts.append(geom.box("ph_par_r", (1.64, 0.14, 1.00), (0.12, 1.62, 0.24), stone))
    # a small upper room at the back-left, capped in timber
    parts.append(geom.box("ph_upper", (0.22, 1.06, 1.00), (0.64, 0.70, 0.66), stone))
    parts.append(geom.box("ph_upcap", (0.18, 1.02, 1.66), (0.72, 0.78, 0.06), timber_l))
    # crates stacked on the roof, back-right
    parts.append(geom.box("ph_crate0", (1.16, 1.14, 1.04), (0.36, 0.36, 0.32), timber_l))
    parts.append(geom.box("ph_crate1", (1.20, 1.18, 1.36), (0.30, 0.30, 0.26), timber_l))
    parts.append(geom.box("ph_crate2", (1.44, 1.14, 1.04), (0.20, 0.30, 0.22), dark))
    # an awning over the front-right terrace on four posts
    for i, (px, py) in enumerate([(0.34, 0.30), (1.02, 0.30), (0.34, 0.90), (1.02, 0.90)]):
        parts.append(geom.box(f"ph_post_{i}", (px, py, 1.04), (0.05, 0.05, 0.42), timber_l))
    parts.append(geom.box("ph_awn", (0.26, 0.22, 1.44), (0.86, 0.80, 0.05), canvas))
    # potted herbs on the terrace, set to peek over the low front parapet
    for i, (px, py) in enumerate([(0.30, 0.30), (0.60, 0.26), (1.30, 0.30)]):
        parts.append(geom.cylinder(f"ph_pot_{i}", (px, py, 1.02), 0.10, 0.16, terra, segments=10))
        parts.append(props.blob(f"ph_herb_{i}", (px, py, 1.22), 0.15,
                                leaf if i % 2 else leaf2, squash=0.7))
    # ground floor: arched door, window niches, and a little shade over the door
    parts.append(geom.arch_doorway("ph_door", (0.72, 0.06, 0.10), 0.42, 0.58, 0.14, dark))
    parts.append(geom.box("ph_win0", (0.22, 0.42, 0.44), (0.05, 0.30, 0.34), dark))
    parts.append(geom.box("ph_win1", (1.68, 0.60, 0.44), (0.05, 0.30, 0.34), dark))
    for i, px in enumerate((0.66, 1.16)):
        parts.append(geom.box(f"ph_dpost_{i}", (px, 0.02, 0.10), (0.04, 0.04, 0.60), timber_l))
    parts.append(geom.box("ph_dawn", (0.60, 0.00, 0.68), (0.68, 0.20, 0.04), canvas))
    # greenery and pots around the base
    parts.append(geom.cylinder("ph_bpot", (0.30, 0.12, 0.10), 0.11, 0.18, terra, segments=10))
    parts.append(props.blob("ph_bherb", (0.30, 0.12, 0.30), 0.17, leaf, squash=0.7))
    parts.append(props.blob("ph_bush0", (1.62, 0.24, 0.10), 0.22, leaf2, squash=0.6))
    parts.append(props.blob("ph_bush1", (0.16, 1.30, 0.10), 0.20, leaf, squash=0.6))
    return geom.join(parts, "pharmacy"), (2, 2)


def garden():
    """A low ornamental plot: kerb, beds of flowers, a little path."""
    kerb = M.plaster(tint=(0.62, 0.56, 0.44))
    soil = M.rough_stone("GardenSoil")
    leaf = M.cloth("GardenLeaf", colour=(0.24, 0.44, 0.18))
    path = M.flagstone()
    blooms = [
        M.cloth("Bloom0", colour=(0.85, 0.24, 0.22)),
        M.cloth("Bloom1", colour=(0.90, 0.78, 0.28)),
        M.cloth("Bloom2", colour=(0.62, 0.36, 0.72)),
        M.cloth("Bloom3", colour=(0.92, 0.92, 0.90)),
    ]
    parts = []
    parts.append(geom.box("gd_base", (0.10, 0.10, 0.0), (1.80, 1.80, 0.06), path))
    beds = [(0.18, 0.18), (1.02, 0.18), (0.18, 1.02), (1.02, 1.02)]
    for i, (x, y) in enumerate(beds):
        parts.append(geom.box(f"gd_kerb_{i}", (x, y, 0.06), (0.72, 0.72, 0.08), kerb))
        parts.append(geom.box(f"gd_soil_{i}", (x + 0.06, y + 0.06, 0.12),
                              (0.60, 0.60, 0.05), soil))
        for j in range(6):
            bx = x + 0.12 + ((i * 7 + j * 3) % 5) * 0.11
            by = y + 0.12 + ((i * 5 + j * 2) % 5) * 0.11
            parts.append(geom.cylinder(f"gd_stem_{i}_{j}", (bx, by, 0.17), 0.012, 0.10,
                                       leaf, segments=4))
            parts.append(geom.cone(f"gd_bloom_{i}_{j}", (bx, by, 0.27), 0.05, 0.07,
                                   blooms[(i + j) % 4]))
    return geom.join(parts, "garden"), (2, 2)


def gallows():
    """A grim timber frame with a crossbeam and a noose. Rule by fear."""
    timber_l = M.timber("GallowsTimber")
    timber_d = M.timber("GallowsBeam", dark=True)
    rope = M.cloth("GallowsRope", colour=(0.58, 0.52, 0.36))
    rough = M.rough_stone("GallowsFooting")

    parts = []
    parts.append(geom.box("ga_platform", (0.30, 0.30, 0.0), (1.20, 1.10, 0.30), timber_l))
    parts.append(geom.box("ga_step", (0.30, 1.40, 0.0), (1.20, 0.28, 0.16), timber_l))
    for i, x in enumerate((0.44, 1.32)):
        parts.append(geom.box(f"ga_post_{i}", (x, 0.52, 0.30), (0.12, 0.12, 1.30), timber_d))
    parts.append(geom.box("ga_beam", (0.40, 0.56, 1.54), (1.00, 0.10, 0.12), timber_d))
    parts.append(geom.box("ga_brace", (0.50, 0.56, 1.40), (0.14, 0.08, 0.14), timber_d))
    parts.append(geom.cylinder("ga_rope", (0.90, 0.61, 1.18), 0.018, 0.36, rope, segments=6))
    parts.append(geom.cylinder("ga_loop", (0.90, 0.61, 1.10), 0.07, 0.10, rope, segments=8, cap=False))
    parts.append(geom.box("ga_block", (0.80, 0.52, 0.30), (0.22, 0.22, 0.20), rough))
    return geom.join(parts, "gallows"), (2, 2)


REGISTRY.update({
    "barracks": barracks,
    "fishery": fishery,
    "depot": depot,
    "siege_camp": siege_camp,
    "church": church,
    "pharmacy": pharmacy,
    "garden": garden,
    "gallows": gallows,
    "pig_farm": pig_farm,
    "slaughterhouse": slaughterhouse,
    "hunter": hunter,
    "wall": wall,
    "tower": tower,
    "gatehouse": gatehouse,
})


# --- the weapons chain -----------------------------------------------------
#
# Five buildings that have to read as ONE family at sprite scale, because their
# job is a chain and the player picks them off a single menu row. The reference
# (reference/weapon_production.jpg) is unambiguous about the shape: a low
# open-fronted shed with a plank roof, a workbench under it, and the thing it
# makes propped where you can see it. So the shell is shared and only the goods
# on the bench differ -- which is also what makes them tell apart at 60 pixels,
# since the silhouette is identical and the CONTENTS are the whole signal.


def _workshop_shell(p, parts, wall, timber_l, timber_d, roof_mat):
    """
    The shared 2x2 shed: pad, three walls, posts, plank roof, workbench.

    Open at the front (-Y) for the same reason the storehouse is: what a
    building does has to be visible from the road, and a fourth wall would hide
    the one detail that says which workshop this is. Returns the deck height and
    the bench top, so each builder can stand its goods on them without
    re-deriving numbers that must agree.
    """
    rough = M.rough_stone(f"{p}Footing")
    deck = 0.06
    parts.append(geom.box(f"{p}_pad", (0.06, 0.06, 0.0), (1.88, 1.88, deck), rough))
    # Three half-timbered walls and an open front. `timber_frame` with a `wall`
    # thickness builds the infill as separate panels on the named sides, so the
    # front is genuinely missing rather than three loose boxes pretending.
    parts += geom.timber_frame(p, (0.12, 0.34, deck), (1.76, 1.36, 0.92),
                               wall, timber_d, bay=0.48, wall=0.18,
                               sides=('+y', '-x', '+x'))
    parts.append(geom.box(f"{p}_lintel", (0.12, 0.24, deck + 0.92), (1.76, 0.18, 0.10),
                          timber_d))
    # Shingles rather than thatch: every food building in the game is thatched
    # and the weapons row should not read as another bakery. The battens that
    # used to fake courses on a smooth prism are gone -- the courses are real
    # boards now, and battens laid over them only showed through.
    parts += geom.shingle_roof(p, (0.10, 0.22, deck + 1.02), (1.80, 1.54, 0.50),
                               roof_mat, overhang=0.19, ridge_mat=timber_d)
    parts += geom.rafters(p, (0.10, 0.22, deck + 1.02), (1.80, 1.54, 0.0),
                          timber_d, overhang=0.19)

    bench = deck + 0.54
    parts.append(geom.box(f"{p}_bench", (0.28, 1.10, bench), (1.34, 0.44, 0.08), timber_l))
    for i, (bx, by) in enumerate(((0.32, 1.14), (1.52, 1.14), (0.32, 1.46), (1.52, 1.46))):
        parts.append(geom.box(f"{p}_leg_{i}", (bx, by, deck), (0.09, 0.09, 0.54), timber_d))
    return deck, bench + 0.08


def poleturner():
    """Poleturner's Workshop: a pole lathe, and finished spears in a rack."""
    wall = M.plaster("PoleturnerWall", tint=(0.75, 0.68, 0.55))
    timber_l = M.timber("PoleturnerTimber")
    timber_d = M.timber("PoleturnerTimberDark", dark=True)
    roof = M.shingle_wood("PoleturnerRoof")
    steel = M.iron()

    parts = []
    deck, top = _workshop_shell("pt", parts, wall, timber_l, timber_d, roof)

    # The lathe: a shaft between two puppets, lying along +X on the bench.
    for i, x in enumerate((0.36, 1.44)):
        parts.append(geom.box(f"pt_puppet_{i}", (x, 1.22, top), (0.10, 0.20, 0.26),
                              timber_d))
    shaft = geom.cylinder("pt_shaft", (0.0, 0.0, 0.0), 0.045, 1.02, timber_l, segments=8)
    shaft.rotation_euler = (0.0, math.pi / 2.0, 0.0)
    shaft.location = (0.46, 1.32, top + 0.14)
    parts.append(shaft)

    # Finished spears standing against the right-hand post, points up, so the
    # product is the tallest thing in the frame from every rotation.
    for i in range(4):
        x = 1.20 + i * 0.13
        parts.append(geom.cylinder(f"pt_spear_{i}", (x, 0.52 + (i % 2) * 0.06, deck),
                                   0.022, 1.02, timber_d, segments=6))
        parts.append(geom.cone(f"pt_tip_{i}", (x, 0.52 + (i % 2) * 0.06, deck + 1.02),
                               0.036, 0.14, steel))

    # A stack of unturned poles on the ground, waiting their turn.
    for i in range(4):
        o = geom.cylinder(f"pt_pole_{i}", (0.0, 0.0, 0.0), 0.05, 0.90, timber_l,
                          segments=8)
        o.rotation_euler = (math.pi / 2.0, 0.0, 0.0)
        o.location = (0.34 + (i % 2) * 0.12, 0.92, deck + 0.05 + (i // 2) * 0.10)
        parts.append(o)
    return geom.join(parts, "poleturner"), (2, 2)


def fletcher():
    """Fletcher's Workshop: a bow on the bench, staves seasoning, a shaft barrel."""
    wall = M.plaster("FletcherWall", tint=(0.77, 0.70, 0.57))
    timber_l = M.timber("FletcherTimber")
    timber_d = M.timber("FletcherTimberDark", dark=True)
    roof = M.shingle_wood("FletcherRoof")
    string = M.cloth("BowString", colour=(0.86, 0.83, 0.74))

    parts = []
    deck, top = _workshop_shell("fl", parts, wall, timber_l, timber_d, roof)

    # A finished bow standing upright against the back wall. Three straight
    # segments read as a curve at sprite scale -- the same trick the archer's
    # own bow uses, so the two match.
    bx, by = 1.28, 1.42
    for i, (z0, z1, dx) in enumerate([(0.0, 0.22, 0.07), (0.22, 0.46, 0.0),
                                      (0.46, 0.68, 0.07)]):
        seg = geom.box(f"fl_bow_{i}", (bx + dx * 0.5, by, deck + z0),
                       (0.05, 0.05, z1 - z0), timber_l)
        parts.append(seg)
    parts.append(geom.box("fl_string", (bx + 0.055, by + 0.01, deck),
                          (0.02, 0.02, 0.68), string))

    # Staves seasoning across the bench, and a barrel of shafts beside it.
    for i in range(3):
        o = geom.cylinder(f"fl_stave_{i}", (0.0, 0.0, 0.0), 0.032, 1.10, timber_l,
                          segments=6)
        o.rotation_euler = (0.0, math.pi / 2.0, 0.0)
        o.location = (0.34, 1.20 + i * 0.11, top + 0.03)
        parts.append(o)

    parts.append(geom.cylinder("fl_barrel", (0.52, 0.60, deck), 0.20, 0.34,
                               timber_d, segments=10))
    for i in range(7):
        a = i / 7.0 * math.tau
        parts.append(geom.cylinder(
            f"fl_shaft_{i}",
            (0.52 + math.cos(a) * 0.09, 0.60 + math.sin(a) * 0.09, deck + 0.30),
            0.012, 0.46, timber_l, segments=4))
    return geom.join(parts, "fletcher"), (2, 2)


def _forge(prefix, parts, x, y, deck, stone, dark, coal, steel):
    """
    A stone hearth with a lit coal bed and a stubby chimney.

    Shared by the smith and the armourer, because the fire is the one thing
    that says "this building works metal" at a glance, and two hand-built
    hearths would drift apart the first time either was adjusted.
    """
    parts.append(geom.box(f"{prefix}_forge", (x, y, deck), (0.52, 0.46, 0.44), stone))
    parts.append(geom.box(f"{prefix}_coal", (x + 0.08, y + 0.07, deck + 0.44),
                          (0.36, 0.32, 0.05), coal))
    parts.append(geom.box(f"{prefix}_hood", (x - 0.02, y + 0.26, deck + 0.52),
                          (0.56, 0.24, 0.30), dark))
    parts.append(geom.box(f"{prefix}_flue", (x + 0.16, y + 0.30, deck + 0.82),
                          (0.20, 0.20, 0.46), stone))
    parts.append(geom.cylinder(f"{prefix}_bucket", (x + 0.70, y + 0.10, deck), 0.13, 0.24,
                               steel, segments=10))


def blacksmith():
    """Blacksmith's Workshop: forge, anvil, and finished blades on the rack."""
    wall = M.plaster("SmithWall", tint=(0.70, 0.64, 0.53))
    timber_l = M.timber("SmithTimber")
    timber_d = M.timber("SmithTimberDark", dark=True)
    roof = M.shingle_wood("SmithRoof")
    stone = M.rough_stone("SmithHearth")
    steel = M.iron()
    # Modest strength for the same reason the ram's brazier is: high values clip
    # to flat white and the coals stop reading as coals.
    coal = props._emissive("SmithCoals", (1.0, 0.42, 0.10), 6.0)

    parts = []
    deck, top = _workshop_shell("bs", parts, wall, timber_l, timber_d, roof)
    _forge("bs", parts, 0.26, 1.28, deck, stone, timber_d, coal, steel)

    # The anvil, out front where the hammering happens: a stump, a waisted block
    # and a horn, which is the silhouette everyone recognises.
    parts.append(geom.cylinder("bs_stump", (1.22, 0.62, deck), 0.17, 0.34, timber_d,
                               segments=10))
    parts.append(geom.box("bs_anvil", (1.06, 0.50, deck + 0.34), (0.34, 0.16, 0.10), steel))
    parts.append(geom.box("bs_waist", (1.14, 0.53, deck + 0.28), (0.18, 0.10, 0.06), steel))
    parts.append(geom.cone("bs_horn", (1.04, 0.58, deck + 0.39), 0.05, 0.16, steel))
    parts[-1].rotation_euler = (0.0, -math.pi / 2.0, 0.0)

    # Hammer and tongs left on the bench, so it is a bench in use rather than a
    # plank -- and so the bench top earns the number the shell hands back.
    hammer = geom.cylinder("bs_haft", (0.0, 0.0, 0.0), 0.022, 0.34, timber_d, segments=6)
    hammer.rotation_euler = (0.0, math.pi / 2.0, 0.0)
    hammer.location = (0.52, 1.20, top + 0.03)
    parts.append(hammer)
    parts.append(geom.box("bs_head", (0.48, 1.16, top + 0.01), (0.09, 0.09, 0.09), steel))
    for i in range(2):
        arm = geom.cylinder(f"bs_tong_{i}", (0.0, 0.0, 0.0), 0.014, 0.30, steel, segments=5)
        arm.rotation_euler = (0.0, math.pi / 2.0, 0.08 - i * 0.16)
        arm.location = (0.62, 1.42, top + 0.02)
        parts.append(arm)

    # Finished swords stood point-down against the back wall: blade, guard, grip.
    for i in range(3):
        x = 1.14 + i * 0.19
        parts.append(geom.box(f"bs_blade_{i}", (x, 1.44, deck + 0.10),
                              (0.055, 0.02, 0.52), steel))
        parts.append(geom.box(f"bs_guard_{i}", (x - 0.05, 1.44, deck + 0.62),
                              (0.16, 0.03, 0.035), steel))
        parts.append(geom.box(f"bs_grip_{i}", (x + 0.005, 1.44, deck + 0.655),
                              (0.045, 0.03, 0.14), timber_d))
    return geom.join(parts, "blacksmith"), (2, 2)


def armourer():
    """Armourer's Workshop: a forge, and a mail hauberk on an armourer's tree."""
    wall = M.plaster("ArmourerWall", tint=(0.72, 0.66, 0.55))
    timber_l = M.timber("ArmourerTimber")
    timber_d = M.timber("ArmourerTimberDark", dark=True)
    roof = M.shingle_wood("ArmourerRoof")
    stone = M.rough_stone("ArmourerHearth")
    steel = M.iron()
    mail = M.iron("ArmourerMail")
    coal = props._emissive("ArmourerCoals", (1.0, 0.45, 0.12), 5.0)

    parts = []
    deck, top = _workshop_shell("ar", parts, wall, timber_l, timber_d, roof)
    _forge("ar", parts, 0.24, 1.26, deck, stone, timber_d, coal, steel)

    # The armourer's tree out front: a post, crossed shoulders, and a hauberk
    # hanging off it. This is the ONE thing that distinguishes this shed from
    # the smith's at sprite size, so it stands where nothing overlaps it.
    parts.append(geom.cylinder("ar_post", (1.24, 0.60, deck), 0.06, 0.94, timber_d,
                               segments=8))
    parts.append(geom.box("ar_shoulders", (0.96, 0.56, deck + 0.78),
                          (0.56, 0.10, 0.07), timber_d))
    parts.append(geom.box("ar_hauberk", (1.00, 0.52, deck + 0.40),
                          (0.48, 0.20, 0.40), mail))
    parts.append(geom.box("ar_skirt", (1.06, 0.54, deck + 0.24),
                          (0.36, 0.17, 0.18), mail))
    # A helm sitting on the bench beside it.
    parts.append(geom.dome("ar_helm", (1.34, 1.30, top), 0.11, 0.13, steel))
    # Sheet stock leaning against the left post, the raw side of the trade.
    for i in range(2):
        parts.append(geom.box(f"ar_sheet_{i}", (0.34 + i * 0.09, 0.42, deck),
                              (0.06, 0.30, 0.66), steel, rot_z=0.12))
    return geom.join(parts, "armourer"), (2, 2)


def armoury():
    """
    Armoury: a 3x3 stone-footed store hall with racked kit under its eaves.

    Built heavier than the workshops on purpose. It is the one building in the
    chain the player MUST have, it gates the whole military, and a shed that
    looked like the four sheds beside it would be the easy one to forget to put
    up. So: stone to the waist, a tiled hall above, double doors, and the racks
    visible along the open side.
    """
    stone = M.castle_stone()
    rough = M.rough_stone("ArmouryFooting")
    roof = M.shingle_wood("ArmouryRoof")
    timber_l = M.timber("ArmouryTimber")
    timber_d = M.timber("ArmouryTimberDark", dark=True)
    steel = M.iron()
    shield = M.cloth("ArmouryShield", colour=(0.55, 0.16, 0.14))

    parts = []
    parts.append(geom.box("am_plinth", (0.08, 0.60, 0.0), (2.84, 2.32, 0.14), rough))
    parts.append(geom.box("am_body", (0.16, 0.68, 0.14), (2.68, 2.16, 1.14), stone))
    parts.append(geom.box("am_band", (0.10, 0.62, 1.20), (2.80, 2.28, 0.10), timber_d))
    parts += geom.shingle_roof("am", (0.16, 0.68, 1.30), (2.68, 2.16, 0.80),
                               roof, overhang=0.23, ridge_mat=timber_d)
    parts += geom.rafters("am", (0.16, 0.68, 1.30), (2.68, 2.16, 0.0), timber_d,
                          overhang=0.23)

    # Double doors on the front (-Y) face, banded with iron.
    parts.append(geom.box("am_doors", (1.02, 0.60, 0.14), (0.96, 0.10, 0.92), timber_d))
    for i, z in enumerate((0.34, 0.78)):
        parts.append(geom.box(f"am_band_{i}", (1.02, 0.56, z), (0.96, 0.05, 0.07), steel))

    # Racked spears under the eaves on the +X side, so the building says what is
    # inside it without the doors having to be open.
    parts.append(geom.box("am_rack", (2.86, 1.00, 0.14), (0.14, 1.40, 0.16), timber_l))
    parts.append(geom.box("am_rackbar", (2.88, 1.00, 0.86), (0.08, 1.40, 0.07), timber_l))
    for i in range(6):
        y = 1.06 + i * 0.23
        parts.append(geom.cylinder(f"am_spear_{i}", (2.92, y, 0.16), 0.021, 0.98,
                                   timber_d, segments=6))
        parts.append(geom.cone(f"am_tip_{i}", (2.92, y, 1.14), 0.034, 0.13, steel))

    # Shields hung on the -X wall, and a crate and barrel by the door.
    for i, y in enumerate((1.10, 1.62, 2.14)):
        parts.append(geom.cylinder(f"am_shield_{i}", (0.10, y, 0.62), 0.20, 0.06,
                                   shield, segments=12))
        parts[-1].rotation_euler = (0.0, math.pi / 2.0, 0.0)
    parts.append(geom.box("am_crate", (0.40, 0.18, 0.0), (0.44, 0.36, 0.32), timber_l))
    parts.append(geom.cylinder("am_barrel", (2.20, 0.32, 0.0), 0.19, 0.36, timber_l,
                               segments=10))
    return geom.join(parts, "armoury"), (3, 3)


REGISTRY.update({
    "armoury": armoury,
    "poleturner": poleturner,
    "fletcher": fletcher,
    "blacksmith": blacksmith,
    "armourer": armourer,
})


# --- popularity: the carrot and the stick ----------------------------------
#
# Two families that share one job, which is to move popularity without
# producing anything. They are small, they are numerous, and the player sees
# several at once, so each has to be legible as ITSELF at sprite scale rather
# than as "some timber on a plinth". The good ones lean on colour -- a bloom, a
# ribbon, water -- because at forty pixels a silhouette of sticks reads the
# same whatever it is; the fear ones lean on silhouette, because a gibbet and a
# stake are the same palette and only their shape tells them apart.


def well():
    """A stone ring, a windlass under a little shingle roof, a bucket."""
    stone = M.rough_stone("WellStone")
    timber_l = M.timber("WellTimber")
    timber_d = M.timber("WellPost", dark=True)
    shingle = M.shingle_wood("WellRoof")
    rope = M.cloth("WellRope", colour=(0.58, 0.52, 0.36))
    water = M.ground_water("WellWater")

    parts = []
    parts.append(geom.cylinder("we_ring", (1.00, 1.00, 0.0), 0.46, 0.34, stone, segments=12))
    parts.append(geom.cylinder("we_water", (1.00, 1.00, 0.26), 0.38, 0.02, water, segments=12))
    for i, (x, y) in enumerate(((0.62, 1.00), (1.38, 1.00))):
        parts.append(geom.box(f"we_post_{i}", (x - 0.05, y - 0.05, 0.34), (0.10, 0.10, 0.66), timber_d))
    parts.append(geom.cylinder("we_windlass", (0.62, 1.00, 0.92), 0.06, 0.76, timber_l, segments=8))
    parts[-1].rotation_euler = (0.0, math.pi / 2.0, 0.0)
    parts.append(geom.box("we_handle", (1.42, 0.96, 0.88), (0.16, 0.06, 0.06), timber_d))
    parts.append(geom.gable("we_roof", (0.50, 0.66, 1.00), (1.00, 0.68, 0.30), shingle))
    parts.append(geom.cylinder("we_rope", (1.00, 1.00, 0.44), 0.015, 0.48, rope, segments=6))
    parts.append(geom.cylinder("we_bucket", (1.00, 1.00, 0.36), 0.10, 0.14, timber_l, segments=8))
    return geom.join(parts, "well"), (2, 2)


def pond():
    """A dug pool with a stone kerb, reeds and a duck or two."""
    kerb = M.rough_stone("PondKerb")
    water = M.ground_water("PondWater")
    grass = M.ground_grass("PondBank")
    reed = M.cloth("PondReed", colour=(0.34, 0.46, 0.20))
    duck = M.cloth("PondDuck", colour=(0.92, 0.90, 0.86))

    parts = []
    parts.append(geom.box("po_bank", (0.06, 0.06, 0.0), (1.88, 1.88, 0.10), grass))
    parts.append(geom.cylinder("po_kerb", (1.00, 1.00, 0.04), 0.82, 0.12, kerb, segments=16))
    parts.append(geom.cylinder("po_water", (1.00, 1.00, 0.10), 0.72, 0.03, water, segments=16))
    # Reeds round the rim, thickest on the shaded side so the pool has a front.
    for i, (x, y, h) in enumerate(((0.34, 1.52, 0.34), (0.46, 1.66, 0.26), (1.60, 1.40, 0.30),
                                   (1.70, 1.22, 0.22), (0.30, 1.20, 0.24))):
        parts.append(geom.box(f"po_reed_{i}", (x, y, 0.10), (0.05, 0.05, h), reed))
    for i, (x, y) in enumerate(((0.86, 1.10), (1.22, 0.84))):
        parts.append(geom.cylinder(f"po_duck_{i}", (x, y, 0.11), 0.09, 0.08, duck, segments=8))
        parts.append(geom.cylinder(f"po_duckhead_{i}", (x + 0.07, y, 0.17), 0.04, 0.09, duck, segments=6))
    return geom.join(parts, "pond"), (2, 2)


def statue():
    """A robed figure on a stepped plinth. Stone, so it reads pale and still."""
    plinth = M.castle_stone("StatuePlinth")
    pale = M.plaster("StatueMarble", tint=(0.88, 0.86, 0.80))
    flag = M.flagstone("StatueApron")

    parts = []
    parts.append(geom.box("st_apron", (0.10, 0.10, 0.0), (1.80, 1.80, 0.06), flag))
    parts.append(geom.box("st_step0", (0.44, 0.44, 0.06), (1.12, 1.12, 0.16), plinth))
    parts.append(geom.box("st_step1", (0.56, 0.56, 0.22), (0.88, 0.88, 0.16), plinth))
    parts.append(geom.box("st_pedestal", (0.70, 0.70, 0.38), (0.60, 0.60, 0.42), plinth))
    # The figure: a tapering robe rather than legs, which at this size reads as
    # a person where two thin cylinders read as a stool.
    parts.append(geom.cylinder("st_robe", (1.00, 1.00, 0.80), 0.21, 0.62, pale, segments=12))
    parts.append(geom.cylinder("st_torso", (1.00, 1.00, 1.42), 0.15, 0.24, pale, segments=10))
    parts.append(geom.cylinder("st_head", (1.00, 1.00, 1.66), 0.085, 0.17, pale, segments=8))
    parts.append(geom.box("st_arm", (0.86, 0.96, 1.44), (0.34, 0.09, 0.09), pale, rot_z=-0.5))
    return geom.join(parts, "statue"), (2, 2)


def maypole():
    """A ribboned pole on a green. The ribbons are the whole silhouette."""
    timber_d = M.timber("MaypolePole", dark=True)
    grass = M.ground_grass("MaypoleGreen")
    kerb = M.rough_stone("MaypoleKerb")
    ribbons = [
        M.cloth("Ribbon0", colour=(0.86, 0.22, 0.20)),
        M.cloth("Ribbon1", colour=(0.92, 0.80, 0.26)),
        M.cloth("Ribbon2", colour=(0.24, 0.44, 0.74)),
        M.cloth("Ribbon3", colour=(0.94, 0.94, 0.90)),
    ]

    parts = []
    parts.append(geom.box("mp_green", (0.06, 0.06, 0.0), (1.88, 1.88, 0.08), grass))
    parts.append(geom.cylinder("mp_kerb", (1.00, 1.00, 0.06), 0.34, 0.10, kerb, segments=12))
    parts.append(geom.cylinder("mp_pole", (1.00, 1.00, 0.14), 0.07, 1.70, timber_d, segments=8))
    parts.append(geom.cylinder("mp_crown", (1.00, 1.00, 1.78), 0.20, 0.07, timber_d, segments=12))
    # Ribbons fall from the crown to the ground at eight points, alternating
    # colour. Modelled as leaning slabs: a hanging curve is invisible here, the
    # cone of colour is not.
    for i in range(8):
        a = (i / 8.0) * math.tau
        x = 1.00 + math.cos(a) * 0.19
        y = 1.00 + math.sin(a) * 0.19
        r = ribbons[i % len(ribbons)]
        parts.append(geom.box(f"mp_ribbon_{i}", (x - 0.03, y - 0.03, 0.30), (0.06, 0.06, 1.48), r))
        parts[-1].rotation_euler = (math.cos(a) * 0.16, math.sin(a) * 0.16, 0.0)
    return geom.join(parts, "maypole"), (2, 2)


def dancing_bear():
    """A muzzled bear on a chain beside its keeper's post and a drum."""
    timber_l = M.timber("BearTimber")
    timber_d = M.timber("BearPost", dark=True)
    fur = M.cloth("BearFur", colour=(0.15, 0.11, 0.08))
    iron = M.iron("BearChain")
    drum = M.cloth("BearDrum", colour=(0.74, 0.60, 0.34))
    dirt = M.rough_stone("BearRing")

    parts = []
    parts.append(geom.cylinder("db_ring", (1.00, 1.00, 0.0), 0.82, 0.05, dirt, segments=16))
    parts.append(geom.cylinder("db_post", (0.42, 0.46, 0.05), 0.08, 0.90, timber_d, segments=8))
    parts.append(geom.cylinder("db_chain", (0.42, 0.46, 0.62), 0.02, 0.52, iron, segments=6))
    parts[-1].rotation_euler = (0.0, 1.05, 0.6)
    # The bear reared on its hind legs.
    #
    # Two earlier attempts stacked cylinders and both read as a burnt stump:
    # every segment leaves a visible rim, and a column of rimmed drums is a
    # stump no matter what you put on top of it. This is the ox's trick from
    # _ox() instead -- one lofted skin through tapering rings, so the mass is
    # continuous and the shoulder narrows into the head without a seam. The
    # comment there applies exactly: the eye forgives a blocky building far
    # more readily than a blocky animal.
    body = geom._Batch()
    # (height, radius) up the animal: heavy haunches, waist, deep chest,
    # shoulders, then the neck pinching in under the skull.
    rings = ((0.00, 0.20), (0.16, 0.265), (0.42, 0.245), (0.66, 0.215),
             (0.86, 0.175), (0.98, 0.125), (1.04, 0.135), (1.18, 0.155),
             (1.30, 0.125), (1.38, 0.055))
    seg, prev = 12, None
    for (t, r) in rings:
        n0 = len(body.verts)
        for i in range(seg):
            a = (i / seg) * math.tau
            # Slightly deeper front-to-back than side-to-side, so the bear has
            # a chest rather than being round in plan.
            body.verts.append((math.cos(a) * r * 1.12, math.sin(a) * r, t))
        if prev is not None:
            for i in range(seg):
                j = (i + 1) % seg
                body.faces.append((prev + i, prev + j, n0 + j, n0 + i))
        prev = n0
    body.faces.append(tuple(range(seg - 1, -1, -1)))
    body.faces.append(tuple(range(prev, prev + seg)))
    # Muzzle pushed out of the skull, and forelegs held in against the chest.
    body.slab((0.10, -0.07, 1.16), (0.19, 0.0, -0.02), (0.0, 0.14, 0.0), (0.0, 0.0, 0.11))
    for dy in (-0.20, 0.20):
        body.slab((0.10, dy - 0.055, 0.62), (0.10, 0.0, 0.0), (0.0, 0.11, 0.0), (0.06, 0.0, 0.34))
    at = (1.22, 1.16, 0.04)
    parts.append(body.finish("db_bear", fur, at, 0.5))

    ears = geom._Batch()
    for dy in (-0.115, 0.115):
        ears.rod((0.0, dy, 1.30), (0.0, dy * 1.25, 1.42), 0.055, segments=7)
    parts.append(ears.finish("db_ears", fur, at, 0.5))
    parts.append(geom.cylinder("db_drum", (1.62, 0.54, 0.05), 0.17, 0.22, drum, segments=12))
    parts.append(geom.box("db_stick", (1.56, 0.50, 0.27), (0.22, 0.04, 0.04), timber_l, rot_z=0.4))
    return geom.join(parts, "dancing_bear"), (2, 2)


def stocks():
    """A pillory board between two posts. The mildest of the punishments."""
    timber_l = M.timber("StocksTimber")
    timber_d = M.timber("StocksPost", dark=True)
    iron = M.iron("StocksIron")
    dirt = M.rough_stone("StocksGround")

    parts = []
    parts.append(geom.box("sk_ground", (0.20, 0.40, 0.0), (1.60, 1.20, 0.05), dirt))
    parts.append(geom.box("sk_step", (0.50, 1.10, 0.05), (1.00, 0.34, 0.14), timber_l))
    for i, x in enumerate((0.46, 1.42)):
        parts.append(geom.box(f"sk_post_{i}", (x - 0.06, 0.66, 0.05), (0.12, 0.12, 0.94), timber_d))
    parts.append(geom.box("sk_board", (0.40, 0.62, 0.72), (1.20, 0.09, 0.22), timber_l))
    # Three holes read as three notches along the top edge; at sprite scale the
    # notch is what says "stocks" rather than "fence".
    for i, x in enumerate((0.66, 0.96, 1.26)):
        parts.append(geom.box(f"sk_notch_{i}", (x - 0.06, 0.60, 0.86), (0.12, 0.13, 0.09), dirt))
    parts.append(geom.cylinder("sk_ring", (1.42, 0.60, 0.52), 0.05, 0.03, iron, segments=8))
    return geom.join(parts, "stocks"), (2, 2)


def dunking_stool():
    """A beam on a fulcrum over a pond, with a chair at the wet end."""
    timber_l = M.timber("DunkTimber")
    timber_d = M.timber("DunkPost", dark=True)
    water = M.ground_water("DunkWater")
    kerb = M.rough_stone("DunkKerb")
    iron = M.iron("DunkPin")

    parts = []
    parts.append(geom.cylinder("ds_kerb", (1.34, 1.00, 0.0), 0.60, 0.10, kerb, segments=14))
    parts.append(geom.cylinder("ds_water", (1.34, 1.00, 0.08), 0.50, 0.03, water, segments=14))
    for i, y in enumerate((0.84, 1.16)):
        parts.append(geom.box(f"ds_frame_{i}", (0.36, y - 0.06, 0.0), (0.12, 0.12, 0.78), timber_d))
    parts.append(geom.cylinder("ds_pin", (0.42, 1.00, 0.78), 0.04, 0.30, iron, segments=8))
    parts[-1].rotation_euler = (math.pi / 2.0, 0.0, 0.0)
    # The beam tips down toward the water: the diagonal IS the machine.
    parts.append(geom.box("ds_beam", (0.30, 0.96, 0.74), (1.44, 0.09, 0.09), timber_l))
    parts[-1].rotation_euler = (0.0, 0.42, 0.0)
    parts.append(geom.box("ds_seat", (1.44, 0.88, 0.16), (0.30, 0.26, 0.05), timber_l))
    parts.append(geom.box("ds_back", (1.68, 0.88, 0.21), (0.05, 0.26, 0.28), timber_l))
    return geom.join(parts, "dunking_stool"), (2, 2)


def stretching_rack():
    """A low frame with a roller at each end and a ratchet handle."""
    timber_l = M.timber("RackTimber")
    timber_d = M.timber("RackFrame", dark=True)
    iron = M.iron("RackIron")
    rope = M.cloth("RackRope", colour=(0.58, 0.52, 0.36))
    dirt = M.rough_stone("RackGround")

    parts = []
    parts.append(geom.box("sr_ground", (0.16, 0.44, 0.0), (1.68, 1.12, 0.05), dirt))
    for i, y in enumerate((0.60, 1.28)):
        parts.append(geom.box(f"sr_rail_{i}", (0.34, y - 0.06, 0.30), (1.32, 0.12, 0.10), timber_d))
    for i, (x, y) in enumerate(((0.38, 0.60), (0.38, 1.28), (1.56, 0.60), (1.56, 1.28))):
        parts.append(geom.box(f"sr_leg_{i}", (x - 0.06, y - 0.06, 0.05), (0.12, 0.12, 0.27), timber_d))
    for i, x in enumerate((0.44, 1.52)):
        parts.append(geom.cylinder(f"sr_roller_{i}", (x, 0.94, 0.40), 0.10, 0.74, timber_l, segments=10))
        parts[-1].rotation_euler = (math.pi / 2.0, 0.0, 0.0)
    parts.append(geom.box("sr_bed", (0.56, 0.72, 0.36), (0.90, 0.44, 0.04), timber_l))
    parts.append(geom.cylinder("sr_rope0", (0.62, 0.94, 0.42), 0.02, 0.24, rope, segments=6))
    parts[-1].rotation_euler = (0.0, math.pi / 2.0, 0.0)
    parts.append(geom.cylinder("sr_ratchet", (1.52, 0.50, 0.40), 0.15, 0.05, iron, segments=10))
    parts[-1].rotation_euler = (math.pi / 2.0, 0.0, 0.0)
    parts.append(geom.box("sr_handle", (1.50, 0.40, 0.40), (0.05, 0.05, 0.28), iron))
    return geom.join(parts, "stretching_rack"), (2, 2)


def gibbet():
    """A hanging iron cage on a gallows arm. Taller and thinner than the gallows."""
    timber_d = M.timber("GibbetPost", dark=True)
    iron = M.iron("GibbetCage")
    rough = M.rough_stone("GibbetFooting")

    parts = []
    parts.append(geom.box("gi_footing", (0.52, 0.78, 0.0), (0.44, 0.44, 0.18), rough))
    parts.append(geom.box("gi_post", (0.64, 0.90, 0.18), (0.14, 0.14, 1.68), timber_d))
    parts.append(geom.box("gi_arm", (0.64, 0.94, 1.72), (0.86, 0.10, 0.12), timber_d))
    parts.append(geom.box("gi_brace", (0.76, 0.94, 1.54), (0.20, 0.08, 0.20), timber_d))
    parts.append(geom.cylinder("gi_hook", (1.40, 0.99, 1.60), 0.02, 0.14, iron, segments=6))
    # The cage: a barrel of bars, wider at the shoulder, hanging clear of the
    # ground. Bars rather than a solid drum, or it reads as a bucket.
    for i in range(8):
        a = (i / 8.0) * math.tau
        x = 1.40 + math.cos(a) * 0.16
        y = 0.99 + math.sin(a) * 0.16
        parts.append(geom.cylinder(f"gi_bar_{i}", (x, y, 0.96), 0.017, 0.52, iron, segments=4))
    for i, z in enumerate((0.96, 1.22, 1.46)):
        parts.append(geom.cylinder(f"gi_hoop_{i}", (1.40, 0.99, z), 0.17, 0.03, iron,
                                   segments=10, cap=False))
    return geom.join(parts, "gibbet"), (2, 2)


def dog_cage():
    """A barred pen with a gate and a gnawed bone. Kennels for the war dogs."""
    timber_d = M.timber("CagePost", dark=True)
    iron = M.iron("CageBar")
    straw = M.thatch("CageStraw")
    dirt = M.rough_stone("CageGround")
    bone = M.plaster("CageBone", tint=(0.86, 0.84, 0.76))

    parts = []
    parts.append(geom.box("dc_ground", (0.14, 0.14, 0.0), (1.72, 1.72, 0.05), dirt))
    parts.append(geom.box("dc_straw", (0.34, 0.34, 0.05), (1.00, 1.00, 0.07), straw))
    for i, (x, y) in enumerate(((0.24, 0.24), (1.64, 0.24), (0.24, 1.64), (1.64, 1.64))):
        parts.append(geom.box(f"dc_post_{i}", (x - 0.07, y - 0.07, 0.05), (0.14, 0.14, 0.86), timber_d))
    # Bars on three sides; the fourth is the gate, which gets a frame and a
    # heavier bar so the front of the pen is obvious.
    for i in range(6):
        t = 0.24 + i * 0.28
        parts.append(geom.cylinder(f"dc_barx_{i}", (t, 0.24, 0.05), 0.022, 0.82, iron, segments=5))
        parts.append(geom.cylinder(f"dc_bary_{i}", (0.24, t, 0.05), 0.022, 0.82, iron, segments=5))
        parts.append(geom.cylinder(f"dc_barz_{i}", (t, 1.64, 0.05), 0.022, 0.82, iron, segments=5))
    parts.append(geom.box("dc_gate", (1.58, 0.30, 0.05), (0.08, 1.30, 0.88), timber_d))
    # A FRAME along the top edges, not a lid. A slab here roofed the pen over
    # and turned a cage into a shed -- the bars are the whole point, and they
    # have to stay visible from above at this camera angle.
    for i, (px, py, sx, sy) in enumerate(((0.20, 0.20, 1.62, 0.10),
                                          (0.20, 1.72, 1.62, 0.10),
                                          (0.20, 0.20, 0.10, 1.62),
                                          (1.72, 0.20, 0.10, 1.62))):
        parts.append(geom.box(f"dc_frame_{i}", (px, py, 0.87), (sx, sy, 0.08), timber_d))
    parts.append(geom.cylinder("dc_bone", (0.86, 0.72, 0.12), 0.035, 0.26, bone, segments=6))
    parts[-1].rotation_euler = (0.0, math.pi / 2.0, 0.7)
    return geom.join(parts, "dog_cage"), (2, 2)


def burning_stake():
    """A stake in a faggot pile, scorched. No fire: the char tells the story."""
    timber_d = M.timber("StakePost", dark=True)
    faggot = M.timber("StakeFaggot")
    char = M.cloth("StakeChar", colour=(0.10, 0.09, 0.08))
    ash = M.rough_stone("StakeAsh")
    iron = M.iron("StakeChain")

    parts = []
    parts.append(geom.cylinder("bs_ash", (1.00, 1.00, 0.0), 0.74, 0.06, ash, segments=14))
    parts.append(geom.cylinder("bs_stake", (1.00, 1.00, 0.06), 0.09, 1.42, timber_d, segments=8))
    parts.append(geom.cylinder("bs_char", (1.00, 1.00, 0.06), 0.10, 0.52, char, segments=8))
    # Faggots stacked as a ring of short logs leaning inward on the stake.
    for i in range(10):
        a = (i / 10.0) * math.tau
        x = 1.00 + math.cos(a) * 0.34
        y = 1.00 + math.sin(a) * 0.34
        parts.append(geom.cylinder(f"bs_faggot_{i}", (x, y, 0.06), 0.055, 0.60, faggot, segments=5))
        parts[-1].rotation_euler = (-math.sin(a) * 0.42, math.cos(a) * 0.42, 0.0)
    parts.append(geom.cylinder("bs_chain", (1.00, 1.00, 0.86), 0.115, 0.04, iron,
                               segments=10, cap=False))
    return geom.join(parts, "burning_stake"), (2, 2)


def dungeon():
    """A sunken stone blockhouse with a grated pit and a barred door."""
    stone = M.castle_stone("DungeonStone")
    rough = M.rough_stone("DungeonRubble")
    iron = M.iron("DungeonGrate")
    timber_d = M.timber("DungeonDoor", dark=True)
    flag = M.flagstone("DungeonApron")

    parts = []
    parts.append(geom.box("du_apron", (0.06, 0.06, 0.0), (2.88, 2.88, 0.06), flag))
    parts.append(geom.box("du_base", (0.24, 0.24, 0.06), (2.52, 2.52, 0.26), rough))
    parts.append(geom.box("du_block", (0.40, 0.40, 0.32), (2.20, 2.20, 1.02), stone))
    parts += geom.crenellate("du_crown", (0.34, 0.34), 2.32, 2.32, stone,
                             merlon=0.24, gap=0.20, height=0.22, thickness=0.14,
                             z=1.34)
    # The pit: a grated hole in the apron, which is the one feature that says
    # "they are UNDER there" rather than "this is a small keep".
    parts.append(geom.box("du_pit", (1.00, 0.06, 0.06), (0.90, 0.34, 0.04), rough))
    for i in range(5):
        parts.append(geom.cylinder(f"du_grate_{i}", (1.08 + i * 0.18, 0.23, 0.10), 0.022, 0.32, iron,
                                   segments=5))
        parts[-1].rotation_euler = (math.pi / 2.0, 0.0, 0.0)
    parts.append(geom.box("du_door", (1.20, 0.36, 0.32), (0.60, 0.10, 0.78), timber_d))
    for i in range(3):
        parts.append(geom.box(f"du_bar_{i}", (1.18, 0.34, 0.44 + i * 0.24), (0.64, 0.05, 0.06), iron))
    parts.append(geom.box("du_step", (1.22, 0.20, 0.06), (0.56, 0.20, 0.14), rough))
    return geom.join(parts, "dungeon"), (3, 3)


REGISTRY.update({
    "well": well,
    "pond": pond,
    "statue": statue,
    "maypole": maypole,
    "dancing_bear": dancing_bear,
    "stocks": stocks,
    "dunking_stool": dunking_stool,
    "stretching_rack": stretching_rack,
    "gibbet": gibbet,
    "dog_cage": dog_cage,
    "burning_stake": burning_stake,
    "dungeon": dungeon,
})


# --- religion: the rungs either side of the church -------------------------
#
# One family, four sizes, and the hard part is that they must never be mistaken
# for each other on a crowded map. The church is already a domed octagon, so
# copying it at two scales would give three buildings with one silhouette. Each
# rung gets its OWN roofline instead: the shrine a niche with a pitched cap,
# the chapel a gabled hall under a bellcote, the cathedral a great dome held
# between two towers. Same stone, same pale plaster, four outlines.


def shrine():
    """A wayside niche: a stone pier, an arched recess, a lamp and a cap."""
    stone = M.castle_stone("ShrineStone")
    rough = M.rough_stone("ShrineFooting")
    pale = M.plaster("ShrinePale", tint=(0.87, 0.84, 0.76))
    dark = M.timber("ShrineNiche", dark=True)
    lamp = M.cloth("ShrineLamp", colour=(0.92, 0.78, 0.36))

    parts = []
    parts.append(geom.box("sh_footing", (0.18, 0.18, 0.0), (0.64, 0.64, 0.12), rough))
    parts.append(geom.box("sh_pier", (0.26, 0.26, 0.12), (0.48, 0.48, 0.72), stone))
    # The recess is a dark inset with a pale figure in it -- at one tile the
    # dark hole is the only thing that says "shrine" and not "gatepost".
    parts.append(geom.box("sh_niche", (0.34, 0.22, 0.34), (0.32, 0.10, 0.38), dark))
    parts.append(geom.cylinder("sh_figure", (0.50, 0.30, 0.38), 0.055, 0.24, pale, segments=8))
    parts.append(geom.box("sh_cornice", (0.22, 0.22, 0.84), (0.56, 0.56, 0.08), pale))
    parts.append(geom.pyramid("sh_cap", (0.24, 0.24, 0.92), (0.52, 0.52, 0.30), pale))
    parts.append(geom.cylinder("sh_lamp", (0.50, 0.20, 0.80), 0.05, 0.07, lamp, segments=6))
    return geom.join(parts, "shrine"), (1, 1)


def chapel():
    """A single vaulted hall with an apse and a bellcote over the west end."""
    stone = M.castle_stone("ChapelStone")
    rough = M.rough_stone("ChapelFoot")
    pale = M.plaster("ChapelPale", tint=(0.87, 0.84, 0.76))
    shingle = M.shingle_wood("ChapelRoof")
    dark = M.timber("ChapelDoor", dark=True)
    iron = M.iron("ChapelBell")

    parts = []
    parts.append(geom.box("ch_footing", (0.16, 0.16, 0.0), (1.68, 1.68, 0.14), rough))
    parts.append(geom.box("ch_nave", (0.28, 0.40, 0.14), (1.30, 1.06, 0.74), stone))
    parts.append(geom.gable("ch_roof", (0.22, 0.34, 0.88), (1.42, 1.18, 0.46), shingle))
    # A half-round apse on the east end, which is what makes it a chapel rather
    # than a shed with a bell on it.
    parts.append(geom.cylinder("ch_apse", (0.93, 0.40, 0.14), 0.36, 0.66, stone, segments=12))
    parts.append(geom.dome("ch_apseroof", (0.93, 0.40, 0.80), 0.38, 0.26, pale, segments=14, rings=5))
    # Bellcote: two piers and a lintel with a bell hung between them.
    # Narrow: at 0.96 wide this was as broad as the hall and read as a gateway
    # standing in front of the chapel rather than a bellcote sitting on it.
    for i, x in enumerate((0.70, 1.14)):
        parts.append(geom.box(f"ch_cotepier_{i}", (x - 0.05, 1.38, 1.08), (0.10, 0.12, 0.28), pale))
    parts.append(geom.box("ch_cotetop", (0.63, 1.38, 1.36), (0.58, 0.12, 0.09), pale))
    parts.append(geom.pyramid("ch_cotecap", (0.66, 1.38, 1.45), (0.52, 0.12, 0.14), pale))
    parts.append(geom.cone("ch_bell", (0.92, 1.44, 1.16), 0.07, 0.13, iron, segments=8))
    parts.append(geom.box("ch_door", (0.74, 1.36, 0.14), (0.32, 0.08, 0.52), dark))
    for i, y in enumerate((0.62, 0.94, 1.24)):
        parts.append(geom.box(f"ch_win_{i}", (0.24, y, 0.44), (0.08, 0.14, 0.30), dark))
    return geom.join(parts, "chapel"), (2, 2)


def cathedral():
    """A great dome between two towers over an arcaded west front."""
    stone = M.castle_stone("CathStone")
    rough = M.rough_stone("CathFooting")
    pale = M.plaster("CathPale", tint=(0.89, 0.86, 0.78))
    trim = M.plaster("CathTrim", tint=(0.80, 0.77, 0.70))
    dark = M.timber("CathDoor", dark=True)
    gold = M.cloth("CathFinial", colour=(0.82, 0.68, 0.30))

    parts = []
    parts.append(geom.box("ca_apron", (0.10, 0.10, 0.0), (2.80, 2.80, 0.08), rough))
    parts.append(geom.box("ca_plinth", (0.30, 0.22, 0.08), (2.40, 2.56, 0.22), stone))

    # Cruciform, and roofed with real pitches. The first attempt capped the
    # whole plan with one 2.3-square slab as a "cornice"; at this camera that
    # is not a cornice, it is a table top, and it hid every roof under it.
    parts.append(geom.box("ca_nave", (1.00, 0.30, 0.30), (1.00, 2.40, 1.06), stone))
    parts.append(geom.gable("ca_naveroof", (0.96, 0.28, 1.36), (1.08, 2.44, 0.44), pale))
    parts.append(geom.box("ca_transept", (0.45, 1.15, 0.30), (2.10, 0.70, 0.94), stone))
    # Ridge along +X: a gable's ridge runs +Y, so it is turned a quarter and
    # anchored at its far corner, since rot_z pivots about the object origin.
    parts.append(geom.gable("ca_transeptroof", (2.59, 1.13, 1.24),
                            (0.74, 2.18, 0.36), pale, rot_z=math.pi / 2.0))

    # The crossing: drum, dome, lantern, finial. Rises clear of both ridges,
    # so the dome is the silhouette and the roofs are what it sits on.
    parts.append(geom.cylinder("ca_drum", (1.50, 1.50, 1.44), 0.56, 0.46, stone, segments=16))
    for i in range(8):
        a = (i / 8.0) * math.tau
        parts.append(geom.box(f"ca_drumwin_{i}", (1.50 + math.cos(a) * 0.54 - 0.05,
                                                  1.50 + math.sin(a) * 0.54 - 0.05, 1.58),
                              (0.10, 0.10, 0.22), dark))
    parts.append(geom.dome("ca_dome", (1.50, 1.50, 1.90), 0.60, 0.60, pale, segments=20, rings=8))
    parts.append(geom.cylinder("ca_lantern", (1.50, 1.50, 2.48), 0.15, 0.18, trim, segments=10))
    parts.append(geom.dome("ca_lanterncap", (1.50, 1.50, 2.66), 0.16, 0.13, pale, segments=10, rings=4))
    parts.append(geom.cylinder("ca_finial", (1.50, 1.50, 2.79), 0.028, 0.20, gold, segments=6))

    # Twin west towers flanking the door, capped below the dome so the
    # hierarchy is unambiguous from any of the four camera angles.
    for i, x in enumerate((0.70, 2.30)):
        parts.append(geom.box(f"ca_tower_{i}", (x - 0.25, 0.30, 0.30), (0.50, 0.56, 1.62), stone))
        parts.append(geom.box(f"ca_towercorn_{i}", (x - 0.29, 0.26, 1.92), (0.58, 0.64, 0.08), trim))
        parts.append(geom.dome(f"ca_towercap_{i}", (x, 0.58, 2.00), 0.27, 0.32, pale,
                               segments=12, rings=5))
        for j, z in enumerate((0.94, 1.36)):
            parts.append(geom.box(f"ca_towerwin_{i}_{j}", (x - 0.08, 0.26, z), (0.16, 0.08, 0.24), dark))

    # West front: a great door under an arch, between two columns.
    parts.append(geom.box("ca_door", (1.30, 0.26, 0.30), (0.40, 0.10, 0.70), dark))
    parts.append(geom.cylinder("ca_arch", (1.50, 0.31, 1.00), 0.20, 0.09, trim, segments=12))
    parts[-1].rotation_euler = (math.pi / 2.0, 0.0, 0.0)
    for i, x in enumerate((1.12, 1.88)):
        parts.append(geom.cylinder(f"ca_col_{i}", (x, 0.34, 0.30), 0.07, 0.70, trim, segments=8))
    # Apse on the east end, which is what stops the plan reading as a barn.
    parts.append(geom.cylinder("ca_apse", (1.50, 2.70, 0.30), 0.46, 0.86, stone, segments=14))
    parts.append(geom.dome("ca_apseroof", (1.50, 2.70, 1.16), 0.48, 0.34, pale, segments=14, rings=5))
    return geom.join(parts, "cathedral"), (3, 3)


REGISTRY.update({
    "shrine": shrine,
    "chapel": chapel,
    "cathedral": cathedral,
})


def tanner():
    """
    A tanner's yard: sunken pits, a scraping beam and hides on stretching frames.

    Deliberately NOT another half-timbered workshop box. The weapons row already
    has four of those and a fifth would be indistinguishable at sprite scale;
    what identifies a tannery is the open yard of pits and the frames with skins
    stretched in them, so the building is mostly yard and the shed is a lean-to
    in the corner.
    """
    timber_l = M.timber("TanTimber")
    timber_d = M.timber("TanPost", dark=True)
    shingle = M.shingle_wood("TanRoof")
    stone = M.rough_stone("TanPit")
    liquor = M.cloth("TanLiquor", colour=(0.36, 0.28, 0.15))
    hide = M.cloth("TanHide", colour=(0.62, 0.47, 0.30))
    pale = M.cloth("TanPaleHide", colour=(0.80, 0.72, 0.58))

    parts = []
    parts.append(geom.box("tn_yard", (0.10, 0.10, 0.0), (1.80, 1.80, 0.06), stone))
    # Three tanning pits, sunk and full of dark liquor.
    for i, (x, y) in enumerate(((0.26, 0.24), (0.78, 0.24), (0.26, 0.76))):
        parts.append(geom.box(f"tn_kerb_{i}", (x, y, 0.06), (0.44, 0.44, 0.10), stone))
        parts.append(geom.box(f"tn_liquor_{i}", (x + 0.05, y + 0.05, 0.13), (0.34, 0.34, 0.03), liquor))
    # The lean-to in the far corner, where the finished leather is kept.
    parts.append(geom.box("tn_shed", (1.18, 1.06, 0.06), (0.66, 0.76, 0.54), timber_l))
    parts.append(geom.gable("tn_shedroof", (1.12, 1.00, 0.60), (0.78, 0.88, 0.26), shingle))
    # Two stretching frames with a skin laced into each -- the silhouette that
    # says tannery from across the map.
    for i, (x, y, rz) in enumerate(((0.42, 1.42, 0.0), (0.96, 1.62, -0.5))):
        for j, dx in enumerate((-0.26, 0.26)):
            parts.append(geom.box(f"tn_fpost_{i}_{j}", (x + dx - 0.04, y - 0.04, 0.06),
                                  (0.08, 0.08, 0.86), timber_d, rot_z=rz))
        parts.append(geom.box(f"tn_ftop_{i}", (x - 0.30, y - 0.04, 0.86), (0.60, 0.08, 0.08),
                              timber_d, rot_z=rz))
        parts.append(geom.box(f"tn_skin_{i}", (x - 0.24, y - 0.01, 0.26),
                              (0.48, 0.02, 0.58), pale if i else hide, rot_z=rz))
    # A scraping beam and a barrel of bark by the pits.
    parts.append(geom.cylinder("tn_beam", (0.92, 0.62, 0.34), 0.09, 0.62, timber_l, segments=10))
    parts[-1].rotation_euler = (0.0, 1.15, 0.5)
    parts += geom.barrel("tn_bark", (1.62, 0.36, 0.06), 0.17, 0.34, timber_l, timber_d)
    return geom.join(parts, "tanner"), (2, 2)


REGISTRY.update({"tanner": tanner})


# --- the rest of the castle: three more things to stand on -----------------
#
# Deck heights here are load-bearing, not decoration: GARRISON_HEIGHT in
# defs.ts is copied from these models, and reach above a plain tower's 1.65 is
# what the lookout tower is FOR. Change a height here and change it there.


def perimeter_turret():
    """A one-tile watch post: a squat drum with a crenellated rim."""
    stone = M.castle_stone("TurretStone")
    rough = M.rough_stone("TurretFooting")

    parts = []
    parts.append(geom.box("pt_footing", (0.02, 0.02, 0.0), (0.96, 0.96, 0.12), rough))
    parts.append(geom.cylinder("pt_drum", (0.50, 0.50, 0.12), 0.42, 0.94, stone, segments=12))
    parts.append(geom.cylinder("pt_corbel", (0.50, 0.50, 1.06), 0.46, 0.08, stone, segments=12))
    # Merlons round the rim by hand: crenellate() lays a rectangle, and this is
    # the one thing on the wall line that is round.
    for i in range(8):
        a = (i / 8.0) * math.tau
        parts.append(geom.box(f"pt_merlon_{i}", (0.50 + math.cos(a) * 0.40 - 0.07,
                                                 0.50 + math.sin(a) * 0.40 - 0.07, 1.14),
                              (0.14, 0.14, 0.18), stone, rot_z=a))
    return geom.join(parts, "perimeter_turret"), (1, 1)


def round_tower():
    """A stone drum on a battered plinth. The heavy corner of a curtain."""
    stone = M.castle_stone("RoundStone")
    rough = M.rough_stone("RoundFooting")
    dark = M.timber("RoundSlit", dark=True)
    flag = M.flagstone("RoundDeck")

    parts = []
    parts.append(geom.cylinder("rt_batter", (1.50, 1.50, 0.0), 1.32, 0.30, rough, segments=20))
    parts.append(geom.cylinder("rt_drum", (1.50, 1.50, 0.30), 1.18, 1.42, stone, segments=20))
    # A string course two thirds up, which is what keeps a plain drum from
    # reading as a grain silo.
    parts.append(geom.cylinder("rt_course", (1.50, 1.50, 1.14), 1.22, 0.09, rough, segments=20))
    parts.append(geom.cylinder("rt_corbel", (1.50, 1.50, 1.72), 1.30, 0.12, stone, segments=20))
    parts.append(geom.cylinder("rt_deck", (1.50, 1.50, 1.84), 1.24, 0.08, flag, segments=20))
    for i in range(14):
        a = (i / 14.0) * math.tau
        parts.append(geom.box(f"rt_merlon_{i}", (1.50 + math.cos(a) * 1.20 - 0.11,
                                                 1.50 + math.sin(a) * 1.20 - 0.11, 1.92),
                              (0.22, 0.22, 0.26), stone, rot_z=a))
    for i in range(6):
        a = (i / 6.0) * math.tau + 0.3
        parts.append(geom.box(f"rt_slit_{i}", (1.50 + math.cos(a) * 1.17 - 0.05,
                                               1.50 + math.sin(a) * 1.17 - 0.05, 0.62),
                              (0.10, 0.10, 0.34), dark, rot_z=a))
    return geom.join(parts, "round_tower"), (3, 3)


def lookout_tower():
    """A tall timber-framed shaft on a stone base, with a railed crow's nest."""
    stone = M.castle_stone("LookStone")
    rough = M.rough_stone("LookFooting")
    timber_l = M.timber("LookTimber")
    timber_d = M.timber("LookPost", dark=True)
    shingle = M.shingle_wood("LookRoof")

    parts = []
    parts.append(geom.box("lt_footing", (0.08, 0.08, 0.0), (1.84, 1.84, 0.14), rough))
    parts.append(geom.box("lt_base", (0.30, 0.30, 0.14), (1.40, 1.40, 0.62), stone))
    # Four raking posts, cross-braced. Timber above the base is the point: it
    # is why this stands 2.46 and costs a fraction of a stone tower, and why
    # it has a quarter of the tower's hp.
    for i, (dx, dy) in enumerate(((0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0))):
        x0 = 0.44 + dx * 1.02
        y0 = 0.44 + dy * 1.02
        parts.append(geom.box(f"lt_post_{i}", (x0 - 0.07, y0 - 0.07, 0.76), (0.14, 0.14, 1.44),
                              timber_d))
        parts[-1].rotation_euler = ((0.5 - dy) * 0.13, (dx - 0.5) * 0.13, 0.0)
    for j, z in enumerate((1.12, 1.60)):
        parts.append(geom.box(f"lt_braceA_{j}", (0.40, 0.44, z), (1.20, 0.08, 0.07), timber_l))
        parts.append(geom.box(f"lt_braceB_{j}", (0.40, 1.46, z), (1.20, 0.08, 0.07), timber_l))
        parts.append(geom.box(f"lt_braceC_{j}", (0.44, 0.40, z), (0.08, 1.20, 0.07), timber_l))
        parts.append(geom.box(f"lt_braceD_{j}", (1.46, 0.40, z), (0.08, 1.20, 0.07), timber_l))
    # The nest, oversailing the shaft so the silhouette flares at the top.
    parts.append(geom.box("lt_deck", (0.26, 0.26, 2.20), (1.48, 1.48, 0.10), timber_l))
    for i, (px, py, sx, sy) in enumerate(((0.26, 0.26, 1.48, 0.10),
                                          (0.26, 1.64, 1.48, 0.10),
                                          (0.26, 0.26, 0.10, 1.48),
                                          (1.64, 0.26, 0.10, 1.48))):
        parts.append(geom.box(f"lt_rail_{i}", (px, py, 2.30), (sx, sy, 0.30), timber_l))
    parts.append(geom.gable("lt_roof", (0.34, 0.34, 2.60), (1.32, 1.32, 0.40), shingle,
                            overhang=0.10))
    parts += geom.ladder("lt_ladder", (1.02, 0.22, 0.14), 2.06, 0.34, timber_d, lean=0.16)
    return geom.join(parts, "lookout_tower"), (2, 2)


REGISTRY.update({
    "perimeter_turret": perimeter_turret,
    "round_tower": round_tower,
    "lookout_tower": lookout_tower,
})


# --- the wet ditch and the way over it --------------------------------------


def moat():
    """
    A tile of wet ditch.

    Painted in runs, so it has to TILE: anything with a lip or a bank around
    all four sides turns a channel into a row of separate ponds and draws a
    grid over the map. So the cut goes edge to edge and only the water is
    inset, which lets neighbours read as one continuous trench.
    """
    dark = M.cloth("MoatBed", colour=(0.13, 0.12, 0.10))
    water = M.ground_water("MoatWater")

    parts = []
    # Every layer runs the FULL tile, 0 to 1 on both axes. The first cut inset
    # the water and left the pale cut showing as a rim, which on a painted run
    # is a lattice of pale diamonds drawn over the map -- the exact thing this
    # docstring says not to do. Nothing is inset now, so neighbours meet edge
    # to edge and a line of them is one sheet of water.
    parts.append(geom.box("mo_bed", (0.0, 0.0, 0.0), (1.0, 1.0, 0.03), dark))
    parts.append(geom.box("mo_water", (0.0, 0.0, 0.03), (1.0, 1.0, 0.02), water))
    # No rubble in the bottom either. Two stones at fixed spots is two stones
    # at the SAME spot on every tile, and a painted run turns that into a row
    # of evenly spaced dots -- the rim problem again wearing a different hat.
    # One sprite laid end to end can only carry what survives repetition.
    return geom.join(parts, "moat"), (1, 1)


def _drawbridge(raised: bool):
    """The deck, flat or swung up. Two sprites, one model, one flag."""
    timber_l = M.timber("BridgeDeck")
    timber_d = M.timber("BridgePost", dark=True)
    iron = M.iron("BridgeChain")
    stone = M.rough_stone("BridgeAbutment")
    water = M.ground_water("BridgeWater")

    parts = []
    # The ditch it spans is drawn under it either way, or a raised bridge
    # leaves a suspiciously dry hole in the moat.
    parts.append(geom.box("db_cut", (0.0, 0.0, 0.0), (1.0, 1.0, 0.04), stone))
    parts.append(geom.box("db_water", (0.06, 0.06, 0.05), (0.88, 0.88, 0.02), water))
    for i, y in enumerate((0.06, 0.80)):
        parts.append(geom.box(f"db_abut_{i}", (0.0, y, 0.0), (1.0, 0.14, 0.20), stone))
    for i, x in enumerate((0.10, 0.78)):
        parts.append(geom.box(f"db_post_{i}", (x, 0.02, 0.20), (0.12, 0.12, 0.62), timber_d))
    parts.append(geom.box("db_lintel", (0.06, 0.02, 0.82), (0.88, 0.12, 0.10), timber_d))

    if raised:
        # Swung up against the posts: the deck stands on its hinge edge, which
        # is the whole read at forty pixels -- a vertical slab where there was
        # a flat one.
        parts.append(geom.box("db_deck", (0.14, 0.72, 0.18), (0.72, 0.10, 0.80), timber_l))
        for i, x in enumerate((0.22, 0.70)):
            parts.append(geom.box(f"db_plank_{i}", (x, 0.70, 0.20), (0.08, 0.06, 0.74), timber_d))
            parts.append(geom.cylinder(f"db_chain_{i}", (x + 0.04, 0.30, 0.86), 0.018, 0.46, iron,
                                       segments=5))
            parts[-1].rotation_euler = (1.02, 0.0, 0.0)
    else:
        parts.append(geom.box("db_deck", (0.10, 0.16, 0.18), (0.80, 0.68, 0.07), timber_l))
        for i, y in enumerate((0.26, 0.50, 0.74)):
            parts.append(geom.box(f"db_plank_{i}", (0.10, y, 0.25), (0.80, 0.05, 0.02), timber_d))
        for i, x in enumerate((0.22, 0.70)):
            parts.append(geom.cylinder(f"db_chain_{i}", (x + 0.04, 0.10, 0.40), 0.018, 0.52, iron,
                                       segments=5))
            parts[-1].rotation_euler = (-0.62, 0.0, 0.0)
    return geom.join(parts, "drawbridge_raised" if raised else "drawbridge"), (1, 1)


REGISTRY.update({
    "moat": moat,
    "drawbridge": lambda: _drawbridge(False),
    "drawbridge_raised": lambda: _drawbridge(True),
})


# --- the sprung defences, and a way up ------------------------------------


def killing_pit():
    """
    A lidded pit: brushwood over stakes, with the stakes just showing.

    The whole job is to be crossable and to look crossable, so it sits FLAT --
    anything standing proud of the ground would be walked around by a player
    who could see it, which defeats a trap. It is painted in runs like the
    pitch ditch, so it tiles the same way: full-bleed, nothing inset.
    """
    earth = M.cloth("PitEarth", colour=(0.34, 0.29, 0.21))
    brush = M.thatch("PitBrush")
    stake = M.timber("PitStake", dark=True)

    parts = []
    parts.append(geom.box("kp_ground", (0.0, 0.0, 0.0), (1.0, 1.0, 0.03), earth))
    # Brushwood laid in two crossed courses, which reads as a lid rather than
    # as bare dirt, and is the only tell.
    for i in range(5):
        t = 0.10 + i * 0.20
        parts.append(geom.box(f"kp_lidA_{i}", (0.04, t - 0.035, 0.03), (0.92, 0.07, 0.02), brush))
        parts.append(geom.box(f"kp_lidB_{i}", (t - 0.035, 0.04, 0.05), (0.07, 0.92, 0.02), brush))
    # Two stake tips through the gaps. Enough to notice, not enough to avoid.
    for i, (x, y) in enumerate(((0.30, 0.62), (0.68, 0.34))):
        parts.append(geom.cone(f"kp_stake_{i}", (x, y, 0.05), 0.035, 0.10, stake, segments=5))
    return geom.join(parts, "killing_pit"), (1, 1)


def water_pot():
    """A stone butt brimming with water, on a low kerb. Reads at a glance."""
    stone = M.rough_stone("PotStone")
    rim = M.castle_stone("PotRim")
    water = M.ground_water("PotWater")
    timber_d = M.timber("PotYoke", dark=True)

    parts = []
    parts.append(geom.box("wp_kerb", (0.10, 0.10, 0.0), (0.80, 0.80, 0.06), stone))
    parts.append(geom.cylinder("wp_butt", (0.50, 0.50, 0.06), 0.32, 0.40, stone, segments=12))
    parts.append(geom.cylinder("wp_rim", (0.50, 0.50, 0.44), 0.34, 0.06, rim, segments=12))
    # ON TOP of the rim, not below it. The rim is a solid disc rather than a
    # ring, so water tucked under it was capped over completely and the pot
    # read as a basket -- the one feature that says what the building is,
    # invisible. Brimming, too: a full pot is the one that still works.
    parts.append(geom.cylinder("wp_water", (0.50, 0.50, 0.495), 0.285, 0.02, water,
                               segments=12))
    parts.append(geom.box("wp_yoke", (0.44, 0.14, 0.06), (0.12, 0.10, 0.52), timber_d))
    parts.append(geom.cylinder("wp_pail", (0.22, 0.24, 0.06), 0.10, 0.15, timber_d, segments=8))
    return geom.join(parts, "water_pot"), (1, 1)


def stairs():
    """
    Timber steps against a wall: a flight rising to about a curtain's height.

    Deliberately NOT stone. It has to read as an addition bolted onto the
    curtain rather than as a piece of it, or the player cannot see at a glance
    which stretch of wall he has actually made reachable.
    """
    timber_l = M.timber("StairTread")
    timber_d = M.timber("StairStringer", dark=True)
    rough = M.rough_stone("StairFooting")

    parts = []
    parts.append(geom.box("sr_footing", (0.06, 0.06, 0.0), (0.88, 0.88, 0.07), rough))
    # Seven treads climbing to 0.92, which is the wall's walkway height in
    # GARRISON_HEIGHT -- they must arrive level with what they serve.
    n = 7
    for i in range(n):
        z = 0.07 + (i / n) * 0.85
        y = 0.10 + (i / n) * 0.72
        parts.append(geom.box(f"sr_tread_{i}", (0.20, y, z), (0.56, 0.14, 0.05), timber_l))
    for i, x in enumerate((0.18, 0.72)):
        parts.append(geom.box(f"sr_stringer_{i}", (x, 0.10, 0.07), (0.10, 0.10, 0.88), timber_d))
        parts[-1].rotation_euler = (-0.70, 0.0, 0.0)
    parts.append(geom.box("sr_landing", (0.18, 0.80, 0.90), (0.64, 0.16, 0.06), timber_l))
    return geom.join(parts, "stairs"), (1, 1)


REGISTRY.update({
    "killing_pit": killing_pit,
    "water_pot": water_pot,
    "stairs": stairs,
})


# --- the guilds ------------------------------------------------------------
#
# Two workshops that recruit rather than produce, so neither can look like a
# weapons workshop. Both are yards with the work lying about in them: the
# engineers' a timber-framed shed with a trestle and cut stone, the
# tunnellers' a spoil heap over a shored hole in the ground.


def engineers_guild():
    """A framing shed: trestle, sawn timber, dressed blocks and a shear-leg."""
    timber_l = M.timber("EgTimber")
    timber_d = M.timber("EgPost", dark=True)
    shingle = M.shingle_wood("EgRoof")
    plaster = M.plaster("EgPanel", tint=(0.84, 0.79, 0.68))
    stone = M.castle_stone("EgBlock")
    rough = M.rough_stone("EgYard")
    rope = M.cloth("EgRope", colour=(0.56, 0.50, 0.34))

    parts = []
    parts.append(geom.box("eg_yard", (0.08, 0.08, 0.0), (1.84, 1.84, 0.06), rough))
    # An open-fronted shed on the back half, so the yard reads as workspace.
    # timber_frame builds the plaster box as well as the cage, so there is no
    # separate wall to add underneath it.
    parts += geom.timber_frame("eg_shed", (0.20, 0.96, 0.06), (1.56, 0.84, 0.66),
                               plaster, timber_d)
    parts.append(geom.gable("eg_roof", (0.12, 0.88, 0.72), (1.72, 1.00, 0.42), shingle,
                            overhang=0.06))
    # A trestle with a beam being cut on it: the one object that says this is
    # where things are MADE rather than stored.
    for i, x in enumerate((0.42, 1.14)):
        parts.append(geom.box(f"eg_trestle_{i}", (x, 0.36, 0.06), (0.10, 0.42, 0.32), timber_d))
    parts.append(geom.box("eg_beam", (0.28, 0.44, 0.38), (1.20, 0.16, 0.12), timber_l))
    parts += geom.log_stack("eg_logs", (1.46, 0.22, 0.06), 4, 0.68, 0.075, timber_l, along='y')
    for i, (x, y) in enumerate(((0.20, 0.20), (0.44, 0.18))):
        parts.append(geom.box(f"eg_block_{i}", (x, y, 0.06), (0.22, 0.22, 0.20), stone))
    # Shear-legs for lifting the blocks, leaning together over the yard.
    for i, dx in enumerate((-0.16, 0.16)):
        parts.append(geom.cylinder(f"eg_shear_{i}", (0.92 + dx, 0.70, 0.06), 0.05, 0.92,
                                   timber_d, segments=6))
        parts[-1].rotation_euler = (0.0, -dx * 1.9, 0.0)
    parts.append(geom.cylinder("eg_hoist", (0.92, 0.70, 0.60), 0.016, 0.34, rope, segments=5))
    return geom.join(parts, "engineers_guild"), (2, 2)


def tunnelers_guild():
    """A shored mine head: spoil heap, a propped mouth and a windlass."""
    timber_l = M.timber("TgTimber")
    timber_d = M.timber("TgProp", dark=True)
    spoil = M.cloth("TgSpoil", colour=(0.36, 0.30, 0.22))
    dark = M.cloth("TgDark", colour=(0.09, 0.08, 0.07))
    rough = M.rough_stone("TgYard")
    rope = M.cloth("TgRope", colour=(0.56, 0.50, 0.34))
    plank = M.timber("TgPlank")

    parts = []
    parts.append(geom.box("tg_yard", (0.08, 0.08, 0.0), (1.84, 1.84, 0.06), rough))
    # The spoil heap: what comes OUT is the whole tell. A hole alone reads as a
    # cellar; a hole with a mountain of earth beside it reads as a tunnel.
    # Wide and LOW. Cones at 0.42 tall read as tents pitched in the yard; a
    # spoil heap is a thing that has been tipped, so it spreads.
    for i, (x, y, r, h) in enumerate(((1.36, 1.28, 0.52, 0.20), (1.64, 0.84, 0.36, 0.14),
                                      (1.04, 1.64, 0.34, 0.13))):
        parts.append(geom.cone(f"tg_spoil_{i}", (x, y, 0.06), r, h, spoil, segments=12))
    # The mouth: a black pit sunk into the yard, and big enough to see. The
    # first cut was a thin dark sheet at ground level behind three props, which
    # from this camera is simply not visible -- and a tunnellers' guild whose
    # tunnel cannot be seen is a shed with a windlass.
    parts.append(geom.box("tg_pit", (0.22, 0.22, 0.02), (0.74, 0.62, 0.05), dark))
    parts.append(geom.box("tg_mouth", (0.28, 0.28, 0.07), (0.62, 0.50, 0.03), dark))
    for i, (px, py, sx, sy) in enumerate(((0.20, 0.20, 0.78, 0.06),
                                          (0.20, 0.78, 0.78, 0.06),
                                          (0.20, 0.20, 0.06, 0.64),
                                          (0.92, 0.20, 0.06, 0.64))):
        parts.append(geom.box(f"tg_kerb_{i}", (px, py, 0.06), (sx, sy, 0.07), plank))
    for i, x in enumerate((0.26, 0.86)):
        parts.append(geom.box(f"tg_prop_{i}", (x, 0.26, 0.06), (0.10, 0.10, 0.60), timber_d))
    parts.append(geom.box("tg_lintel", (0.20, 0.26, 0.66), (0.82, 0.10, 0.10), timber_d))
    for i, y in enumerate((0.34, 0.52, 0.70)):
        parts.append(geom.box(f"tg_shore_{i}", (0.24, y, 0.10), (0.74, 0.05, 0.05), plank))
    # A windlass over the mouth for hauling the spoil up.
    for i, x in enumerate((0.28, 0.84)):
        parts.append(geom.box(f"tg_wpost_{i}", (x, 0.74, 0.06), (0.09, 0.09, 0.56), timber_d))
    parts.append(geom.cylinder("tg_drum", (0.32, 0.78, 0.60), 0.07, 0.52, timber_l, segments=8))
    parts[-1].rotation_euler = (0.0, math.pi / 2.0, 0.0)
    parts.append(geom.cylinder("tg_rope", (0.60, 0.60, 0.18), 0.015, 0.44, rope, segments=5))
    parts.append(geom.box("tg_bucket", (0.52, 0.52, 0.06), (0.18, 0.18, 0.16), timber_l))
    return geom.join(parts, "tunnelers_guild"), (2, 2)


def mercenary_post():
    """A hiring camp: a striped pavilion, a bell tent, a fire and a spear rack.

    Deliberately the only building in the game made of CLOTH. Everything the
    player raises is timber, plaster and stone, so a tent reads as "these men
    are not from here" before a single sprite of one is recruited -- which is
    the whole point of the post, and cheaper to say in the silhouette than in
    a tooltip nobody reads twice.
    """
    sandy = M.rough_stone("MpGround")
    canvas = M.cloth("MpCanvas", colour=(0.80, 0.74, 0.60))
    stripe = M.cloth("MpStripe", colour=(0.50, 0.21, 0.18))
    timber_d = M.timber("MpPole", dark=True)
    steel = M.iron()
    ash = M.cloth("MpAsh", colour=(0.13, 0.12, 0.11))
    stone = M.rough_stone("MpHearth")
    rug = M.cloth("MpRug", colour=(0.34, 0.28, 0.40))

    parts = []
    parts.append(geom.box("mp_ground", (0.06, 0.06, 0.0), (1.88, 1.88, 0.05), sandy))

    # The pavilion. A drum of canvas with a conical roof over it, and a band of
    # colour where the two meet -- three pieces, because a bare cone at this
    # size reads as a spoil heap and a bare drum as a barrel.
    cx, cy = 0.74, 1.16
    # Coloured WALL, pale roof, rather than a band between the two: a stripe
    # under the eaves is hidden by the roof's own skirt from every one of the
    # four camera angles, which is a thing you only find out by rendering it.
    parts.append(geom.cylinder("mp_wall", (cx, cy, 0.05), 0.56, 0.36, stripe, segments=14))
    parts.append(geom.cone("mp_roof", (cx, cy, 0.38), 0.66, 0.62, canvas, segments=14))
    parts.append(geom.cylinder("mp_finial", (cx, cy, 0.98), 0.022, 0.30, timber_d, segments=6))
    # A pennant, so the tallest thing on the plot is not a bare stick.
    parts.append(geom.box("mp_pennant", (cx + 0.02, cy - 0.01, 1.14), (0.26, 0.02, 0.11), stripe))
    # The doorway: two flaps pinned back off a dark opening.
    parts.append(geom.box("mp_door", (cx - 0.16, cy - 0.585, 0.05), (0.32, 0.03, 0.32), ash))
    for i, dx in enumerate((-0.25, 0.11)):
        parts.append(geom.box(f"mp_flap_{i}", (cx + dx, cy - 0.60, 0.05),
                              (0.14, 0.04, 0.34), canvas))

    # A bell tent behind it, smaller and plainer -- one tent is a curiosity,
    # two are a camp.
    parts.append(geom.cone("mp_tent", (1.50, 0.62, 0.05), 0.40, 0.56, canvas, segments=12))
    parts.append(geom.cylinder("mp_tent_pole", (1.50, 0.62, 0.05), 0.018, 0.68,
                               timber_d, segments=5))
    for i, (dx, dy) in enumerate(((-0.42, 0.0), (0.42, 0.0), (0.0, -0.42), (0.0, 0.42))):
        parts.append(geom.cylinder(f"mp_guy_{i}", (1.50 + dx, 0.62 + dy, 0.05),
                                   0.012, 0.14, timber_d, segments=4))

    # The fire they are sitting round, and the ring of stones that says it is a
    # hearth rather than a scorch mark.
    parts.append(geom.cylinder("mp_fire", (0.62, 0.36, 0.05), 0.20, 0.03, ash, segments=10))
    for i in range(7):
        a = (i / 7.0) * math.tau
        parts.append(geom.box(f"mp_hearth_{i}",
                              (0.62 + math.cos(a) * 0.22 - 0.045,
                               0.36 + math.sin(a) * 0.22 - 0.045, 0.05),
                              (0.09, 0.09, 0.07), stone))
    for i, (dx, dy, h) in enumerate(((-0.04, 0.02, 0.16), (0.05, -0.03, 0.13),
                                     (0.01, 0.06, 0.11))):
        parts.append(geom.cylinder(f"mp_log_{i}", (0.62 + dx, 0.36 + dy, 0.06),
                                   0.022, h, timber_d, segments=5))
        parts[-1].rotation_euler = (0.5, 0.0, i * 2.1)

    # A rack of their own weapons, leaning. They arrive armed; this is the
    # building saying so.
    parts.append(geom.box("mp_rack_base", (1.28, 1.44, 0.05), (0.56, 0.10, 0.08), timber_d))
    for i in range(5):
        parts.append(geom.cylinder(f"mp_spear_{i}", (1.34 + i * 0.12, 1.48, 0.10),
                                   0.014, 0.62, timber_d, segments=5))
        parts[-1].rotation_euler = (-0.24, 0.0, 0.0)
        parts.append(geom.cone(f"mp_tip_{i}", (1.34 + i * 0.12 + 0.0, 1.63, 0.70),
                               0.028, 0.10, steel, segments=6))

    # A rug and a couple of bales outside the pavilion door.
    parts.append(geom.box("mp_rug", (0.24, 0.60, 0.05), (0.50, 0.34, 0.02), rug))
    for i, (x, y) in enumerate(((0.20, 1.62), (0.44, 1.66))):
        parts.append(geom.cylinder(f"mp_bale_{i}", (x, y, 0.05), 0.13, 0.20,
                                   canvas, segments=8))
    return geom.join(parts, "mercenary_post"), (2, 2)


REGISTRY.update({
    "engineers_guild": engineers_guild,
    "tunnelers_guild": tunnelers_guild,
    "mercenary_post": mercenary_post,
})
