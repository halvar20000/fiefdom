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

    # projecting door surround on the -Y face
    parts.append(geom.box("keep_porch", (0.85, -0.30, 0.14), (1.30, 0.32, 1.05), stone))
    parts.append(geom.arch_doorway("keep_door", (1.05, -0.36, 0.14), 0.62, 0.95, 0.10, dark))

    # arrow slits
    for (sx, sy, rot) in ((0.55, -0.02, 0.0), (2.30, -0.02, 0.0),
                          (-0.02, 1.10, math.pi / 2), (-0.02, 2.05, math.pi / 2)):
        parts.append(geom.box("keep_slit", (sx, sy, 0.95), (0.10, 0.06, 0.34), dark, rot_z=rot))

    # flagstone deck inside the parapet, so the roof is not a blank plane in the
    # rotations that look down onto it
    deck = M.flagstone("KeepDeck")
    parts.append(geom.box("keep_deck", (0.16, 0.16, body_h + 0.14),
                          (w - 0.32, d - 0.32, 0.035), deck))

    # banner pole at the +X/-Y corner -- tall enough to break the silhouette
    parts.append(geom.box("keep_pole", (2.84, 0.10, body_h + 0.14), (0.07, 0.07, 1.35), timber))
    parts.append(geom.box("keep_banner", (2.50, 0.12, body_h + 0.78), (0.36, 0.025, 0.62), banner))

    return geom.join(parts, "keep"), (3, 3)


def hovel():
    """Peasant housing: 2x2, daub walls, heavy thatch, lopsided on purpose."""
    wall = M.plaster(tint=(0.80, 0.73, 0.60))
    roof = M.thatch()
    timber = M.timber(dark=True)
    dark = M.iron()

    parts = []
    parts.append(geom.box("hovel_body", (0.18, 0.20, 0.0), (1.62, 1.44, 0.74), wall))
    parts.append(geom.gable("hovel_roof", (0.18, 0.20, 0.74), (1.62, 1.44, 0.62),
                            roof, overhang=0.16))
    parts.append(geom.arch_doorway("hovel_door", (0.78, 0.14, 0.0), 0.40, 0.56, 0.08, dark))

    # corner posts
    for (px, py) in ((0.14, 0.16), (1.76, 0.16), (0.14, 1.60), (1.76, 1.60)):
        parts.append(geom.box("hovel_post", (px, py, 0.0), (0.09, 0.09, 0.78), timber))

    return geom.join(parts, "hovel"), (2, 2)


def woodcutter():
    """Woodcutter's hut: 2x2 open-fronted timber shed with a log pile."""
    timber_l = M.timber()
    timber_d = M.timber(dark=True)
    roof = M.thatch()
    wall = M.plaster(tint=(0.74, 0.67, 0.55))

    parts = []
    parts.append(geom.box("wc_back", (0.20, 1.10, 0.0), (1.55, 0.16, 0.92), wall))
    parts.append(geom.box("wc_side_l", (0.20, 0.30, 0.0), (0.14, 0.82, 0.80), wall))
    parts.append(geom.box("wc_side_r", (1.61, 0.30, 0.0), (0.14, 0.82, 0.80), wall))
    parts.append(geom.gable("wc_roof", (0.14, 0.22, 0.86), (1.68, 1.12, 0.46),
                            roof, overhang=0.18))

    # front posts holding the roof over the open working side
    parts.append(geom.box("wc_post_l", (0.24, 0.26, 0.0), (0.10, 0.10, 0.88), timber_d))
    parts.append(geom.box("wc_post_r", (1.66, 0.26, 0.0), (0.10, 0.10, 0.88), timber_d))

    # sawn logs stacked beside the hut
    for row in range(3):
        for col in range(3 - row):
            x = 0.30 + col * 0.20 + row * 0.10
            z = row * 0.17
            parts.append(geom.cylinder(f"wc_log_{row}_{col}", (x, 0.52, z + 0.09),
                                       0.085, 0.72, timber_l, segments=10))
    # rotate the log pile to lie along +Y
    for o in parts[-6:]:
        o.rotation_euler = (math.pi / 2.0, 0.0, 0.0)

    # chopping block
    parts.append(geom.cylinder("wc_block", (1.45, 0.55, 0.0), 0.16, 0.26, timber_l, segments=12))
    return geom.join(parts, "woodcutter"), (2, 2)


