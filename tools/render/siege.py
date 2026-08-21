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

CLIPS = {
    "ram_idle": 1, "ram_walk": 4, "ram_attack": 6,
    "catapult_idle": 1, "catapult_walk": 4, "catapult_attack": 6,
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
    """Throwing arm on a heavy frame. Parts: the arm rotates."""
    timber_l = M.timber("CatTimber")
    timber_d = M.timber("CatBeam", dark=True)
    iron = M.iron()
    rope = M.cloth("CatRope", colour=(0.62, 0.55, 0.38))
    stone = M.rough_stone("CatShot")

    objs, parts = [], {}
    p = []
    deck = _frame_and_wheels(p, timber_d, iron, w=0.38, l=0.80)

    # A-frame the arm swings through
    for sx in (-1, 1):
        p.append(geom.box(f"ct_upright_{sx}", (sx * 0.16 - 0.03, -0.03, deck),
                          (0.06, 0.06, 0.34), timber_d))
    p.append(_beam("ct_cross", (0.0, 0.0, deck + 0.34), 0.40, 0.024, timber_d))
    p.append(_beam("ct_cross", (0.0, 0.0, deck + 0.34), 0.40, 0.024, timber_d))
    p[-1].rotation_euler = (0.0, math.pi / 2.0, 0.0)
    # winch drum at the back
    p.append(_wheel("ct_drum", (0.0, 0.30, deck + 0.10), 0.075, 0.20, timber_l))
    p.append(geom.box("ct_stop", (-0.13, -0.34, deck), (0.26, 0.05, 0.20), timber_d))
    # a spare shot on the deck
    p.append(geom.cone("ct_spare", (0.11, 0.26, deck), 0.055, 0.09, stone))

    arm_root = bpy.data.objects.new("ct_armroot", None)
    bpy.context.collection.objects.link(arm_root)
    arm_root.location = (0.0, 0.0, deck + 0.32)
    arm = _beam("ct_arm", (0.0, 0.14, 0.0), 0.62, 0.026, timber_l)
    arm.parent = arm_root
    bucket = geom.cylinder("ct_bucket", (0.0, 0.0, 0.0), 0.072, 0.055, rope, segments=10)
    bucket.location = (0.0, 0.44, -0.01)
    bucket.parent = arm_root
    shot = geom.cone("ct_shot", (0.0, 0.0, 0.0), 0.052, 0.085, stone)
    shot.location = (0.0, 0.44, 0.03)
    shot.parent = arm_root
    counter = geom.box("ct_counter", (-0.055, -0.36, -0.06), (0.11, 0.12, 0.11), iron)
    counter.parent = arm_root
    objs += [arm, bucket, shot, counter]
    parts["swing"] = arm_root

    objs += p
    return _finish(objs, parts, "catapult")


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
    swing.rotation_euler = (0.0, 0.0, 0.0)
    root.location.z = 0.0
    a = t * math.tau

    if clip.endswith("_attack"):
        # Wind back slowly, release fast. A symmetric swing reads as a pendulum
        # rather than a machine doing work.
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


BUILDERS = {"ram": build_ram, "catapult": build_catapult}
