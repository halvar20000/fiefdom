"""
Wild animals for the landscape.

A gazelle, built from primitives with its legs, neck and head as separate
objects so the renderer can pose them per frame. There is no armature and no
imported animation: a quadruped walk is four legs swinging in diagonal pairs,
which is a handful of Euler angles, and standing up a bone hierarchy to express
that would be more machinery than the motion needs.

Pivots matter here. geom.box puts the object origin at the box's minimum
corner, which for a leg is the hoof -- rotating about that swings the whole
animal's foot in a circle round the ground. `_limb` moves the mesh below its
origin instead, so the origin sits at the hip and the leg swings the way a leg
does. `_forward` and `_upward` do the same for a neck and for a horn.

What the second cut of this animal changed, and why. The first was a slab on
four posts with a straight tube for a neck: the head had the same cross-section
as the neck it grew out of, so nothing anywhere in the silhouette said where
the neck ended and the animal began, and the horns read as a pair of aerials.
Three things fix that at thirty pixels, and none of them is detail:

* A BREAK IN THE LINE. The head sits across the end of the neck with the muzzle
  dropped below it -- the chess-knight arrangement the horse in mounts.py
  already uses -- so neck and head are two masses at an angle rather than one
  pole. The head is a posable part of its own for the same reason: a grazing
  animal's head hangs off the bottom of its neck, it does not continue it.
* MARKINGS, not geometry. A gazelle is legible in a photograph at any size
  because of the dark band along its flank, the white under it and the white
  rump -- and none of that costs a vertex in silhouette. This is by some way
  the largest of the three: an unmarked tan animal on tan ground is a blob at
  any polygon count.
* A BEND IN THE LEG. Two segments per leg with the hind pair folded at the
  hock. Four straight posts is the one thing that reads as furniture, and the
  hock is what makes the hindquarter look like it could push off.
"""

from __future__ import annotations
import math

import bpy
from mathutils import Vector

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
NECK_UP = math.radians(40.0)

#: How far the neck drops to reach the grass, and how far the head drops on top
#: of it. The head angle is not decoration: the neck alone is too short to put
#: the muzzle on the ground from a 0.36 shoulder, and a head that stays in line
#: with a lowered neck points its nose forward at the horizon anyway.
NECK_GRAZE_SWING = math.radians(94.0)
HEAD_GRAZE_DROP = math.radians(46.0)

#: Rest angles for the two leg segments, in degrees, measured from straight
#: down and positive forward. The front leg is near enough a post with the
#: shoulder raked back; the hind leg is the folded Z that every deer stands on.
_LEG_REST = {
    "front": (-7.0, 7.0),
    "hind": (22.0, -37.0),
}

_HOOF_H = 0.024