def stockpile():
    """3x3 flagged platform with goods stacked on it."""
    flag = M.castle_stone()
    timber_l = M.timber()
    iron = M.iron()

    parts = []
    parts.append(geom.box("sp_deck", (0.0, 0.0, 0.0), (3.0, 3.0, 0.10), flag))

    # stacked planks
    for i in range(4):
        parts.append(geom.box(f"sp_plank_{i}", (0.25, 0.30, 0.10 + i * 0.075),
                              (1.05, 0.62, 0.07), timber_l))
    # stone blocks
    for i, (bx, by) in enumerate(((1.75, 0.35), (2.30, 0.35), (1.75, 0.92))):
        parts.append(geom.box(f"sp_stone_{i}", (bx, by, 0.10), (0.48, 0.48, 0.34), flag))
    # iron bars
    for i in range(3):
        parts.append(geom.box(f"sp_iron_{i}", (0.35, 1.85 + i * 0.16, 0.10),
                              (0.90, 0.13, 0.11), iron))
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
    """A draught ox. Crude, but at 60px the silhouette is all that survives."""
    ox, oy = origin
    parts = [
        geom.box(f"{name_prefix}_body", (ox, oy, 0.20), (0.62, 0.28, 0.26), mat_hide, rot_z=rot_z),
        geom.box(f"{name_prefix}_head", (ox + 0.58, oy + 0.04, 0.24), (0.20, 0.20, 0.18), mat_hide, rot_z=rot_z),
    ]
    for i, (lx, ly) in enumerate(((0.06, 0.03), (0.06, 0.22), (0.48, 0.03), (0.48, 0.22))):
        parts.append(geom.box(f"{name_prefix}_leg{i}", (ox + lx, oy + ly, 0.0),
                              (0.06, 0.06, 0.22), mat_dark, rot_z=rot_z))
    return parts


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
    hide = M.plaster("OxHide", tint=(0.42, 0.30, 0.20))
    dark = M.timber(dark=True)
    timber = M.timber()
    stone = M.castle_stone()

    parts = [geom.box("ot_post", (1.55, 0.90, 0.0), (0.10, 0.10, 0.70), dark)]
    parts += _ox("ot_ox", (0.55, 0.80), hide, dark)
    # sledge with a block on it
    parts.append(geom.box("ot_sledge", (0.20, 0.70, 0.0), (0.62, 0.50, 0.09), timber))
    parts.append(geom.box("ot_load", (0.28, 0.76, 0.09), (0.46, 0.38, 0.28), stone))
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
    parts.append(geom.box("mk_awning", (0.15, 0.15, 1.12), (2.60, 2.35, 0.07), canvas))
    for i in range(4):
        parts.append(geom.box(f"mk_stripe_{i}", (0.15 + i * 0.66, 0.15, 1.19),
                              (0.30, 2.35, 0.03), stripe))

    parts.append(geom.box("mk_trestle", (0.40, 0.45, 0.0), (2.20, 0.70, 0.52), timber))
    # goods on the trestle
    for i in range(6):
        parts.append(geom.box(f"mk_goods_{i}", (0.52 + i * 0.34, 0.55, 0.52),
                              (0.24, 0.46, 0.16), timber if i % 2 else canvas))
    parts.append(geom.box("mk_scale_post", (2.30, 1.60, 0.0), (0.06, 0.06, 0.85), iron))
    parts.append(geom.box("mk_scale_beam", (2.05, 1.62, 0.82), (0.56, 0.04, 0.04), iron))
    return geom.join(parts, "market"), (3, 3)


