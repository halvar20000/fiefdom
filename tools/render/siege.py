"""
Siege engines: a battering ram and a catapult.

Built like the gazelle rather than like a peasant -- primitives with a few
parts posed per frame and no armature. A swinging beam and a throwing arm are
one rotation each; standing up a bone hierarchy to express that would be more
machinery than the motion needs.

They are drawn through the SAME code path as soldiers, so the clip names have
to match `${type}_${idle|walk|attack}` exactly.
"""

from __future__ import annotations
import math

import bpy
import geom
import materials as M

#: Roughly a man and a half tall at the frame. A man is UNIT_HEIGHT_TILES 0.52.
SCALE = 0.62


def _emissive(name, colour, strength):
    """
    A flame is a light source, not a lit surface.

    Learned on the pitch fires and re-learned here: an orange cloth material
    came back at 1% fiery pixels against the ram's 1% baseline -- which is to
    say the fire was not visible at all. Strength stays modest for the same
    reason it does there: high values clip to flat white and the flame loses
    its colour.
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = (*colour, 1.0)
    e.inputs["Strength"].default_value = strength
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(e.outputs["Emission"], out.inputs["Surface"])
    return mat

CLIPS = {
    "ram_idle": 1, "ram_walk": 4, "ram_attack": 6,
    "catapult_idle": 1, "catapult_walk": 4, "catapult_attack": 6,
    "trebuchet_idle": 1, "trebuchet_walk": 4, "trebuchet_attack": 6,
    "fire_ballista_idle": 1, "fire_ballista_walk": 4, "fire_ballista_attack": 6,
}


def _wheel(name, centre, radius, width, mat, segments=12):
    """A wheel standing upright, axle along X."""
    o = geom.cylinder(name, (0.0, 0.0, 0.0), radius, width, mat, segments=segments)
    o.rotation_euler = (0.0, math.pi / 2.0, 0.0)
    cx, cy, cz = centre
    o.location = (cx - width / 2.0, cy, cz)
    return o


def _beam(name, centre, length, radius, mat, segments=10):
    """A cylinder lying along Y."""
    o = geom.cylinder(name, (0.0, 0.0, 0.0), radius, length, mat, segments=segments)
    o.rotation_euler = (-math.pi / 2.0, 0.0, 0.0)
    cx, cy, cz = centre
    o.location = (cx, cy - length / 2.0, cz)
    return o


def _frame_and_wheels(parts, timber_d, iron, w=0.34, l=0.72, deck_z=0.16):
    """Shared chassis. Returns the deck height."""
    parts.append(geom.box("sg_deck", (-w / 2, -l / 2, deck_z), (w, l, 0.05), timber_d))
    for i, (sx, sy) in enumerate([(-1, -1), (1, -1), (-1, 1), (1, 1)]):
        parts.append(geom.box(f"sg_rail_{i}", (sx * (w / 2 - 0.04), sy * (l / 2 - 0.05), deck_z),
                              (0.04, 0.05, 0.06), timber_d))
    for i, (sx, sy) in enumerate([(-1, -1), (1, -1), (-1, 1), (1, 1)]):
        parts.append(_wheel(f"sg_wheel_{i}", (sx * (w / 2 + 0.02), sy * (l / 2 - 0.12), 0.115),
                            0.115, 0.05, timber_d))
        parts.append(_wheel(f"sg_hub_{i}", (sx * (w / 2 + 0.02), sy * (l / 2 - 0.12), 0.115),
                            0.032, 0.06, iron, segments=8))
    parts.append(_beam("sg_axle_f", (0.0, -(l / 2 - 0.12), 0.115), w + 0.06, 0.018, iron))
    parts[-1].rotation_euler = (0.0, math.pi / 2.0, 0.0)
    return deck_z + 0.05


def build_ram():
    """Covered frame with a suspended log. Parts: the log swings."""
    timber_l = M.timber("RamTimber")
    timber_d = M.timber("RamBeam", dark=True)
    iron = M.iron()
    hide = M.cloth("RamRoof", colour=(0.44, 0.33, 0.22))

    objs, parts = [], {}
    p = []
    deck = _frame_and_wheels(p, timber_d, iron)

    # A-frame uprights carrying the swing beam
    for i, sy in enumerate((-0.20, 0.20)):
        for sx in (-1, 1):
            p.append(geom.box(f"rm_post_{i}_{sx}", (sx * 0.15 - 0.025, sy - 0.025, deck),
                              (0.05, 0.05, 0.40), timber_d))
    p.append(_beam("rm_top", (0.0, 0.0, deck + 0.40), 0.56, 0.026, timber_d))
    # Pitched hide roof, deliberately SHORT.
    #
    # At full chassis length it covered the log completely and the ram read as
    # a covered wagon -- the one part that says "battering ram" was invisible.
    # The shelter now stops short so the head projects past it, which is how a
    # real one is built anyway.
    p.append(geom.gable("rm_roof", (-0.21, -0.16, deck + 0.40), (0.42, 0.48, 0.16),
                        hide, overhang=0.05))

    # the log itself, pivoting from the top beam
    log_root = bpy.data.objects.new("rm_logroot", None)
    bpy.context.collection.objects.link(log_root)
    log_root.location = (0.0, 0.0, deck + 0.38)
    log = _beam("rm_log", (0.0, -0.10, -0.20), 0.74, 0.062, timber_l)
    log.parent = log_root
    head = geom.cone("rm_head", (0.0, 0.0, 0.0), 0.078, 0.14, iron)
    head.rotation_euler = (math.pi / 2.0, 0.0, 0.0)
    head.location = (0.0, -0.47, -0.20)
    head.parent = log_root
    for i, z in enumerate((-0.10, -0.30)):
        r = _beam(f"rm_rope_{i}", (0.0, z * 0.5, -0.02), 0.02, 0.008, iron)
        r.rotation_euler = (0.0, 0.0, 0.0)
        r.location = (0.0, z * 0.6, -0.10)
        r.parent = log_root
        objs.append(r)
    objs += [log, head]
    parts["swing"] = log_root

    objs += p
    return _finish(objs, parts, "ram")


def build_catapult():
    """A torsion mangonel: a single arm cocked back off a rope skein, a cup of
    stone at its head, slamming into a padded crossbeam when it fires. Parts:
    the arm rotates. Restyled from Thomas's reference of the classic catapult."""
    timber_l = M.timber("CatTimber")
    timber_d = M.timber("CatBeam", dark=True)
    iron = M.iron()
    rope = M.cloth("CatRope", colour=(0.62, 0.55, 0.38))
    pad = M.cloth("CatPad", colour=(0.50, 0.36, 0.22))
    stone = M.rough_stone("CatShot")

    objs, parts = [], {}
    p = []
    deck = _frame_and_wheels(p, timber_d, iron, w=0.42, l=0.86)

    # side rails rising along the frame, tied by a padded crossbeam at the FRONT
    # (-Y) that the arm strikes, and carrying the torsion skein it springs from.
    for sx in (-1, 1):
        p.append(geom.box(f"ct_rail_{sx}", (sx * 0.19 - 0.03, -0.30, deck),
                          (0.06, 0.66, 0.10), timber_d))
        p.append(geom.box(f"ct_stanchion_{sx}", (sx * 0.19 - 0.03, -0.34, deck),
                          (0.06, 0.06, 0.40), timber_d))
    # the padded crossbeam the arm hits, up at the front
    p.append(_beam("ct_stopbar", (0.0, -0.31, deck + 0.36), 0.44, 0.05, pad))
    p[-1].rotation_euler = (0.0, math.pi / 2.0, 0.0)
    # the torsion skein: a thick rope bundle across the frame, low and central
    p.append(_beam("ct_skein", (0.0, 0.06, deck + 0.10), 0.44, 0.06, rope))
    p[-1].rotation_euler = (0.0, math.pi / 2.0, 0.0)
    # winch drum and rope at the back, for cocking the arm
    p.append(_wheel("ct_drum", (0.0, 0.34, deck + 0.10), 0.08, 0.22, timber_l))
    p.append(geom.box("ct_pawl", (-0.02, 0.20, deck + 0.10), (0.04, 0.14, 0.03), iron))
    # a small pile of spare shot on the deck
    for i, (dx, dy) in enumerate([(0.13, 0.24), (0.19, 0.28), (0.16, 0.20)]):
        p.append(geom.cone(f"ct_spare_{i}", (dx, dy, deck), 0.05, 0.08, stone))

    # --- the throwing arm: stands up and back off the skein, cup at its head --
    arm_root = bpy.data.objects.new("ct_armroot", None)
    bpy.context.collection.objects.link(arm_root)
    arm_root.location = (0.0, 0.06, deck + 0.10)
    arm = geom.box("ct_arm", (-0.03, -0.03, 0.0), (0.06, 0.06, 0.66), timber_l)
    arm.parent = arm_root
    # an open cup (a capless cylinder) holding the stone at the arm's head
    cup = geom.cylinder("ct_cup", (0.0, 0.0, 0.62), 0.075, 0.07, rope, segments=10, cap=False)
    cup.parent = arm_root
    shot = geom.cone("ct_shot", (0.0, 0.0, 0.64), 0.058, 0.09, stone)
    shot.parent = arm_root
    objs += [arm, cup, shot]
    parts["swing"] = arm_root

    objs += p
    return _finish(objs, parts, "catapult")