def _hide(name="GazelleHide"):
    """Sandy flank. Desert map, so a fallow-deer brown would sit oddly."""
    mat, nt, bsdf = M._new(name)
    pos = M._pos(nt, 1.0)
    n = M._noise(nt, pos, scale=26.0, detail=6.0, roughness=0.6)
    ramp = M._ramp(nt, [
        (0.30, (0.42, 0.28, 0.15, 1.0)),
        (0.60, (0.60, 0.43, 0.24, 1.0)),
        (0.88, (0.74, 0.57, 0.34, 1.0)),
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
    """A box extending FORWARD (+Y) from its origin, for a neck or a head."""
    w, d, h = size
    o = geom.box(name, (0.0, 0.0, 0.0), (w, d, h), mat)
    for v in o.data.vertices:
        v.co.x -= w / 2.0
        v.co.z -= h / 2.0
    o.location = pivot
    return o


def _upward(name, pivot, size, mat):
    """A box extending UP (+Z) from its origin, for a horn segment."""
    w, d, h = size
    o = geom.box(name, (0.0, 0.0, 0.0), (w, d, h), mat)
    for v in o.data.vertices:
        v.co.x -= w / 2.0
        v.co.y -= d / 2.0
    o.location = pivot
    return o


def _leg(objs, name, pivot, thigh_len, rest, mat, hoof_mat):
    """
    A two-segment leg standing on the ground, returned as (thigh, shank).

    The shank's LENGTH is solved rather than authored. The hoof has to sit on
    z = 0 whatever the rest angles are, and a hand-tuned length that happens to
    reach the ground at one pair of angles quietly stops reaching it the moment
    either angle is touched -- which is how an animal ends up walking on
    tiptoe, or ankle-deep in its own shadow.
    """
    thigh_deg, shank_deg = rest
    thigh_a = math.radians(thigh_deg)
    shank_a = math.radians(thigh_deg + shank_deg)      # the shank in world terms
    drop = pivot[2] - _HOOF_H - thigh_len * math.cos(thigh_a)
    shank_len = drop / math.cos(shank_a)

    thigh = _limb(f"{name}_thigh", pivot, (0.034, 0.040, thigh_len), mat)
    thigh.rotation_euler = (thigh_a, 0.0, 0.0)
    objs.append(thigh)

    shank = _limb(f"{name}_shank", (0.0, 0.0, -thigh_len),
                  (0.024, 0.028, shank_len), mat)
    shank.rotation_euler = (math.radians(shank_deg), 0.0, 0.0)
    shank.parent = thigh
    objs.append(shank)

    hoof = geom.box(f"{name}_hoof", (-0.016, -0.017, -shank_len - _HOOF_H),
                    (0.032, 0.034, _HOOF_H), hoof_mat)
    hoof.parent = shank
    objs.append(hoof)

    return thigh, shank


def _horn(objs, name, head, base, splay_deg, mat):
    """
    One horn: three short segments chained tip to base.

    Swept back and then eased forward again, which is the lyre a gazelle
    carries and is the whole reason the horns are three boxes and not one. A
    single upright spike is an aerial; the sweep is what says "horn" in the
    eight or nine pixels this occupies.
    """
    segs = ((0.052, 24.0), (0.048, 44.0), (0.040, 20.0))
    parent, loc, prev = head, base, 0.0
    for i, (length, lean) in enumerate(segs):
        seg = _upward(f"{name}_{i}", loc, (0.017, 0.018, length), mat)
        seg.rotation_euler = (math.radians(lean - prev), 0.0,
                              math.radians(splay_deg) if i == 0 else 0.0)
        seg.parent = parent
        objs.append(seg)
        parent, loc, prev = seg, (0.0, 0.0, length), lean


def build_gazelle():
    """
    Returns (root, objects, parts).

    `parts` hands the renderer the handles it poses: four legs keyed by
    ('front'|'hind', 'left'|'right'), each a (thigh, shank) pair, the neck, the
    head, the tail, and the root for its bob.
    """
    hide = _hide()
    pale = M.cloth("GazellePale", colour=(0.72, 0.68, 0.59))
    dark = M.cloth("GazelleDark", colour=(0.13, 0.10, 0.07))
    horn = M.cloth("GazelleHorn", colour=(0.19, 0.15, 0.12))

    objs = []
    parts = {"legs": {}}

    # Long legs, shallow body, long neck. Built stockier than this it reads as
    # a crate on stumps -- the leg length carries the whole silhouette at 16 px.
    body_l, body_w, body_h = 0.40, 0.128, 0.118
    back_z = SHOULDER
    belly_z = back_z - body_h

    body = geom.box("gz_body", (-body_w / 2, -body_l / 2, belly_z),
                    (body_w, body_l, body_h), hide)
    objs.append(body)
    parts["body"] = body

    # A brisket, so the front of the animal is not a cliff, and a haunch that
    # stands PROUD of the back line -- a gazelle is higher at the rump than at
    # the withers, and that rise is most of what tells it from a goat.
    objs.append(geom.box("gz_chest", (-body_w / 2 + 0.008, body_l / 2 - 0.105,
                                      belly_z - 0.026),
                         (body_w - 0.016, 0.110, 0.080), hide))
    objs.append(geom.box("gz_haunch", (-body_w / 2 - 0.007, -body_l / 2 - 0.058,
                                       belly_z + 0.012),
                         (body_w + 0.014, 0.095, body_h + 0.010), hide))
    # A narrower crown along the spine. The barrel is a box and its top edges
    # are the two hardest lines on the animal; a second, slimmer box standing
    # on it turns each of those into two soft steps instead, which at this size
    # is a rounded back. Cheaper than any amount of bevelling, and it survives
    # being three pixels tall.
    objs.append(geom.box("gz_spine", (-0.049, -body_l / 2 + 0.02, back_z - 0.006),
                         (0.098, body_l - 0.02, 0.020), hide))

    # The markings. Both bands are a hair wider than the body they sit on, so
    # they show on the flank the camera can see rather than z-fighting the hide
    # they are painted over.
    objs.append(geom.box("gz_stripe", (-body_w / 2 - 0.004, -body_l / 2 + 0.012,
                                       belly_z + 0.014),
                         (body_w + 0.008, body_l - 0.062, 0.036), dark))
    objs.append(geom.box("gz_belly", (-body_w / 2 - 0.002, -body_l / 2 + 0.030,
                                      belly_z - 0.002),
                         (body_w + 0.004, body_l - 0.090, 0.016), pale))
    # The white rump, wrapped over the top of the haunch as well as across the
    # back of it. The camera looks down at thirty degrees: a patch on the rear
    # face alone would vanish from half the facings.
    objs.append(geom.box("gz_rump", (-0.031, -body_l / 2 - 0.061, belly_z + 0.062),
                         (0.062, 0.022, 0.052), pale))
    objs.append(geom.box("gz_rump_top", (-0.028, -body_l / 2 - 0.050,
                                         belly_z + body_h + 0.008),
                         (0.056, 0.038, 0.008), pale))

    # Neck and head pivot at the shoulders; the head pivots again at the end of
    # the neck. Two joints rather than one is what lets the graze clip put the
    # muzzle on the ground with the head hanging off the neck instead of the
    # animal pointing at the grass like a compass needle.
    neck = _forward("gz_neck", (0.0, body_l / 2 - 0.026, back_z + 0.004),
                    (0.060, 0.168, 0.080), hide)
    objs.append(neck)
    parts["neck"] = neck

    head = _forward("gz_head", (0.0, 0.152, -0.008), (0.074, 0.104, 0.082), hide)
    head.parent = neck
    objs.append(head)
    parts["head"] = head

    # Muzzle dropped BELOW the head's line: the break that stops the whole
    # assembly reading as one straight pole from nose to rump.
    muzzle = _forward("gz_muzzle", (0.0, 0.094, -0.028), (0.046, 0.054, 0.038), pale)
    muzzle.parent = head
    objs.append(muzzle)
    nose = geom.box("gz_nose", (-0.020, 0.146, -0.044), (0.040, 0.016, 0.032), dark)
    nose.parent = head
    objs.append(nose)

    for i, sx in ((0, -1.0), (1, 1.0)):
        eye = geom.box(f"gz_eye_{i}", (sx * 0.037 - (0.010 if sx < 0 else 0.0),
                                       0.030, 0.006),
                       (0.010, 0.020, 0.016), dark)
        eye.parent = head
        objs.append(eye)

        ear = _forward(f"gz_ear_{i}", (sx * 0.032, 0.040, 0.020),
                       (0.014, 0.064, 0.030), hide)
        ear.rotation_euler = (math.radians(12.0), 0.0, math.radians(-sx * 58.0))
        ear.parent = head
        objs.append(ear)

        _horn(objs, f"gz_horn_{i}", head, (sx * 0.026, 0.022, 0.036),
              sx * 13.0, horn)

    hip_z = belly_z + 0.020
    for side, sx in (("left", -1), ("right", 1)):
        for end, sy in (("front", 1), ("hind", -1)):
            x = sx * (body_w / 2 - 0.028)
            y = sy * (body_l / 2 - 0.062)
            parts["legs"][(end, side)] = _leg(
                objs, f"gz_leg_{end}_{side}", (x, y, hip_z),
                0.112, _LEG_REST[end], hide, dark)

    # Black-tipped and carried down. The tail is the one part that is dark on
    # the top surface, which is what makes it findable from above.
    tail = _limb("gz_tail", (0.0, -body_l / 2 - 0.048, back_z - 0.012),
                 (0.026, 0.026, 0.090), dark)
    objs.append(tail)
    parts["tail"] = tail

    # Centre the animal on the origin. The nose reaches much further forward
    # than the rump reaches back, so yawing it through eight facings would
    # sweep a circle sized by the NOSE and every sprite would carry the empty
    # margin that implies. Measured rather than guessed: the offsets above have
    # been retuned once already, and a hand-written constant does not follow.
    bpy.context.view_layer.update()
    ys = [(o.matrix_world @ Vector(c)).y
          for o in objs if o.type == 'MESH' for c in o.bound_box]
    dy = -(min(ys) + max(ys)) / 2.0
    for o in objs:
        if o.parent is None:
            o.location.y += dy

    root = bpy.data.objects.new("gz_root", None)
    bpy.context.collection.objects.link(root)
    for o in objs:
        if o.parent is None:
            o.parent = root
    parts["root"] = root

    return root, objs, parts


#: clip -> (frames, cycle seconds), mirroring the peasant's CLIPS table.
#: Durations are what these already played at (old frames over ten fps), so
#: the extra frames buy smoothness without changing the gait's timing.
CLIPS = {"gazelle_walk": (10, 0.6), "gazelle_graze": (6, 0.4),
         "gazelle_idle": (4, 0.2)}


def _rest(parts):
    """Put every posable part back where the model was built."""
    for end, side in parts["legs"]:
        thigh, shank = parts["legs"][(end, side)]
        thigh_deg, shank_deg = _LEG_REST[end]
        thigh.rotation_euler = (math.radians(thigh_deg), 0.0, 0.0)
        shank.rotation_euler = (math.radians(shank_deg), 0.0, 0.0)
    parts["neck"].rotation_euler = (NECK_UP, 0.0, 0.0)
    parts["head"].rotation_euler = (0.0, 0.0, 0.0)
    parts["tail"].rotation_euler = (0.0, 0.0, 0.0)
    # Bob the ROOT, not the body: moving the body alone leaves the legs and
    # head behind and the animal comes apart at the shoulders.
    parts["root"].location.z = 0.0


def pose(parts, clip, t):
    """Pose the gazelle for phase `t` in 0..1 of `clip`."""
    _rest(parts)
    legs, neck, head = parts["legs"], parts["neck"], parts["head"]
    tail, root = parts["tail"], parts["root"]

    a = t * math.tau
    if clip == "gazelle_walk":
        swing = math.radians(26.0)
        flex = math.radians(30.0)
        # diagonal pairs, as a real quadruped walks -- same-side pairs read as
        # a pantomime horse even at this size
        phases = {("front", "left"): 0.0, ("hind", "right"): 0.0,
                  ("front", "right"): math.pi, ("hind", "left"): math.pi}
        for (end, side), (thigh, shank) in legs.items():
            p = a + phases[(end, side)]
            thigh_deg, shank_deg = _LEG_REST[end]
            thigh.rotation_euler = (math.radians(thigh_deg) + math.sin(p) * swing,
                                    0.0, 0.0)
            # The knee folds on the way FORWARD, when the foot is off the
            # ground, and straightens for the stance it pushes back through.
            shank.rotation_euler = (math.radians(shank_deg)
                                    - max(0.0, math.sin(p)) * flex, 0.0, 0.0)
        root.location.z = abs(math.sin(a)) * 0.012
        neck.rotation_euler = (NECK_UP + math.sin(a) * 0.05, 0.0, 0.0)
        head.rotation_euler = (-math.sin(a) * 0.04, 0.0, 0.0)
        tail.rotation_euler = (math.sin(a) * 0.18, 0.0, 0.0)

    elif clip == "gazelle_graze":
        # head down to the ground and back up: the pose that makes a static
        # herd look like it is doing something
        down = (1.0 - math.cos(a)) * 0.5           # 0 -> 1 -> 0
        neck.rotation_euler = (NECK_UP - down * NECK_GRAZE_SWING, 0.0, 0.0)
        head.rotation_euler = (-down * HEAD_GRAZE_DROP, 0.0, 0.0)
        # The shoulders dip with the head. Without it the neck is a couple of
        # centimetres short of the grass at full stretch and the animal mimes
        # eating just above it.
        root.location.z = -down * 0.022
        tail.rotation_euler = (math.sin(a * 2.0) * 0.12, 0.0, 0.0)

    else:  # gazelle_idle
        neck.rotation_euler = (NECK_UP + math.sin(a) * 0.07, 0.0, 0.0)
        head.rotation_euler = (math.sin(a) * 0.05, 0.0, 0.0)
        tail.rotation_euler = (math.sin(a) * 0.22, 0.0, 0.0)