def granary():
    """Granary: stone-walled food store with a wide loading arch."""
    stone = M.castle_stone()
    roof = M.thatch()
    dark = M.timber(dark=True)
    sack = M.cloth("Sack", colour=(0.66, 0.58, 0.40))

    parts = []
    parts.append(geom.box("gr_body", (0.10, 0.25, 0.0), (2.80, 2.30, 1.05), stone))
    parts.append(geom.gable("gr_roof", (0.10, 0.25, 1.05), (2.80, 2.30, 0.72),
                            roof, overhang=0.20))
    parts.append(geom.arch_doorway("gr_door", (1.15, 0.18, 0.0), 0.78, 0.82, 0.10, dark))
    for i, (sx, sy) in enumerate(((0.30, 0.05), (0.62, 0.02), (2.45, 0.06))):
        parts.append(geom.box(f"gr_sack_{i}", (sx, sy, 0.0), (0.26, 0.22, 0.28), sack,
                              rot_z=0.3 * i))
    return geom.join(parts, "granary"), (3, 3)


def wheat_farm():
    """Farmstead: cottage plus a ploughed strip of field."""
    wall = M.plaster(tint=(0.78, 0.71, 0.57))
    roof = M.thatch()
    dark = M.timber(dark=True)
    soil = M.plaster("Furrow", tint=(0.40, 0.30, 0.20))
    crop, nt, bsdf = M._new("Wheat")
    M._set(bsdf, "Base Color", (0.72, 0.62, 0.26, 1.0))
    M._set(bsdf, "Roughness", 0.9)

    parts = []
    parts.append(geom.box("wf_body", (0.20, 1.85, 0.0), (1.65, 1.00, 0.72), wall))
    parts.append(geom.gable("wf_roof", (0.20, 1.85, 0.72), (1.65, 1.00, 0.55),
                            roof, overhang=0.16))
    parts.append(geom.arch_doorway("wf_door", (0.85, 1.78, 0.0), 0.38, 0.52, 0.09, dark))

    # field furrows in front
    for i in range(6):
        parts.append(geom.box(f"wf_furrow_{i}", (0.15, 0.20 + i * 0.26, 0.0),
                              (2.70, 0.17, 0.05), soil))
        parts.append(geom.box(f"wf_crop_{i}", (0.18, 0.24 + i * 0.26, 0.05),
                              (2.62, 0.10, 0.20), crop))
    return geom.join(parts, "wheat_farm"), (3, 3)


def mill():
    """Windmill. The one tall silhouette in the economy -- deliberately so."""
    stone = M.castle_stone()
    timber = M.timber(dark=True)
    sail = M.cloth("Sail", colour=(0.76, 0.72, 0.60))
    cap = M.thatch()

    parts = []
    parts.append(geom.cylinder("ml_tower", (1.5, 1.5, 0.0), 0.72, 1.75, stone, segments=14))
    parts.append(geom.cone("ml_cap", (1.5, 1.5, 1.75), 0.80, 0.55, cap, segments=14))
    parts.append(geom.arch_doorway("ml_door", (1.28, 0.74, 0.0), 0.44, 0.62, 0.10, timber))

    # Sails on the -Y face. The shaft points along -Y, so the arms live in the
    # XZ plane and must rotate about Y. The first version made them long in X
    # and rotated about X, which just spun each sail about its own axis and
    # rendered as a couple of stray sticks.
    hub = (1.5, 0.62, 1.45)
    parts.append(geom.box("ml_shaft", (1.46, 0.50, 1.41), (0.08, 0.26, 0.08), timber))
    for i in range(4):
        a = (i / 4) * math.tau + math.pi / 4
        arm = geom.box(f"ml_arm_{i}", hub, (0.055, 0.05, 1.00), timber)
        arm.rotation_euler = (0.0, a, 0.0)
        parts.append(arm)
        blade = geom.box(f"ml_sail_{i}", (hub[0] - 0.005, hub[1] - 0.012, hub[2] + 0.30),
                         (0.20, 0.03, 0.62), sail)
        blade.rotation_euler = (0.0, a, 0.0)
        parts.append(blade)
    return geom.join(parts, "mill"), (3, 3)