def build_trebuchet():
    """The heavy engine: a tall A-frame, a long arm pivoting high, a great
    counterweight box at the short end and a sling at the long end. It rests
    loaded -- counterweight up -- and drops it to fling the stone. Parts: the
    arm swings. Modelled from Thomas's trebuchet reference."""
    timber_l = M.timber("TrebTimber")
    timber_d = M.timber("TrebBeam", dark=True)
    iron = M.iron()
    rope = M.cloth("TrebRope", colour=(0.62, 0.55, 0.38))
    stone = M.rough_stone("TrebShot")

    objs, parts = [], {}
    p = []
    deck = _frame_and_wheels(p, timber_d, iron, w=0.46, l=1.00)

    # a tall A-frame: four legs leaning in to a high pivot beam
    apex = deck + 0.94
    for sy in (-1, 1):
        for sx in (-1, 1):
            leg = geom.box(f"tb_leg_{sy}_{sx}", (sx * 0.20 - 0.03, sy * 0.26 - 0.03, deck),
                           (0.06, 0.06, 1.00), timber_d)
            leg.rotation_euler = (math.radians(sy * -14.0), math.radians(sx * 14.0), 0.0)
            p.append(leg)
    pivot = _beam("tb_pivot", (0.0, 0.0, apex), 0.34, 0.03, iron)
    pivot.rotation_euler = (0.0, math.pi / 2.0, 0.0)
    p.append(pivot)
    # a guide trough at the front where the sling is drawn, and a spare stone
    p.append(geom.box("tb_trough", (-0.07, -0.66, deck), (0.14, 0.52, 0.05), timber_d))
    p.append(geom.cone("tb_spare", (0.17, 0.40, deck), 0.06, 0.10, stone))

    # --- the throwing arm, pivoting high at the apex -------------------------
    arm_root = bpy.data.objects.new("tb_armroot", None)
    bpy.context.collection.objects.link(arm_root)
    arm_root.location = (0.0, 0.0, apex)
    # long arm along Y: long throwing end to -Y, short counterweight end to +Y
    arm = _beam("tb_arm", (0.0, -0.18, 0.0), 1.34, 0.034, timber_l)
    arm.parent = arm_root
    objs.append(arm)
    # the counterweight, hung at the short (+Y) end below the arm
    hanger = geom.box("tb_hanger", (-0.02, 0.44, -0.18), (0.04, 0.04, 0.18), iron)
    hanger.parent = arm_root
    counter = geom.box("tb_counter", (-0.12, 0.35, -0.38), (0.24, 0.22, 0.22), iron)
    counter.parent = arm_root
    objs += [hanger, counter]
    # the sling and its stone at the long (-Y) end
    sling = _beam("tb_sling", (0.0, -0.72, -0.08), 0.18, 0.006, rope)
    sling.parent = arm_root
    shot = geom.cone("tb_shot", (0.0, -0.82, -0.14), 0.062, 0.10, stone)
    shot.parent = arm_root
    objs += [sling, shot]
    parts["swing"] = arm_root

    objs += p
    return _finish(objs, parts, "trebuchet")


