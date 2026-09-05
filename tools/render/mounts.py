"""
The bodies that are not a man on the Mixamo rig: a horse, a dog, and the
draught ox that hauls stone off a quarry.

Why this file exists at all. Every soldier so far is `peasant.build` on the
Mixamo skeleton, which is a superb deal -- palette and kit are the only
difference between a spearman and a swordsman, and the animation comes free.
It buys nothing here. There is no horse in the Mixamo set and no dog, and
retargeting a biped's walk onto four legs is not a thing that works.

So these are built the way the gazelle and the siege engines are: primitives
with a handful of parts posed per frame from a phase in 0..1, no armature at
all. A quadruped walk is four legs swinging in diagonal pairs, which is a few
Euler angles; standing up a bone hierarchy to express that would be more
machinery than the motion needs.

Two conventions matter, and both are load-bearing:

* Everything here is authored facing +Y and the renderer turns it half a turn
  (BASE_YAW_DEG = 180). The Mixamo body faces -Y, and a mounted unit is drawn
  through the SAME code path as a foot soldier -- same `${type}_${clip}`
  keys, same direction index -- so facing 0 has to mean the same thing for
  both or the cavalry rides backwards. The gazelle predates that rule and
  compensates in main.ts instead; do not copy it.
* The rider is part of the mount. He is not a peasant standing on a horse: he
  is boxes and cylinders in the same mesh, posed by the same table, because
  the one thing a rider must never do is slide about on the saddle.
"""

from __future__ import annotations
import math

import bpy
from mathutils import Vector

import geom
import materials as M

#: Withers height, in tiles. A man is UNIT_HEIGHT_TILES = 0.52; a horse's back
#: at 0.44 puts a mounted man's head near 0.80, which is half again a
#: footman's -- about right, and it is what makes cavalry findable in a crowd.
HORSE_BACK = 0.44

#: Shoulder height of a war dog. Deliberately well under the gazelle's 0.36:
#: at this size the two animals differ mostly by how low and long they are.
DOG_SHOULDER = 0.21

#: Withers height of the draught ox. Lower than the horse's back at 0.44 and a
#: good deal wider: at sprite size the two must not be mistaken for each other,
#: and an ox reads as an ox by being heavy and low with a hump over the
#: shoulders, not by any amount of detail on its head.
OX_BACK = 0.38

#: See the module docstring. Authored facing +Y, drawn facing -Y.
BASE_YAW_DEG = 180.0


def _limb(name, pivot, size, mat):
    """A box hanging BELOW its origin, so the origin is the joint it swings on.

    geom.box puts the origin at the minimum corner, which for a leg is the
    hoof -- rotating about that swings the whole animal's foot in a circle
    round the ground. Same trick as wildlife._limb, and for the same reason.
    """
    w, d, h = size
    o = geom.box(name, (0.0, 0.0, 0.0), (w, d, h), mat)
    for v in o.data.vertices:
        v.co.x -= w / 2.0
        v.co.y -= d / 2.0
        v.co.z -= h
    o.location = pivot
    return o


def _forward(name, pivot, size, mat):
    """A box extending FORWARD (+Y) from its origin, for a neck."""
    w, d, h = size
    o = geom.box(name, (0.0, 0.0, 0.0), (w, d, h), mat)
    for v in o.data.vertices:
        v.co.x -= w / 2.0
        v.co.z -= h / 2.0
    o.location = pivot
    return o


