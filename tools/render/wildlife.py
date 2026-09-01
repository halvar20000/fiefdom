"""
Wild animals for the landscape.

A gazelle, built from primitives with its legs and neck as separate objects so
the renderer can pose them per frame. There is no armature and no imported
animation: a quadruped walk is four legs swinging in diagonal pairs, which is
a handful of Euler angles, and standing up a bone hierarchy to express that
would be more machinery than the motion needs.

Pivots matter here. geom.box puts the object origin at the box's minimum
corner, which for a leg is the hoof -- rotating about that swings the whole
animal's foot in a circle round the ground. `_limb` moves the mesh below its
origin instead, so the origin sits at the hip and the leg swings the way a leg
does.
"""

from __future__ import annotations
import math

import bpy
import geom
import materials as M

#: Shoulder height in tiles. A peasant is UNIT_HEIGHT_TILES = 0.52 tall, and a
#: gazelle that reads as an animal rather than a dog wants to be about 2/3 of
#: that at the shoulder with a notably longer body.
SHOULDER = 0.36

#: The model is built facing +Y. The peasant body faces -Y (Mixamo's export, and
#: what the shield on a swordsman's left arm confirms), so direction 0 here is
#: the OPPOSITE of direction 0 there -- half a turn out. The engine compensates
#: with GAZELLE_DIRECTION_OFFSET in main.ts rather than this number, so that the
#: gazelle sprites already on disk stay valid. Setting this to 180.0 and
#: re-rendering the herd would be the other half of the same fix; do not do one
#: without the other, or the herd walks backwards.
BASE_YAW_DEG = 0.0

#: Neck carried high when alert. POSITIVE rotates the +Y neck upward; a negative
#: angle here points it at the ground, which made the alert pose look like a
#: permanent graze and left the graze clip with nowhere to go.
NECK_UP = math.radians(34.0)

#: How far the neck drops to reach the grass.
NECK_GRAZE_SWING = math.radians(88.0)