def bakery():
    """Bakery: oven dome and chimney against a plastered workshop."""
    wall = M.plaster(tint=(0.80, 0.73, 0.58))
    roof = M.thatch()
    brick = M.castle_stone()
    dark = M.timber(dark=True)

    parts = []
    parts.append(geom.box("bk_body", (0.20, 0.30, 0.0), (1.55, 1.40, 0.80), wall))
    parts.append(geom.gable("bk_roof", (0.20, 0.30, 0.80), (1.55, 1.40, 0.55),
                            roof, overhang=0.16))
    parts.append(geom.arch_doorway("bk_door", (0.82, 0.24, 0.0), 0.40, 0.56, 0.09, dark))
    # oven bulge and chimney
    parts.append(geom.cylinder("bk_oven", (1.78, 1.00, 0.0), 0.34, 0.62, brick, segments=12))
    parts.append(geom.cone("bk_ovencap", (1.78, 1.00, 0.62), 0.36, 0.26, brick, segments=12))
    parts.append(geom.box("bk_chimney", (1.68, 0.94, 0.80), (0.20, 0.20, 0.62), brick))
    return geom.join(parts, "bakery"), (2, 2)


def apple_orchard():
    """Orchard: keeper's hut with fruit trees in rows."""
    wall = M.plaster(tint=(0.76, 0.69, 0.55))
    roof = M.thatch()
    bark = M.timber(dark=True)
    leaf = M.ground_grass(dark=False)
    fruit = M.cloth("Apple", colour=(0.58, 0.14, 0.10))

    parts = []
    parts.append(geom.box("ao_hut", (0.20, 2.05, 0.0), (1.10, 0.80, 0.62), wall))
    parts.append(geom.gable("ao_roof", (0.20, 2.05, 0.62), (1.10, 0.80, 0.42),
                            roof, overhang=0.14))
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
    wall = M.plaster(tint=(0.79, 0.72, 0.57))
    roof = M.thatch()
    rail = M.timber()
    dark = M.timber(dark=True)
    hide = M.plaster("CowHide", tint=(0.72, 0.68, 0.60))

    parts = []
    parts.append(geom.box("df_byre", (0.20, 1.95, 0.0), (1.45, 0.90, 0.68), wall))
    parts.append(geom.gable("df_roof", (0.20, 1.95, 0.68), (1.45, 0.90, 0.48),
                            roof, overhang=0.15))
    parts.append(geom.arch_doorway("df_door", (0.78, 1.88, 0.0), 0.38, 0.50, 0.09, dark))

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
    wall = M.plaster(tint=(0.78, 0.71, 0.57))
    roof = M.thatch()
    pole = M.timber(dark=True)
    dark = M.iron()
    vine = M.ground_grass(dark=False)

    parts = []
    parts.append(geom.box("hf_body", (0.20, 1.95, 0.0), (1.40, 0.90, 0.70), wall))
    parts.append(geom.gable("hf_roof", (0.20, 1.95, 0.70), (1.40, 0.90, 0.52),
                            roof, overhang=0.15))
    parts.append(geom.arch_doorway("hf_door", (0.78, 1.88, 0.0), 0.38, 0.50, 0.09, dark))

    # rows of hop poles with the vines grown up them
    for row in range(3):
        for col in range(4):
            px = 0.30 + col * 0.62
            py = 0.28 + row * 0.52
            parts.append(geom.box(f"hf_pole_{row}_{col}", (px, py, 0.0),
                                  (0.05, 0.05, 1.05), pole))
            parts.append(geom.cone(f"hf_vine_{row}_{col}", (px + 0.025, py + 0.025, 0.18),
                                   0.15, 0.82, vine, segments=8))
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

    parts = []
    parts.append(geom.box("bw_body", (0.15, 0.85, 0.0), (1.85, 1.55, 1.00), stone))
    parts.append(geom.gable("bw_roof", (0.15, 0.85, 1.00), (1.85, 1.55, 0.62),
                            roof, overhang=0.18))
    parts.append(geom.arch_doorway("bw_door", (0.85, 0.78, 0.0), 0.46, 0.66, 0.10, timber_d))
    parts.append(geom.box("bw_chimney", (1.62, 1.30, 1.00), (0.24, 0.24, 0.70), stone))

    # the copper vat under a little lean-to
    parts.append(geom.cylinder("bw_vat", (2.35, 1.55, 0.0), 0.30, 0.46, copper, segments=14))
    parts.append(geom.cone("bw_vat_cap", (2.35, 1.55, 0.46), 0.32, 0.18, copper, segments=14))

    # barrels waiting outside
    for i, (bx, by) in enumerate(((0.35, 0.30), (0.80, 0.26), (1.25, 0.32))):
        b = geom.cylinder(f"bw_barrel_{i}", (bx, by, 0.0), 0.16, 0.34, timber_l, segments=10)
        parts.append(b)
        parts.append(geom.box(f"bw_hoop_{i}", (bx - 0.17, by - 0.17, 0.13),
                              (0.34, 0.34, 0.04), timber_d))
    return geom.join(parts, "brewery"), (3, 3)