def _hide(name, colour):
    """A coat with some grain in it, so a flank is not a flat slab."""
    mat, nt, bsdf = M._new(name)
    pos = M._pos(nt, 1.0)
    n = M._noise(nt, pos, scale=30.0, detail=5.0, roughness=0.6)
    lo = tuple(c * 0.78 for c in colour)
    hi = tuple(min(1.0, c * 1.16) for c in colour)
    ramp = M._ramp(nt, [(0.32, (*lo, 1.0)), (0.70, (*colour, 1.0)), (0.92, (*hi, 1.0))],
                   n.outputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    M._set(bsdf, "Roughness", 0.86)
    return mat


def _rider(objs, parts, palette, kit, seat_z):
    """
    Put a man on the back at `seat_z`. Returns nothing; appends to objs/parts.

    Built astride rather than standing: the thighs go out and down over the
    barrel, so the silhouette from every facing is a wide-hipped figure sitting
    IN something rather than a figure floating above it. That reads at ninety
    pixels; a correctly proportioned seated man does not.
    """
    tunic = M.cloth("RiderTunic", colour=palette['tunic'])
    hood = M.cloth("RiderHood", colour=palette['hood'])
    skin, _, bsdf = M._new("RiderSkin")
    M._set(bsdf, "Base Color", (0.52, 0.36, 0.25, 1.0))
    M._set(bsdf, "Roughness", 0.74)
    steel = M.iron()
    haft = M.timber("RiderHaft", dark=True)

    torso = geom.box("rd_torso", (-0.075, -0.055, seat_z), (0.15, 0.13, 0.20), tunic)
    objs.append(torso)
    parts["torso"] = torso

    objs.append(geom.box("rd_head", (-0.055, -0.038, seat_z + 0.20),
                         (0.11, 0.10, 0.10), skin))
    if kit.get('helmet'):
        objs.append(geom.box("rd_helm", (-0.062, -0.045, seat_z + 0.245),
                             (0.124, 0.114, 0.062), steel))
    else:
        objs.append(geom.box("rd_hood", (-0.062, -0.045, seat_z + 0.245),
                             (0.124, 0.114, 0.058), hood))

    # Thighs over the barrel, shins hanging down its sides.
    for i, sx in enumerate((-1, 1)):
        objs.append(geom.box(f"rd_thigh_{i}", (sx * 0.075 - 0.032, -0.05, seat_z - 0.035),
                             (0.064, 0.20, 0.070), hood))
        objs.append(geom.box(f"rd_shin_{i}", (sx * 0.098 - 0.028, 0.03, seat_z - 0.155),
                             (0.056, 0.070, 0.130), hood))

    # The rein arm is fixed; the weapon arm is a separate object so a blow can
    # be swung without animating the man.
    objs.append(geom.box("rd_arm_l", (-0.115, -0.030, seat_z + 0.095),
                         (0.048, 0.056, 0.115), tunic))
    arm = _limb("rd_arm_r", (0.098, -0.010, seat_z + 0.185),
                (0.048, 0.056, 0.125), tunic)
    objs.append(arm)
    parts["arm"] = arm

    weapon = kit.get('weapon')
    if weapon == 'lance':
        # A lance, not a sword. A sword in a rider's hand hangs at the level of
        # the horse's barrel and is inside the animal from four facings out of
        # eight -- rendered, checked, and unusable. A lance is carried FORWARD,
        # clear of everything, and there is nothing else on the field shaped
        # remotely like it.
        shaft = geom.box("rd_lance", (-0.014, -0.10, -0.115),
                         (0.028, 0.74, 0.028), haft)
        shaft.parent = arm
        objs.append(shaft)
        tip = geom.box("rd_lancetip", (-0.020, 0.60, -0.121),
                       (0.040, 0.10, 0.040), steel)
        tip.parent = arm
        objs.append(tip)
        grip = geom.box("rd_lancegrip", (-0.022, -0.045, -0.123),
                        (0.044, 0.075, 0.044), steel)
        grip.parent = arm
        objs.append(grip)
    elif weapon == 'bow':
        # Across the front of the rider at chest height, standing UP in the
        # plane of the body -- a bow held the way a bow is held. Built as an
        # arc of short segments, the same three-lines-make-a-curve trick the
        # foot archer's bow uses.
        n = 7
        for i in range(n):
            a0 = math.pi * (-0.42 + 0.84 * (i / n))
            a1 = math.pi * (-0.42 + 0.84 * ((i + 1) / n))
            r = 0.135
            z0, y0 = math.cos(a0) * r, math.sin(a0) * r * 0.32
            z1, y1 = math.cos(a1) * r, math.sin(a1) * r * 0.32
            seg = geom.box(f"rd_bow_{i}",
                           (-0.012, min(y0, y1) + 0.055, min(z0, z1) - 0.075),
                           (0.024, abs(y1 - y0) + 0.020, abs(z1 - z0) + 0.020), haft)
            seg.parent = arm
            objs.append(seg)
        # A quiver on his back, because the bow alone is a thin arc and the
        # quiver is a solid block of the same idea.
        objs.append(geom.box("rd_quiver", (-0.085, -0.085, seat_z + 0.055),
                             (0.055, 0.055, 0.155), hood))


def build_horse(kind):
    """
    A horse with a man on it. `kind` is 'knight' or 'horse_archer'.

    Returns (root, objects, parts).
    """
    if kind == "knight":
        coat = _hide("KnightHorse", (0.30, 0.24, 0.20))
        cloth = M.cloth("KnightBard", colour=(0.52, 0.16, 0.15))
        palette = {'tunic': (0.60, 0.61, 0.63), 'hood': (0.34, 0.33, 0.34)}
        kit = {'helmet': True, 'weapon': 'lance'}
    else:
        coat = _hide("ArcherHorse", (0.56, 0.44, 0.28))
        cloth = M.cloth("ArcherBlanket", colour=(0.36, 0.42, 0.30))
        palette = {'tunic': (0.80, 0.76, 0.64), 'hood': (0.30, 0.27, 0.24)}
        kit = {'weapon': 'bow'}
    dark = M.cloth("HorseMane", colour=(0.13, 0.11, 0.09))
    hoof = M.cloth("HorseHoof", colour=(0.16, 0.14, 0.12))

    objs = []
    parts = {"legs": {}}

    body_l, body_w, body_h = 0.60, 0.17, 0.19
    back_z = HORSE_BACK

    body = geom.box("ho_body", (-body_w / 2, -body_l / 2, back_z - body_h),
                    (body_w, body_l, body_h), coat)
    objs.append(body)
    parts["body"] = body
    # A rump, so the animal has a hindquarter rather than ending in a wall.
    objs.append(geom.box("ho_rump", (-body_w / 2 - 0.010, -body_l / 2 - 0.075,
                                     back_z - body_h + 0.03),
                         (body_w + 0.020, 0.11, body_h - 0.03), coat))
    # The caparison: the one flash of the owner's colour on the animal, and
    # what tells a knight's horse from a mercenary's at a glance.
    objs.append(geom.box("ho_bard", (-body_w / 2 - 0.014, -0.16, back_z - body_h - 0.02),
                         (body_w + 0.028, 0.30, 0.13), cloth))

    # Chest, so the front of the animal is not a cliff.
    objs.append(geom.box("ho_chest", (-body_w / 2 + 0.006, body_l / 2 - 0.10,
                                      back_z - body_h - 0.045),
                         (body_w - 0.012, 0.11, body_h * 0.55), coat))

    # Neck and head, pivoting at the withers so a walk can nod them.
    #
    # SHORT and thick. The first cut had a 0.24 neck on a 0.56 body and the two
    # of them together came back as a plank sticking out of a table: at this
    # size the neck is not a feature in its own right, it is the ramp between
    # the withers and a head that has to be big enough to be a head.
    neck = _forward("ho_neck", (0.0, body_l / 2 - 0.045, back_z - 0.015),
                    (0.098, 0.165, 0.125), coat)
    neck.rotation_euler = (math.radians(46.0), 0.0, 0.0)
    objs.append(neck)
    parts["neck"] = neck
    # The head continues the neck's line, chess-knight fashion, with the muzzle
    # dropped below it -- which is what stops the whole assembly reading as one
    # straight pole.
    head = geom.box("ho_head", (-0.052, 0.130, -0.062), (0.104, 0.150, 0.115), coat)
    head.parent = neck
    objs.append(head)
    muzzle = geom.box("ho_muzzle", (-0.040, 0.215, -0.115), (0.080, 0.105, 0.080), dark)
    muzzle.parent = neck
    objs.append(muzzle)
    mane = geom.box("ho_mane", (-0.026, -0.010, 0.052), (0.052, 0.185, 0.052), dark)
    mane.parent = neck
    objs.append(mane)
    for i, sx in enumerate((-0.038, 0.038)):
        ear = geom.box(f"ho_ear_{i}", (sx - 0.013, 0.150, 0.052), (0.026, 0.032, 0.052), coat)
        ear.parent = neck
        objs.append(ear)

    leg_h = back_z - body_h + 0.02
    for side, sx in (("left", -1), ("right", 1)):
        for end, sy in (("front", 1), ("hind", -1)):
            x = sx * (body_w / 2 - 0.030)
            y = sy * (body_l / 2 - 0.085)
            leg = _limb(f"ho_leg_{end}_{side}", (x, y, back_z - body_h + 0.02),
                        (0.048, 0.052, leg_h), coat)
            objs.append(leg)
            parts["legs"][(end, side)] = leg
            h = geom.box(f"ho_hoof_{end}_{side}", (-0.028, -0.030, -leg_h),
                         (0.056, 0.060, 0.032), hoof)
            h.parent = leg
            objs.append(h)

    tail = _limb("ho_tail", (0.0, -body_l / 2 - 0.085, back_z - 0.02),
                 (0.050, 0.050, 0.20), dark)
    objs.append(tail)
    parts["tail"] = tail

    _rider(objs, parts, palette, kit, back_z + 0.02)

    return _finish(objs, parts, dy=-0.10)


def build_war_dog():
    """A low, long, dark thing. Returns (root, objects, parts)."""
    coat = _hide("DogCoat", (0.24, 0.20, 0.17))
    pale = M.cloth("DogBelly", colour=(0.42, 0.36, 0.29))
    dark = M.cloth("DogMuzzle", colour=(0.10, 0.09, 0.08))

    objs = []
    parts = {"legs": {}}

    body_l, body_w, body_h = 0.34, 0.115, 0.115
    back_z = DOG_SHOULDER

    body = geom.box("dg_body", (-body_w / 2, -body_l / 2, back_z - body_h),
                    (body_w, body_l, body_h), coat)
    objs.append(body)
    parts["body"] = body
    objs.append(geom.box("dg_belly", (-body_w / 2 + 0.012, -body_l / 2 + 0.03,
                                      back_z - body_h - 0.012),
                         (body_w - 0.024, body_l - 0.06, 0.028), pale))
    objs.append(geom.box("dg_haunch", (-body_w / 2 - 0.010, -body_l / 2 - 0.045,
                                       back_z - body_h + 0.012),
                         (body_w + 0.020, 0.075, body_h - 0.012), coat))

    # Head carried LOW and forward -- a dog running at something does not hold
    # its head up like a deer, and that difference is the whole silhouette.
    neck = _forward("dg_neck", (0.0, body_l / 2 - 0.02, back_z - 0.030),
                    (0.070, 0.085, 0.072), coat)
    neck.rotation_euler = (math.radians(-6.0), 0.0, 0.0)
    objs.append(neck)
    parts["neck"] = neck
    head = geom.box("dg_head", (-0.040, 0.070, -0.038), (0.080, 0.085, 0.076), coat)
    head.parent = neck
    objs.append(head)
    snout = geom.box("dg_snout", (-0.026, 0.145, -0.034), (0.052, 0.062, 0.046), dark)
    snout.parent = neck
    objs.append(snout)
    for i, sx in enumerate((-0.032, 0.032)):
        ear = geom.box(f"dg_ear_{i}", (sx - 0.011, 0.076, 0.034),
                       (0.022, 0.026, 0.042), coat)
        ear.parent = neck
        objs.append(ear)

    leg_h = back_z - body_h + 0.012
    for side, sx in (("left", -1), ("right", 1)):
        for end, sy in (("front", 1), ("hind", -1)):
            x = sx * (body_w / 2 - 0.026)
            y = sy * (body_l / 2 - 0.048)
            leg = _limb(f"dg_leg_{end}_{side}", (x, y, back_z - body_h + 0.012),
                        (0.030, 0.032, leg_h), coat)
            objs.append(leg)
            parts["legs"][(end, side)] = leg

    tail = _limb("dg_tail", (0.0, -body_l / 2 - 0.050, back_z - 0.010),
                 (0.026, 0.026, 0.105), coat)
    tail.rotation_euler = (math.radians(-40.0), 0.0, 0.0)
    objs.append(tail)
    parts["tail"] = tail

    return _finish(objs, parts, dy=-0.03)


def build_ox():
    """
    The draught ox, in harness, dragging a stone sledge. Returns (root, objs, parts).

    This is a UNIT and not a prop, which is the whole point of it: the ox
    tether used to be a building with an ox baked into its sprite standing at
    a post forever, while the quarrymen carried the stone themselves. The
    animal now walks the haul, so it has to be posable, and the sledge has to
    come with it -- an ox that arrives at the stockpile and puts down a block
    it was not visibly dragging is worse than no ox at all.

    Three things carry it at sprite size, and the first cut of this model got
    all three wrong -- a deep body on stubby legs, a head tucked into the
    chest and a sledge parked against the rump read as a brown lump with a
    crate beside it:

    * DAYLIGHT UNDER THE ANIMAL. The body is shallower than a horse's and the
      legs are longer than they look like they should be. A quadruped whose
      belly is close to the ground is a pig.
    * THE HEAD HELD OUT. Neck forward and level, with the horns swept wide and
      raised. Sideways is what survives from the facings where the head points
      at the camera, and the horns are the one thing on the silhouette that is
      not shared with every other animal in the game.
    * SHAFTS AND A GAP. The sledge trails a clear stride behind, with two
      shafts running up the flanks to the yoke. The gap is what makes it a
      thing being towed rather than a thing standing next to an ox.
    """
    hide = _hide("OxHide", (0.30, 0.19, 0.12))
    dark = M.cloth("OxDark", colour=(0.12, 0.10, 0.08))
    pale = M.cloth("OxMuzzle", colour=(0.62, 0.55, 0.45))
    horn = M.cloth("OxHorn", colour=(0.78, 0.73, 0.60))
    timber = M.timber(dark=True)
    stone = M.castle_stone()

    objs = []
    parts = {"legs": {}}

    body_l, body_w, body_h = 0.42, 0.175, 0.165
    back_z = 0.40

    body = geom.box("ox_body", (-body_w / 2, -body_l / 2, back_z - body_h),
                    (body_w, body_l, body_h), hide)
    objs.append(body)
    parts["body"] = body
    # The hump over the shoulders, standing proud of the back line. Without it
    # an ox is a brown horse, and the game already has brown horses.
    objs.append(geom.box("ox_hump", (-body_w / 2 + 0.028, body_l / 2 - 0.165,
                                     back_z - 0.010),
                         (body_w - 0.056, 0.135, 0.070), hide))
    # Rump and brisket, so neither end of the animal is a wall.
    objs.append(geom.box("ox_rump", (-body_w / 2 - 0.008, -body_l / 2 - 0.050,
                                     back_z - body_h + 0.026),
                         (body_w + 0.016, 0.080, body_h - 0.038), hide))
    objs.append(geom.box("ox_chest", (-body_w / 2 + 0.006, body_l / 2 - 0.080,
                                      back_z - body_h - 0.022),
                         (body_w - 0.012, 0.090, body_h * 0.60), hide))

    # Neck carried FORWARD and level, not tucked. An ox in draught reaches
    # into the yoke; a head sunk into the chest reads as a bull about to
    # charge, which is the wrong animal doing the wrong job.
    neck = _forward("ox_neck", (0.0, body_l / 2 - 0.020, back_z - 0.048),
                    (0.098, 0.150, 0.100), hide)
    neck.rotation_euler = (math.radians(-6.0), 0.0, 0.0)
    objs.append(neck)
    parts["neck"] = neck

    head = geom.box("ox_head", (-0.055, 0.115, -0.055), (0.110, 0.130, 0.100), hide)
    head.parent = neck
    objs.append(head)
    muzzle = geom.box("ox_muzzle", (-0.040, 0.222, -0.062), (0.080, 0.060, 0.058), pale)
    muzzle.parent = neck
    objs.append(muzzle)
    # A pale blaze down the face. Markings, not geometry: the cheapest thing
    # that says which end of a brown animal is the front.
    blaze = geom.box("ox_blaze", (-0.020, 0.150, 0.030), (0.040, 0.100, 0.020), pale)
    blaze.parent = neck
    objs.append(blaze)
    for i, sx in enumerate((-1.0, 1.0)):
        # Built with `_forward` and swung, rather than laid out along X and
        # tilted: `geom.box` turns about its minimum corner, so a horn posed
        # that way slides as much as it rotates. Pitched up first and then
        # swept out, which is the order Blender's XYZ euler applies.
        h = _forward(f"ox_horn_{i}", (sx * 0.046, 0.128, 0.044),
                     (0.028, 0.105, 0.026), horn)
        h.rotation_euler = (math.radians(20.0), 0.0, math.radians(sx * 74.0))
        h.parent = neck
        objs.append(h)
        ear = geom.box(f"ox_ear_{i}", (sx * 0.056 - 0.012, 0.098, 0.010),
                       (0.026, 0.040, 0.020), hide)
        ear.parent = neck
        objs.append(ear)
    # The yoke across the shoulders, in front of the hump so it is not buried
    # in it. This is the part that says the animal is working.
    objs.append(geom.box("ox_yoke", (-0.108, body_l / 2 - 0.045, back_z + 0.006),
                         (0.216, 0.048, 0.030), timber))

    # Legs: long enough to put daylight under the belly, thick enough to be an
    # ox's. `leg_h` is the drop from the shoulder joint to the ground.
    leg_h = back_z - body_h + 0.012
    for side, sx in (("left", -1), ("right", 1)):
        for end, sy in (("front", 1), ("hind", -1)):
            x = sx * (body_w / 2 - 0.030)
            y = sy * (body_l / 2 - 0.062)
            leg = _limb(f"ox_leg_{end}_{side}", (x, y, back_z - body_h + 0.012),
                        (0.048, 0.050, leg_h), hide)
            objs.append(leg)
            parts["legs"][(end, side)] = leg
            hoof = geom.box(f"ox_hoof_{end}_{side}", (-0.028, -0.030, -leg_h),
                            (0.056, 0.060, 0.028), dark)
            hoof.parent = leg
            objs.append(hoof)

    tail = _limb("ox_tail", (0.0, -body_l / 2 - 0.052, back_z - 0.018),
                 (0.026, 0.026, 0.150), hide)
    objs.append(tail)
    parts["tail"] = tail
    tuft = geom.box("ox_tail_tuft", (-0.019, -0.019, -0.150), (0.038, 0.038, 0.046), dark)
    tuft.parent = tail
    objs.append(tuft)

    # --- the sledge --------------------------------------------------------
    # Its own empty parent, so a walk can let it yaw a fraction behind the
    # animal pulling it rather than tracking as if it were welded to the rump.
    sledge = bpy.data.objects.new("ox_sledge", None)
    bpy.context.collection.objects.link(sledge)
    sledge.location = (0.0, -body_l / 2 - 0.145, 0.0)
    objs.append(sledge)
    parts["sledge"] = sledge

    for i, sx in ((0, -1.0), (1, 1.0)):
        runner = geom.box(f"ox_runner_{i}", (sx * 0.082 - 0.020, -0.250, 0.0),
                          (0.040, 0.270, 0.026), timber)
        runner.parent = sledge
        objs.append(runner)
    bed = geom.box("ox_bed", (-0.102, -0.235, 0.026), (0.204, 0.225, 0.026), timber)
    bed.parent = sledge
    objs.append(bed)
    # The shafts: up the flanks from the sledge's nose to the yoke. Long,
    # straight and outboard of the body, so they read as a connection rather
    # than disappearing into the animal.
    for i, sx in ((0, -1.0), (1, 1.0)):
        # Rise and run measured to the yoke: 0.555 forward, 0.38 up, which is
        # 34 degrees and a 0.67 bar. A shaft that stops short of the yoke is
        # a stick lying on the ox, not a harness. Positive rotation about X
        # lifts the far end -- the first cut used a negative angle and buried
        # both shafts under the ground.
        #
        # Set WELL outboard of the body, not just clear of it. At 0.108 the
        # pair was a couple of centimetres wider than the flank, which from a
        # thirty-degree camera drew a bar straight across the animal instead
        # of one down each side of it.
        shaft = geom.box(f"ox_shaft_{i}", (sx * 0.140 - 0.010, 0.0, 0.028),
                         (0.020, 0.670, 0.020), timber)
        shaft.rotation_euler = (math.radians(34.0), 0.0, 0.0)
        shaft.parent = sledge
        objs.append(shaft)

    # The load. Hidden for the empty walk home -- see `pose`.
    load = geom.box("ox_load", (-0.082, -0.215, 0.052), (0.164, 0.185, 0.120), stone)
    load.parent = sledge
    objs.append(load)
    parts["load"] = load

    # Centre the team on the point it stands on, MEASURED rather than guessed:
    # the sledge reaches much further back than the nose reaches forward, so
    # yawing it through eight facings would otherwise sweep a circle sized by
    # the sledge and every sprite would carry that much empty air.
    bpy.context.view_layer.update()
    ys = [(o.matrix_world @ Vector(c)).y
          for o in objs if o.type == 'MESH' for c in o.bound_box]
    return _finish(objs, parts, dy=-(min(ys) + max(ys)) / 2.0)


def _finish(objs, parts, dy):
    """Centre on the origin and parent everything to a root.

    Built as written, a head reaches much further forward than a rump reaches
    back, so yawing through eight facings sweeps a circle sized by the NOSE and
    every sprite carries the empty margin that implies. `dy` slides the animal
    back until it is roughly centred on the point it stands on.
    """
    for o in objs:
        if o.parent is None:
            o.location.y += dy
    root = bpy.data.objects.new("mount_root", None)
    bpy.context.collection.objects.link(root)
    for o in objs:
        if o.parent is None:
            o.parent = root
    parts["root"] = root
    return root, objs, parts


#: clip -> (frames, cycle seconds). Same shape as the gazelle's and the siege
#: engines'. Three clips only, because the army draw loop asks for idle, walk
#: and attack and there is no fourth case.
CLIPS = {
    "knight_idle": (4, 0.5), "knight_walk": (10, 0.5), "knight_attack": (8, 0.6),
    "horse_archer_idle": (4, 0.5), "horse_archer_walk": (10, 0.5),
    "horse_archer_attack": (8, 0.7),
    "war_dog_idle": (4, 0.5), "war_dog_walk": (8, 0.35), "war_dog_attack": (6, 0.5),
    # The ox has no attack and never will. It has the pair every hauler needs:
    # the loaded plod out to the stockpile and the empty walk home, which is
    # the same distinction the peasants' `carry` and `walk` draw.
    "ox_idle": (4, 0.6), "ox_walk": (8, 0.62), "ox_haul": (8, 0.78),
}

BUILDERS = {
    "knight": lambda: build_horse("knight"),
    "horse_archer": lambda: build_horse("horse_archer"),
    "war_dog": build_war_dog,
    "ox": build_ox,
}

#: Resting angles, per body, so `pose` can put everything back before it moves.
_NECK_REST = {"knight": 38.0, "horse_archer": 38.0, "war_dog": -6.0, "ox": -4.0}
_TAIL_REST = {"knight": 0.0, "horse_archer": 0.0, "war_dog": -40.0, "ox": 0.0}


def pose(kind, parts, clip, t):
    """Pose body `kind` for phase `t` in 0..1 of `clip`."""
    legs, neck, tail, root = parts["legs"], parts["neck"], parts["tail"], parts["root"]
    arm = parts.get("arm")
    sledge, load = parts.get("sledge"), parts.get("load")

    # The block rides the sledge on the way to the stockpile and not on the
    # way back. It is the only difference between the two ox clips and it is
    # the one the player actually reads: a loaded sledge means stone is
    # moving.
    if load is not None:
        load.hide_render = clip != "ox_haul"
    if sledge is not None:
        sledge.rotation_euler = (0.0, 0.0, 0.0)

    for o in legs.values():
        o.rotation_euler = (0.0, 0.0, 0.0)
    neck.rotation_euler = (math.radians(_NECK_REST[kind]), 0.0, 0.0)
    tail.rotation_euler = (math.radians(_TAIL_REST[kind]), 0.0, 0.0)
    if arm:
        arm.rotation_euler = (0.0, 0.0, 0.0)
    root.location.z = 0.0
    root.rotation_euler = (0.0, 0.0, root.rotation_euler.z)

    a = t * math.tau
    # Diagonal pairs, as a real quadruped moves. Same-side pairs read as a
    # pantomime horse even at this size.
    phases = {("front", "left"): 0.0, ("hind", "right"): 0.0,
              ("front", "right"): math.pi, ("hind", "left"): math.pi}

    if kind == "ox" and (clip.endswith("_walk") or clip.endswith("_haul")):
        # A loaded ox plods: a shorter stride, a deeper nod, and a slower
        # cycle (see CLIPS). The empty walk home is the same gait let out a
        # little, which is what makes the two read as the same animal.
        haul = clip.endswith("_haul")
        swing = math.radians(17.0 if haul else 22.0)
        for key, leg in legs.items():
            leg.rotation_euler = (math.sin(a + phases[key]) * swing, 0.0, 0.0)
        root.location.z = abs(math.sin(a)) * 0.007
        # Head down into the yoke when there is weight behind it.
        neck.rotation_euler = (
            math.radians(_NECK_REST[kind] - (11.0 if haul else 0.0))
            + math.sin(a) * (0.085 if haul else 0.055), 0.0, 0.0)
        tail.rotation_euler = (math.sin(a) * 0.13, 0.0, 0.0)
        if sledge is not None:
            # The sledge yaws a touch behind the animal dragging it, rather
            # than tracking as if it were welded to the rump.
            sledge.rotation_euler = (0.0, 0.0, math.sin(a - 0.6) * 0.035)
        return

    if clip.endswith("_walk"):
        swing = math.radians(30.0 if kind == "war_dog" else 24.0)
        for key, leg in legs.items():
            leg.rotation_euler = (math.sin(a + phases[key]) * swing, 0.0, 0.0)
        root.location.z = abs(math.sin(a)) * (0.010 if kind == "war_dog" else 0.014)
        neck.rotation_euler = (math.radians(_NECK_REST[kind]) + math.sin(a) * 0.05, 0.0, 0.0)
        tail.rotation_euler = (math.radians(_TAIL_REST[kind]) + math.sin(a) * 0.20, 0.0, 0.0)
        return

    if clip.endswith("_attack"):
        if kind == "war_dog":
            # A lunge, not a swing: the whole animal pitches forward off its
            # hind legs and the head drops onto whatever it has reached.
            k = math.sin(a) * 0.5 + 0.5
            root.rotation_euler = (math.radians(-16.0) * k, 0.0, root.rotation_euler.z)
            root.location.z = k * 0.018
            neck.rotation_euler = (math.radians(_NECK_REST[kind] - 24.0 * k), 0.0, 0.0)
            for key, leg in legs.items():
                leg.rotation_euler = (math.sin(a + phases[key]) * math.radians(18.0),
                                      0.0, 0.0)
            return
        # Mounted: the horse holds its line and the RIDER strikes. Wind the arm
        # back slowly, bring it down fast -- a symmetric swing reads as a wave.
        if t < 0.55:
            ang = -20.0 - 70.0 * (t / 0.55)
        else:
            ang = -90.0 + 145.0 * ((t - 0.55) / 0.45)
        if arm:
            arm.rotation_euler = (math.radians(ang), 0.0, 0.0)
        root.location.z = math.sin(a) * 0.005
        neck.rotation_euler = (math.radians(_NECK_REST[kind]) + math.sin(a) * 0.04, 0.0, 0.0)
        return

    # idle: breathing, and a tail that is never quite still
    neck.rotation_euler = (math.radians(_NECK_REST[kind]) + math.sin(a) * 0.045, 0.0, 0.0)
    tail.rotation_euler = (math.radians(_TAIL_REST[kind]) + math.sin(a) * 0.16, 0.0, 0.0)