def build_fire_ballista():
    """
    A wheeled bow on a slanted stock, shooting burning bolts.

    The silhouette has to separate itself from the catapult at 45 px, and both
    are a wheeled frame with a stick on top. Two things do the work: the bow
    lies ACROSS the machine where the catapult's arm runs along it, and the
    bolts point up and forward in a sheaf. The flame pot says which of the two
    bolt-throwers this is.
    """
    timber_l = M.timber("BalTimber")
    timber_d = M.timber("BalBeam", dark=True)
    iron = M.iron()
    rope = M.cloth("BalRope", colour=(0.62, 0.55, 0.38))
    flame = _emissive("BalFlame", (1.0, 0.45, 0.10), 4.4)
    flame_hot = _emissive("BalFlameHot", (1.0, 0.70, 0.28), 5.6)

    objs, parts = [], {}
    p = []
    deck = _frame_and_wheels(p, timber_d, iron, w=0.36, l=0.72)

    # the stand the stock pivots on, an X seen from the side
    for sx in (-1, 1):
        leg = geom.box(f"fb_leg_{sx}", (sx * 0.14 - 0.03, -0.02, deck),
                       (0.06, 0.06, 0.30), timber_d)
        leg.rotation_euler = (math.radians(sx * 16.0), 0.0, 0.0)
        p.append(leg)
    p.append(_beam("fb_pivot", (0.0, 0.0, deck + 0.28), 0.34, 0.020, iron))
    p[-1].rotation_euler = (0.0, math.pi / 2.0, 0.0)
    # winch and a bundle of spare bolts on the deck
    p.append(_wheel("fb_winch", (0.0, 0.28, deck + 0.09), 0.065, 0.18, timber_l))
    for i in range(3):
        p.append(_beam(f"fb_spare_{i}", (-0.12 + i * 0.03, 0.22, deck + 0.03),
                       0.30, 0.010, timber_l))

    # --- the part that recoils -------------------------------------------
    root = bpy.data.objects.new("fb_stockroot", None)
    bpy.context.collection.objects.link(root)
    root.location = (0.0, 0.0, deck + 0.28)
    root.rotation_euler = (math.radians(-14.0), 0.0, 0.0)

    stock = _beam("fb_stock", (0.0, 0.02, 0.0), 0.58, 0.030, timber_l)
    stock.parent = root
    objs.append(stock)

    # the bow: two arms sweeping back from the front of the stock, string
    # between their tips. Across the machine, not along it.
    for sx in (-1, 1):
        arm = geom.box(f"fb_arm_{sx}", (0.0, 0.0, 0.0), (0.26, 0.035, 0.035), timber_d)
        arm.location = (0.0 if sx < 0 else 0.0, -0.24, 0.0)
        arm.rotation_euler = (0.0, 0.0, math.radians(sx * 20.0))
        arm.location = (sx * 0.02, -0.24, 0.0)
        arm.parent = root
        objs.append(arm)
        tip = geom.cylinder(f"fb_tip_{sx}", (sx * 0.27, -0.30, -0.015), 0.016, 0.05,
                            iron, segments=6)
        tip.parent = root
        objs.append(tip)
    string = geom.box("fb_string", (-0.27, -0.30, -0.004), (0.54, 0.010, 0.010), rope)
    string.parent = root
    objs.append(string)

    # three bolts in the groove, heads out front, burning
    for i, dx in enumerate((-0.035, 0.0, 0.035)):
        bolt = _beam(f"fb_bolt_{i}", (dx, -0.10, 0.028), 0.52, 0.011, timber_d)
        bolt.parent = root
        objs.append(bolt)
        head = geom.cone(f"fb_head_{i}", (dx, -0.36, 0.028), 0.026, 0.09, iron)
        head.rotation_euler = (-math.pi / 2.0, 0.0, 0.0)
        head.parent = root
        objs.append(head)
        # Two tongues per bolt, and larger than looked right in the viewport:
        # at 45 px a flame that is "the right size" is three pixels.
        for j, (r0, h0, mat) in enumerate(((0.055, 0.17, flame),
                                           (0.032, 0.12, flame_hot))):
            fire = geom.cone(f"fb_fire_{i}_{j}", (dx, -0.30, 0.028), r0, h0, mat)
            fire.rotation_euler = (-math.pi / 2.0, 0.0, 0.0)
            fire.parent = root
            objs.append(fire)

    parts["swing"] = root
    # Where it sits at rest. pose() restores this every frame, so the recoil
    # cannot accumulate across the six frames of the attack clip.
    parts["swing_home"] = tuple(root.location)
    parts["swing_rest"] = tuple(root.rotation_euler)

    # the fire pot the crew light them from
    p.append(geom.cylinder("fb_pot", (0.20, 0.30, deck), 0.055, 0.09, iron, segments=8))
    p.append(geom.cone("fb_potfire", (0.20, 0.30, deck + 0.09), 0.062, 0.16, flame))
    p.append(geom.cone("fb_potfire2", (0.20, 0.30, deck + 0.12), 0.036, 0.11, flame_hot))

    objs += p
    return _finish(objs, parts, "fire_ballista")