def inn():
    """Inn: a long hall with a hanging sign, benches and a barrel by the door."""
    wall = M.plaster(tint=(0.80, 0.73, 0.59))
    roof = M.thatch()
    timber_l = M.timber()
    timber_d = M.timber(dark=True)
    sign = M.cloth("InnSign", colour=(0.52, 0.16, 0.12))

    parts = []
    parts.append(geom.box("in_body", (0.18, 0.95, 0.0), (2.60, 1.75, 1.05), wall))
    parts.append(geom.gable("in_roof", (0.18, 0.95, 1.05), (2.60, 1.75, 0.70),
                            roof, overhang=0.20))
    parts.append(geom.arch_doorway("in_door", (1.30, 0.88, 0.0), 0.50, 0.72, 0.10, timber_d))

    # half-timbered framing on the front wall
    for i in range(5):
        parts.append(geom.box(f"in_stud_{i}", (0.30 + i * 0.56, 0.92, 0.0),
                              (0.08, 0.06, 1.05), timber_d))
    parts.append(geom.box("in_rail", (0.20, 0.92, 0.62), (2.56, 0.05, 0.08), timber_d))

    # hanging sign on a bracket
    parts.append(geom.box("in_bracket", (2.60, 0.80, 0.92), (0.42, 0.06, 0.06), timber_d))
    parts.append(geom.box("in_signpost", (2.94, 0.80, 0.52), (0.04, 0.04, 0.42), timber_d))
    parts.append(geom.box("in_sign", (2.78, 0.79, 0.50), (0.34, 0.03, 0.28), sign))

    # benches and a barrel outside the door
    for i, by in enumerate((0.34, 0.62)):
        parts.append(geom.box(f"in_bench_{i}", (0.45, by, 0.0), (1.10, 0.16, 0.20), timber_l))
    parts.append(geom.cylinder("in_barrel", (2.25, 0.45, 0.0), 0.19, 0.40, timber_l, segments=10))
    parts.append(geom.box("in_hoop", (2.05, 0.25, 0.16), (0.40, 0.40, 0.05), timber_d))
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
    """A pig. Smaller and rounder than the ox, or it reads as a small cow."""
    ox, oy = origin
    parts = [
        geom.box(f"{name_prefix}_body", (ox, oy, 0.13), (0.40, 0.22, 0.19), hide, rot_z=rot_z),
        geom.box(f"{name_prefix}_head", (ox + 0.36, oy + 0.04, 0.15),
                 (0.14, 0.14, 0.13), hide, rot_z=rot_z),
        geom.box(f"{name_prefix}_snout", (ox + 0.48, oy + 0.07, 0.18),
                 (0.05, 0.07, 0.06), hide, rot_z=rot_z),
    ]
    for i, (lx, ly) in enumerate(((0.04, 0.02), (0.04, 0.17), (0.31, 0.02), (0.31, 0.17))):
        parts.append(geom.box(f"{name_prefix}_leg{i}", (ox + lx, oy + ly, 0.0),
                              (0.05, 0.05, 0.14), dark, rot_z=rot_z))
    return parts


