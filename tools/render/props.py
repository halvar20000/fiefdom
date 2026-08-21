"""
Vegetation and scatter props.

The reference maps are dense with palms, dry scrub and rock -- take the plants
away and even correct terrain reads as an empty parking lot. These are built
procedurally for the same reason the buildings are: consistent, licence-free,
and tunable in seconds.
"""

from __future__ import annotations
import math

import bpy
import geom
import materials as M


# --- extra materials -------------------------------------------------------

def frond_material(name="Frond"):
    mat, nt, bsdf = M._new(name)
    pos = M._pos(nt, 1.0)
    n = M._noise(nt, pos, scale=12.0, detail=7.0, roughness=0.6)
    ramp = M._ramp(nt, [
        (0.24, (0.16, 0.24, 0.07, 1.0)),
        (0.55, (0.30, 0.40, 0.12, 1.0)),
        (0.86, (0.46, 0.54, 0.20, 1.0)),
    ], n.outputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    M._set(bsdf, "Roughness", 0.82)
    return mat


def scrub_material(name="ScrubLeaf"):
    mat, nt, bsdf = M._new(name)
    pos = M._pos(nt, 1.0)
    n = M._noise(nt, pos, scale=26.0, detail=8.0, roughness=0.7, distortion=1.5)
    ramp = M._ramp(nt, [
        (0.26, (0.34, 0.36, 0.18, 1.0)),
        (0.58, (0.55, 0.57, 0.32, 1.0)),
        (0.88, (0.70, 0.71, 0.45, 1.0)),
    ], n.outputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    M._set(bsdf, "Roughness", 0.88)
    M._bump(nt, bsdf, n.outputs["Fac"], strength=0.8, distance=0.02)
    return mat


def bark_material(name="Bark"):
    mat, nt, bsdf = M._new(name)
    uv = M._uv(nt)
    stretch = nt.nodes.new("ShaderNodeMapping")
    M._set(stretch, "Scale", (2.0, 22.0, 1.0))
    nt.links.new(uv, stretch.inputs["Vector"])
    n = M._noise(nt, stretch.outputs["Vector"], scale=7.0, detail=9.0, roughness=0.65)
    ramp = M._ramp(nt, [
        (0.24, (0.24, 0.18, 0.11, 1.0)),
        (0.58, (0.42, 0.33, 0.21, 1.0)),
        (0.90, (0.58, 0.48, 0.33, 1.0)),
    ], n.outputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    M._set(bsdf, "Roughness", 0.92)
    M._bump(nt, bsdf, n.outputs["Fac"], strength=0.9, distance=0.02)
    return mat


# --- shapes ----------------------------------------------------------------

def tapered_trunk(name, base, height, r0, r1, mat, segments=8, lean=(0.0, 0.0), bow=0.16):
    """A slightly bowed, tapering trunk. Straight cylinders read as telegraph poles."""
    rings = 6
    verts, faces = [], []
    for r in range(rings + 1):
        t = r / rings
        z = height * t
        rad = r0 + (r1 - r0) * t
        # bow the trunk out then back, plus an overall lean
        off = math.sin(t * math.pi) * bow
        cx = lean[0] * t + off * lean[0] * 1.5
        cy = lean[1] * t + off * lean[1] * 1.5
        for s in range(segments):
            a = (s / segments) * math.tau
            verts.append((cx + math.cos(a) * rad, cy + math.sin(a) * rad, z))
    for r in range(rings):
        for s in range(segments):
            s2 = (s + 1) % segments
            a = r * segments + s
            b = r * segments + s2
            c = (r + 1) * segments + s2
            d = (r + 1) * segments + s
            faces.append((a, b, c, d))
    faces.append(tuple(range(segments - 1, -1, -1)))
    faces.append(tuple(range(rings * segments, (rings + 1) * segments)))
    return geom._finish(name, verts, faces, mat, base, uv_project=True)


def frond(name, base, length, width, droop, angle, mat, segs=8, fold=0.55):
    """
    One palm leaf.

    Built as a V-shaped channel rather than a flat strip: a real frond folds
    along its spine, and a flat horizontal blade viewed from a 30-degree camera
    is nearly edge-on, which made the first version render as a bare broom.
    The fold guarantees a lit surface from every rotation.
    """
    verts, faces = [], []
    ca, sa = math.cos(angle), math.sin(angle)

    for i in range(segs + 1):
        t = i / segs
        # rise, then arc over and fall away
        z = math.sin(t * 1.35) * length * 0.34 - (t ** 2.0) * droop
        d = t * length
        taper = (1.0 - t * 0.72) * (0.30 + 0.70 * math.sin(min(1.0, t * 2.0) * math.pi / 2))
        w = width * taper
        x, y = ca * d, sa * d
        px, py = -sa * w, ca * w
        # spine sits above the two edges -> V channel
        verts.append((x, y, z))                       # spine
        verts.append((x - px, y - py, z - w * fold))  # edge A
        verts.append((x + px, y + py, z - w * fold))  # edge B

    for i in range(segs):
        a = i * 3
        b = (i + 1) * 3
        faces.append((a, a + 1, b + 1, b))   # one half of the V
        faces.append((a, b, b + 2, a + 2))   # the other
    return geom._finish(name, verts, faces, mat, base, uv_project=True)


def blob(name, base, radius, mat, squash=0.75, subdiv=1):
    """Rough foliage clump."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv + 1, radius=radius,
                                          location=base)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (1.0, 1.0, squash)
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.append(mat)
    M.uv_cube_project(obj)
    return obj


# --- props -----------------------------------------------------------------

def palm():
    """Date palm, ~2.6 tiles tall. The signature plant of the Crusader maps."""
    bark = bark_material()
    leaf = frond_material()
    parts = []

    h = 2.45
    parts.append(tapered_trunk("palm_trunk", (0.5, 0.5, 0.0), h, 0.115, 0.075,
                               bark, lean=(0.10, 0.06), bow=0.20))

    top = (0.5 + 0.10 + 0.20 * 0.10 * 1.5, 0.5 + 0.06 + 0.20 * 0.06 * 1.5, h)
    # two staggered rings of fronds gives the crown real mass
    n = 8
    for i in range(n):
        a = (i / n) * math.tau + 0.3
        parts.append(frond(f"palm_frond_{i}", top, 1.06, 0.185, 0.80, a, leaf))
    for i in range(6):
        a = (i / 6) * math.tau + 0.68
        parts.append(frond(f"palm_frond_b{i}", (top[0], top[1], h - 0.09),
                           0.86, 0.155, 0.92, a, leaf))
    # dead lower fronds hanging against the trunk
    for i in range(4):
        a = (i / 4) * math.tau + 1.1
        parts.append(frond(f"palm_dead_{i}", (top[0], top[1], h - 0.20),
                           0.46, 0.11, 0.62, a, bark))
    # date clusters
    parts.append(blob("palm_dates", (top[0] + 0.12, top[1], h - 0.10), 0.09, bark, squash=0.8))
    return geom.join(parts, "palm"), (1, 1)


def scrub_bush():
    """Low desert bush, 1 tile."""
    leaf = scrub_material()
    bark = bark_material()
    parts = [geom.box("bush_stem", (0.47, 0.47, 0.0), (0.06, 0.06, 0.16), bark)]
    spots = [(0.50, 0.50, 0.26, 0.24), (0.36, 0.46, 0.20, 0.17),
             (0.62, 0.55, 0.22, 0.18), (0.48, 0.62, 0.19, 0.15),
             (0.55, 0.38, 0.17, 0.14)]
    for i, (bx, by, bz, r) in enumerate(spots):
        parts.append(blob(f"bush_{i}", (bx, by, bz), r, leaf, squash=0.62))
    return geom.join(parts, "bush"), (1, 1)


def dead_tree():
    """Bleached dry tree -- good silhouette breaker on empty sand."""
    bark = bark_material("DeadBark")
    parts = []
    parts.append(tapered_trunk("dt_trunk", (0.5, 0.5, 0.0), 1.45, 0.105, 0.045,
                               bark, lean=(0.06, -0.04), bow=0.12))
    limbs = [(0.9, 0.55, 0.6), (2.4, 0.48, 0.5), (4.2, 0.42, 0.45), (5.4, 0.62, 0.38)]
    for i, (ang, ln, z) in enumerate(limbs):
        b = geom.box(f"dt_limb_{i}", (0.5, 0.5, z), (ln, 0.075, 0.075), bark, rot_z=ang)
        b.rotation_euler = (0.0, -0.55 - i * 0.08, ang)
        parts.append(b)
    return geom.join(parts, "dead_tree"), (1, 1)


def olive_tree():
    """Broad-canopy tree for the green belt."""
    bark = bark_material()
    leaf = frond_material("OliveLeaf")
    parts = []
    parts.append(tapered_trunk("ot_trunk", (0.5, 0.5, 0.0), 0.78, 0.10, 0.07,
                               bark, lean=(0.04, 0.03), bow=0.10))
    canopy = [(0.50, 0.50, 1.02, 0.40), (0.30, 0.44, 0.90, 0.28),
              (0.70, 0.56, 0.92, 0.30), (0.52, 0.70, 0.88, 0.26),
              (0.46, 0.32, 0.86, 0.24)]
    for i, (bx, by, bz, r) in enumerate(canopy):
        parts.append(blob(f"ot_canopy_{i}", (bx, by, bz), r, leaf, squash=0.68))
    return geom.join(parts, "olive_tree"), (1, 1)




def campfire():
    """
    The gathering fire outside the keep, where the unemployed stand about.

    A ring of stones, charred logs and an emissive flame. The flame is emissive
    rather than lit so it reads as a light source at 30px, and it gives the one
    warm spot on an otherwise sun-lit map.
    """
    stone = M.rough_stone("FireStone")
    char = M.timber(dark=True)
    ash, nt_a, bsdf_a = M._new("Ash")
    M._set(bsdf_a, "Base Color", (0.10, 0.09, 0.08, 1.0))
    M._set(bsdf_a, "Roughness", 0.95)

    def emissive(name, colour, strength):
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

    flame_lo = emissive("FlameLow", (1.0, 0.42, 0.10), 9.0)
    flame_hi = emissive("FlameHigh", (1.0, 0.78, 0.32), 14.0)

    cx, cy = 0.5, 0.5
    parts = []

    # ash bed
    parts.append(geom.cylinder("cf_ash", (cx, cy, 0.0), 0.20, 0.025, ash, segments=12))

    # ring of stones
    n = 9
    for i in range(n):
        a = (i / n) * math.tau + 0.2
        r = 0.235 + (0.012 if i % 2 else 0.0)
        parts.append(geom.box(f"cf_stone_{i}",
                              (cx + math.cos(a) * r - 0.045,
                               cy + math.sin(a) * r - 0.045, 0.0),
                              (0.09, 0.085, 0.075 + 0.02 * (i % 3)), stone,
                              rot_z=a))

    # charred logs leaning into the middle
    for i in range(3):
        a = (i / 3) * math.tau + 0.5
        log = geom.cylinder(f"cf_log_{i}",
                            (cx + math.cos(a) * 0.16, cy + math.sin(a) * 0.16, 0.03),
                            0.032, 0.30, char, segments=8)
        log.rotation_euler = (1.15, 0.0, a)
        parts.append(log)

    # flame: a couple of tapered cones so it is not a flat blob
    parts.append(geom.cone("cf_flame_lo", (cx, cy, 0.045), 0.115, 0.24, flame_lo, segments=10))
    parts.append(geom.cone("cf_flame_hi", (cx + 0.015, cy - 0.01, 0.10), 0.065, 0.20,
                           flame_hi, segments=10))

    return geom.join(parts, "campfire"), (1, 1)


def _emissive(name, colour, strength):
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


def pitch_ditch():
    """
    A shallow trench of tar, waiting for a light.

    Kept deliberately low and dark: it has to read as something laid ON the
    ground rather than built on it, because troops walk straight over it and
    the whole trick is that the enemy does not think twice about the crossing.
    """
    tar, nt, bsdf = M._new("DitchTar")
    M._set(bsdf, "Base Color", (0.045, 0.042, 0.038, 1.0))
    M._set(bsdf, "Roughness", 0.18)      # wet, catches the light
    earth = M.timber("DitchEarth", dark=True)

    parts = []
    # spoil heaped round the lip, so the trench reads as dug
    for i, (x, y, w, d) in enumerate([
        (0.02, 0.02, 0.96, 0.10), (0.02, 0.88, 0.96, 0.10),
        (0.02, 0.10, 0.10, 0.78), (0.88, 0.10, 0.10, 0.78),
    ]):
        parts.append(geom.box(f"pd_lip_{i}", (x, y, 0.0), (w, d, 0.055), earth))
    parts.append(geom.box("pd_tar", (0.10, 0.10, 0.0), (0.80, 0.80, 0.035), tar))
    return geom.join(parts, "pitch_ditch"), (1, 1)


def _pitch_fire(variant):
    """
    Burning pitch. Three variants, cycled to flicker.

    Emissive rather than lit, like the campfire: at this size a flame reads as
    a light source or it does not read at all.
    """
    import random
    rnd = random.Random(1000 + variant)
    char = M.timber("BurntEarth", dark=True)
    # Emission kept low. At 11-19 the tone mapper clipped every tongue to flat
    # white and the fire lost its colour entirely -- it read as a pale blob
    # rather than a flame. These still glow but keep their orange.
    low = _emissive("PitchFlameLow", (1.0, 0.30, 0.05), 3.2)
    mid = _emissive("PitchFlameMid", (1.0, 0.48, 0.10), 4.6)
    hot = _emissive("PitchFlameHot", (1.0, 0.68, 0.26), 6.0)

    parts = []
    parts.append(geom.box("pf_bed", (0.06, 0.06, 0.0), (0.88, 0.88, 0.035), char))

    # a cluster of tapered tongues at varying heights
    for i in range(7):
        a = rnd.random() * math.tau
        r = rnd.uniform(0.0, 0.30)
        x, y = 0.5 + math.cos(a) * r, 0.5 + math.sin(a) * r
        h = rnd.uniform(0.22, 0.48)
        mat = hot if h > 0.40 else mid if h > 0.30 else low
        parts.append(geom.cone(f"pf_flame_{i}", (x, y, 0.02), rnd.uniform(0.09, 0.15),
                               h, mat, segments=7))
    # a couple of low sheets so the ground itself looks alight
    for i in range(3):
        a = rnd.random() * math.tau
        x, y = 0.5 + math.cos(a) * 0.3, 0.5 + math.sin(a) * 0.3
        parts.append(geom.cone(f"pf_lick_{i}", (x, y, 0.01), 0.16, 0.14, low, segments=6))
    # No smoke plume. A solid grey cone above the flames read as a spike or an
    # arrowhead, not smoke -- geometry is the wrong tool for it, and the fire
    # says everything it needs to on its own.
    return geom.join(parts, f"pitch_fire_{variant}"), (1, 1)


REGISTRY = {
    "campfire": campfire,
    "palm": palm,
    "bush": scrub_bush,
    "dead_tree": dead_tree,
    "olive_tree": olive_tree,
    "pitch_ditch": pitch_ditch,
    "pitch_fire_1": lambda: _pitch_fire(1),
    "pitch_fire_2": lambda: _pitch_fire(2),
    "pitch_fire_3": lambda: _pitch_fire(3),
}