def _hide(name="GazelleHide"):
    """Sandy flank. Desert map, so a fallow-deer brown would sit oddly."""
    mat, nt, bsdf = M._new(name)
    pos = M._pos(nt, 1.0)
    n = M._noise(nt, pos, scale=26.0, detail=6.0, roughness=0.6)
    ramp = M._ramp(nt, [
        (0.30, (0.44, 0.30, 0.16, 1.0)),
        (0.60, (0.60, 0.44, 0.25, 1.0)),
        (0.88, (0.72, 0.56, 0.34, 1.0)),
    ], n.outputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    M._set(bsdf, "Roughness", 0.85)
    return mat


def _limb(name, pivot, size, mat):
    """A box hanging BELOW its origin, so the origin is the joint."""
    w, d, h = size
    o = geom.box(name, (0.0, 0.0, 0.0), (w, d, h), mat)
    for v in o.data.vertices:
        v.co.x -= w / 2.0
        v.co.y -= d / 2.0
        v.co.z -= h
    o.location = pivot
    return o


def _forward(name, pivot, size, mat):
    """A box extending FORWARD (+Y) from its origin, for the neck."""
    w, d, h = size
    o = geom.box(name, (0.0, 0.0, 0.0), (w, d, h), mat)
    for v in o.data.vertices:
        v.co.x -= w / 2.0
        v.co.z -= h / 2.0
    o.location = pivot
    return o


def build_gazelle():
    """
    Returns (objects, parts).

    `parts` hands the renderer the handles it poses: four legs keyed by
    ('front'|'hind', 'left'|'right'), the neck, and the body for its bob.
    """
    hide = _hide()
    pale = M.cloth("GazelleBelly", colour=(0.86, 0.82, 0.74))
    horn = M.cloth("GazelleHorn", colour=(0.16, 0.13, 0.10))

    objs = []
    parts = {"legs": {}}

    # Long legs, shallow body, long neck. Built stockier than this it reads as
    # a crate on stumps -- the leg length carries the whole silhouette at 16 px.
    body_l, body_w, body_h = 0.42, 0.135, 0.145
    back_z = SHOULDER

    body = geom.box("gz_body", (-body_w / 2, -body_l / 2, back_z - body_h),
                    (body_w, body_l, body_h), hide)
    objs.append(body)
    parts["body"] = body

    belly = geom.box("gz_belly", (-body_w / 2 + 0.012, -body_l / 2 + 0.03,
                                  back_z - body_h - 0.018),
                     (body_w - 0.024, body_l - 0.06, 0.035), pale)
    objs.append(belly)

    rump = geom.box("gz_rump", (-body_w / 2 - 0.008, -body_l / 2 - 0.05,
                                back_z - body_h + 0.02),
                    (body_w + 0.016, 0.09, body_h - 0.02), hide)
    objs.append(rump)

    # neck and head pivot together at the shoulders
    neck = _forward("gz_neck", (0.0, body_l / 2 - 0.03, back_z - 0.015),
                    (0.072, 0.215, 0.072), hide)
    objs.append(neck)
    parts["neck"] = neck

    # head hangs off the neck's far end; parenting keeps it there when the neck
    # swings down to graze
    head = geom.box("gz_head", (-0.041, 0.185, -0.036), (0.082, 0.115, 0.072), hide)
    head.parent = neck
    objs.append(head)
    snout = geom.box("gz_snout", (-0.026, 0.295, -0.030), (0.052, 0.062, 0.048), pale)
    snout.parent = neck
    objs.append(snout)
    for i, sx in enumerate((-0.030, 0.030)):
        h = geom.box(f"gz_horn_{i}", (sx - 0.009, 0.198, 0.032), (0.018, 0.020, 0.165), horn)
        h.parent = neck
        objs.append(h)
        ear = geom.box(f"gz_ear_{i}", (sx - 0.030 if sx < 0 else sx + 0.012, 0.182, 0.012),
                       (0.019, 0.055, 0.028), hide)
        ear.parent = neck
        objs.append(ear)

    leg_h = back_z - body_h + 0.015
    for side, sx in (("left", -1), ("right", 1)):
        for end, sy in (("front", 1), ("hind", -1)):
            x = sx * (body_w / 2 - 0.030)
            y = sy * (body_l / 2 - 0.055)
            leg = _limb(f"gz_leg_{end}_{side}", (x, y, back_z - body_h + 0.015),
                        (0.030, 0.032, leg_h), hide)
            objs.append(leg)
            parts["legs"][(end, side)] = leg
            hoof = geom.box(f"gz_hoof_{end}_{side}", (-0.018, -0.019, -leg_h),
                            (0.036, 0.038, 0.026), horn)
            hoof.parent = leg
            objs.append(hoof)

    tail = _limb("gz_tail", (0.0, -body_l / 2 - 0.045, back_z - 0.02),
                 (0.030, 0.030, 0.10), hide)
    objs.append(tail)
    parts["tail"] = tail

    # Centre the animal on the origin. Built as written the nose reaches y=+0.56
    # and the rump only y=-0.28, so yawing it through eight facings would sweep
    # a 0.56 radius and every sprite would carry the empty margin that implies.
    for o in objs:
        if o.parent is None:
            o.location.y -= 0.14

    root = bpy.data.objects.new("gz_root", None)
    bpy.context.collection.objects.link(root)
    for o in objs:
        if o.parent is None:
            o.parent = root
    parts["root"] = root

    return root, objs, parts


#: frames per clip, mirroring the peasant's CLIPS table
CLIPS = {"gazelle_walk": 6, "gazelle_graze": 4, "gazelle_idle": 2}


def pose(parts, clip, t):
    """Pose the gazelle for phase `t` in 0..1 of `clip`."""
    legs = parts["legs"]
    neck, tail, root = parts["neck"], parts["tail"], parts["root"]

    for o in (*legs.values(), neck, tail):
        o.rotation_euler = (0.0, 0.0, 0.0)
    # Bob the ROOT, not the body: moving the body alone leaves the legs and
    # head behind and the animal comes apart at the shoulders.
    root.location.z = 0.0
    neck.rotation_euler = (NECK_UP, 0.0, 0.0)

    a = t * math.tau
    if clip == "gazelle_walk":
        swing = math.radians(26.0)
        # diagonal pairs, as a real quadruped walks -- same-side pairs read as
        # a pantomime horse even at this size
        phases = {("front", "left"): 0.0, ("hind", "right"): 0.0,
                  ("front", "right"): math.pi, ("hind", "left"): math.pi}
        for key, leg in legs.items():
            leg.rotation_euler = (math.sin(a + phases[key]) * swing, 0.0, 0.0)
        root.location.z = abs(math.sin(a)) * 0.012
        neck.rotation_euler = (NECK_UP + math.sin(a) * 0.05, 0.0, 0.0)
        tail.rotation_euler = (math.sin(a) * 0.18, 0.0, 0.0)

    elif clip == "gazelle_graze":
        # head down to the ground and back up: the pose that makes a static
        # herd look like it is doing something
        down = (1.0 - math.cos(a)) * 0.5           # 0 -> 1 -> 0
        neck.rotation_euler = (NECK_UP - down * NECK_GRAZE_SWING, 0.0, 0.0)
        tail.rotation_euler = (math.sin(a * 2.0) * 0.12, 0.0, 0.0)

    else:  # gazelle_idle
        neck.rotation_euler = (NECK_UP + math.sin(a) * 0.07, 0.0, 0.0)
        tail.rotation_euler = (math.sin(a) * 0.22, 0.0, 0.0)