def pig_farm():
    """Pig farm: a sty, a muddy pen and pigs rooting about."""
    wall = M.plaster(tint=(0.78, 0.71, 0.57))
    roof = M.thatch()
    rail = M.timber()
    dark = M.timber(dark=True)
    hide = M.plaster("PigHide", tint=(0.72, 0.55, 0.52))
    mud = M.plaster("Mud", tint=(0.34, 0.26, 0.18))

    parts = []
    parts.append(geom.box("pf_sty", (0.22, 2.00, 0.0), (1.30, 0.82, 0.60), wall))
    parts.append(geom.gable("pf_roof", (0.22, 2.00, 0.60), (1.30, 0.82, 0.46),
                            roof, overhang=0.15))
    parts.append(geom.arch_doorway("pf_door", (0.72, 1.94, 0.0), 0.36, 0.44, 0.09, dark))

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
    wall = M.plaster(tint=(0.76, 0.70, 0.56))
    stone = M.castle_stone()
    roof = M.thatch()
    timber_l = M.timber()
    timber_d = M.timber(dark=True)
    iron = M.iron()
    meat = M.cloth("Meat", colour=(0.52, 0.20, 0.18))

    parts = []
    parts.append(geom.box("sl_body", (0.18, 0.95, 0.0), (1.75, 1.30, 0.92), wall))
    parts.append(geom.gable("sl_roof", (0.18, 0.95, 0.92), (1.75, 1.30, 0.58),
                            roof, overhang=0.17))
    parts.append(geom.arch_doorway("sl_door", (0.82, 0.88, 0.0), 0.44, 0.62, 0.10, timber_d))
    parts.append(geom.box("sl_plinth", (0.14, 0.91, 0.0), (1.83, 1.38, 0.10), stone))

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
    parts.append(geom.cylinder("sl_barrel", (0.42, 0.66, 0.0), 0.17, 0.36, timber_l, segments=10))
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
    parts = []
    h = 0.92
    parts.append(geom.box("wl_body", (0.0, 0.0, 0.0), (1.0, 1.0, h), stone))
    # a slight batter at the foot, so a long run is not a flat slab
    parts.append(geom.box("wl_foot", (-0.03, -0.03, 0.0), (1.06, 1.06, 0.14), stone))
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
    # portcullis grilles set back in each opening
    for i in range(2):
        y = 0.62 + i * 0.74
        parts.append(geom.box(f"gh_grille_x_{i}", (0.66, y, 0.66), (0.68, 0.04, 0.34), timber_d))
        parts.append(geom.box(f"gh_grille_y_{i}", (y, 0.66, 0.66), (0.04, 0.68, 0.34), timber_d))
    return geom.join(parts, "gatehouse"), (2, 2)