def _finish(objs, parts, name):
    """Centre on the origin, parent everything to a root, scale to size."""
    root = bpy.data.objects.new(f"{name}_root", None)
    bpy.context.collection.objects.link(root)
    for o in objs:
        if o.parent is None:
            o.parent = root
    root.scale = (SCALE / 0.62, SCALE / 0.62, SCALE / 0.62)
    parts["root"] = root
    return root, objs, parts


def pose(parts, clip, t):
    """Pose for phase `t` in 0..1."""
    swing, root = parts["swing"], parts["root"]
    swing.rotation_euler = parts.get("swing_rest", (0.0, 0.0, 0.0))
    if "swing_home" in parts:
        swing.location = parts["swing_home"]
    root.location.z = 0.0
    a = t * math.tau

    if clip.startswith("fire_ballista"):
        # A ballista recoils along its own axis; it does not swing. Snap back
        # hard on release and creep forward again, which is what makes it read
        # as a spring rather than a see-saw.
        hx, hy, hz = parts["swing_home"]
        rx = parts["swing_rest"][0]
        if clip.endswith("_attack"):
            if t < 0.15:
                k = t / 0.15                      # the shot
                swing.location = (hx, hy + 0.10 * k, hz)
                swing.rotation_euler = (rx - 0.09 * k, 0.0, 0.0)
            else:
                k = (t - 0.15) / 0.85             # winding back out
                swing.location = (hx, hy + 0.10 * (1.0 - k), hz)
                swing.rotation_euler = (rx - 0.09 * (1.0 - k), 0.0, 0.0)
        elif clip.endswith("_walk"):
            root.location.z = abs(math.sin(a)) * 0.012
        return

    if clip.startswith("catapult"):
        # A mangonel rests cocked WELL back off its skein, so the raised arm
        # reads as a catapult even when idle. It winds a touch further, then
        # whips forward through the crossbeam.
        rest = 56.0
        if clip.endswith("_attack"):
            if t < 0.55:
                ang = rest + 10.0 * (t / 0.55)            # wind back 56 -> 66
            else:
                ang = 66.0 - 96.0 * ((t - 0.55) / 0.45)   # whip forward 66 -> -30
            swing.rotation_euler = (math.radians(ang), 0.0, 0.0)
            root.location.z = math.sin(a) * 0.006
        elif clip.endswith("_walk"):
            root.location.z = abs(math.sin(a)) * 0.012
            swing.rotation_euler = (math.radians(rest) + math.sin(a) * 0.05, 0.0, 0.0)
        else:
            swing.rotation_euler = (math.radians(rest), 0.0, 0.0)
        return

    if clip.startswith("trebuchet"):
        # Rests LOADED -- counterweight up (+Y end high). On release the weight
        # drops through zero and the long arm whips up and over, then it winches
        # back to loaded. A big, slow, deliberate motion.
        rest = 40.0
        if clip.endswith("_attack"):
            if t < 0.25:
                ang = rest                                # poised, loaded
            elif t < 0.55:
                ang = rest - 118.0 * ((t - 0.25) / 0.30)  # weight drops: 40 -> -78
            else:
                ang = -78.0 + 118.0 * ((t - 0.55) / 0.45) # winched back: -78 -> 40
            swing.rotation_euler = (math.radians(ang), 0.0, 0.0)
            root.location.z = math.sin(a) * 0.004
        elif clip.endswith("_walk"):
            root.location.z = abs(math.sin(a)) * 0.012
            swing.rotation_euler = (math.radians(rest) + math.sin(a) * 0.04, 0.0, 0.0)
        else:
            swing.rotation_euler = (math.radians(rest), 0.0, 0.0)
        return

    if clip.endswith("_attack"):
        # The ram's log: wind back slowly, release fast. A symmetric swing reads
        # as a pendulum rather than a machine doing work.
        if t < 0.6:
            f = t / 0.6
            ang = math.radians(-6.0 - 52.0 * f)
        else:
            f = (t - 0.6) / 0.4
            ang = math.radians(-58.0 + 92.0 * f)
        swing.rotation_euler = (ang, 0.0, 0.0)
        root.location.z = math.sin(a) * 0.006
    elif clip.endswith("_walk"):
        # Nothing to animate but the jolt of a heavy frame over rough ground.
        root.location.z = abs(math.sin(a)) * 0.012
        swing.rotation_euler = (math.radians(-6.0) + math.sin(a) * 0.05, 0.0, 0.0)
    else:
        swing.rotation_euler = (math.radians(-6.0), 0.0, 0.0)


BUILDERS = {"ram": build_ram, "catapult": build_catapult,
            "trebuchet": build_trebuchet, "fire_ballista": build_fire_ballista}