def barracks():
    """Barracks: hall, weapon racks and a pell for practice, behind a low wall."""
    stone = M.castle_stone()
    rough = M.rough_stone("BarracksFooting")
    roof = M.timber("BarracksRoof", dark=True)
    timber_l = M.timber()
    timber_d = M.timber(dark=True)
    steel = M.iron()
    banner = M.cloth("BarracksBanner", colour=(0.58, 0.14, 0.12))

    parts = []
    parts.append(geom.box("ba_plinth", (0.08, 1.28, 0.0), (2.84, 1.64, 0.12), rough))
    parts.append(geom.box("ba_hall", (0.14, 1.34, 0.0), (2.72, 1.52, 1.02), stone))
    parts.append(geom.gable("ba_roof", (0.14, 1.34, 1.02), (2.72, 1.52, 0.62),
                            roof, overhang=0.18))
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
    roof = M.timber("SiegeRoof", dark=True)
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
    parts.append(geom.gable("sc_roof", (0.12, 1.67, 1.10), (2.72, 1.16, 0.44),
                            roof, overhang=0.17))
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
    parts.append(geom.box("fh_hut", (0.12, 0.98, 0.0), (1.06, 0.88, 0.62), plaster))
    parts.append(geom.gable("fh_roof", (0.12, 0.98, 0.62), (1.06, 0.88, 0.40),
                            roof, overhang=0.14))
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
    plaster = M.plaster(tint=(0.78, 0.72, 0.58))
    roof = M.timber("DepotRoof", dark=True)
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
    parts.append(geom.gable("dp_roof", (0.10, 0.28, 1.02), (1.80, 1.58, 0.52),
                            roof, overhang=0.20))

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
    # arched door on the front (-Y) face
    parts.append(geom.arch_doorway("cp_door", (cx - 0.22, 0.14, 0.20), 0.44, 0.64, 0.16, dark))
    # tall window niches on the other faces, so the side rotations aren't blank
    parts.append(geom.box("cp_win_e", (1.60, cy - 0.15, 0.60), (0.06, 0.30, 0.42), dark))
    parts.append(geom.box("cp_win_w", (0.28, cy - 0.15, 0.60), (0.06, 0.30, 0.42), dark))
    parts.append(geom.box("cp_win_n", (cx - 0.15, 1.60, 0.60), (0.30, 0.06, 0.42), dark))
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
    parts.append(geom.box(f"{p}_back", (0.12, 1.50, deck), (1.76, 0.20, 0.90), wall))
    parts.append(geom.box(f"{p}_side_l", (0.12, 0.58, deck), (0.16, 0.94, 0.84), wall))
    parts.append(geom.box(f"{p}_side_r", (1.72, 0.58, deck), (0.16, 0.94, 0.84), wall))
    parts.append(geom.box(f"{p}_post_l", (0.16, 0.26, deck), (0.14, 0.14, 0.92), timber_d))
    parts.append(geom.box(f"{p}_post_r", (1.70, 0.26, deck), (0.14, 0.14, 0.92), timber_d))
    parts.append(geom.box(f"{p}_lintel", (0.12, 0.24, deck + 0.92), (1.76, 0.18, 0.10),
                          timber_d))
    # Plank roof rather than thatch: every food building in the game is thatched
    # and the weapons row should not read as another bakery.
    parts.append(geom.gable(f"{p}_roof", (0.10, 0.22, deck + 1.02), (1.80, 1.54, 0.44),
                            roof_mat, overhang=0.18))
    for i in range(5):
        parts.append(geom.box(f"{p}_batten_{i}", (0.10, 0.30 + i * 0.30, deck + 1.05),
                              (1.80, 0.06, 0.05), timber_d))

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
    roof = M.timber("PoleturnerRoof", dark=True)
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
    roof = M.timber("FletcherRoof", dark=True)
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
    roof = M.timber("SmithRoof", dark=True)
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
    roof = M.timber("ArmourerRoof", dark=True)
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
    roof = M.timber("ArmouryRoof", dark=True)
    timber_l = M.timber("ArmouryTimber")
    timber_d = M.timber("ArmouryTimberDark", dark=True)
    steel = M.iron()
    shield = M.cloth("ArmouryShield", colour=(0.55, 0.16, 0.14))

    parts = []
    parts.append(geom.box("am_plinth", (0.08, 0.60, 0.0), (2.84, 2.32, 0.14), rough))
    parts.append(geom.box("am_body", (0.16, 0.68, 0.14), (2.68, 2.16, 1.14), stone))
    parts.append(geom.box("am_band", (0.10, 0.62, 1.20), (2.80, 2.28, 0.10), timber_d))
    parts.append(geom.gable("am_roof", (0.16, 0.68, 1.30), (2.68, 2.16, 0.72),
                            roof, overhang=0.22))
    for i in range(7):
        parts.append(geom.box(f"am_batten_{i}", (0.16, 0.76 + i * 0.30, 1.33),
                              (2.68, 0.07, 0.05), timber_d))

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
