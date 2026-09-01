"""
Mesh primitives for the parametric buildings.

Everything is built from explicit vertex coordinates at true size rather than
scaled primitives. Object-level scaling would desynchronise the UV cube
projection from world units, and then a 0.4-unit brick would come out a
different size on every building.

Coordinates are Blender-native: XY is the ground plane, +Z is up.
1 unit == 1 map tile.
"""

from __future__ import annotations
import math
import bmesh
import bpy

import materials


def _finish(name, verts, faces, mat, location=(0.0, 0.0, 0.0), rot_z=0.0,
            uv_project=True, shade_smooth=False, rot=None):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = rot if rot is not None else (0.0, 0.0, rot_z)

    # from_pydata does not guarantee outward normals; fix them properly
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    if mat is not None:
        obj.data.materials.append(mat)
    if uv_project:
        materials.uv_cube_project(obj)
    if shade_smooth:
        for poly in mesh.polygons:
            poly.use_smooth = True
    return obj


def box(name, pos, size, mat, rot_z=0.0):
    """Axis-aligned box. `pos` is the minimum corner, `size` is (w, d, h)."""
    w, d, h = size
    verts = [(0, 0, 0), (w, 0, 0), (w, d, 0), (0, d, 0),
             (0, 0, h), (w, 0, h), (w, d, h), (0, d, h)]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7),
             (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return _finish(name, verts, faces, mat, pos, rot_z)


def gable(name, pos, size, mat, rot_z=0.0, overhang=0.0):
    """Pitched roof. Ridge runs along +Y. `size` is (w, d, h) of the roof body."""
    w, d, h = size
    o = overhang
    verts = [(-o, -o, 0), (w + o, -o, 0), (w + o, d + o, 0), (-o, d + o, 0),
             (w / 2.0, -o, h), (w / 2.0, d + o, h)]
    faces = [(0, 3, 2, 1),          # underside
             (0, 1, 4),             # front gable
             (2, 3, 5),             # back gable
             (1, 2, 5, 4),          # +X slope
             (3, 0, 4, 5)]          # -X slope
    return _finish(name, verts, faces, mat, pos, rot_z)


def pyramid(name, pos, size, mat, rot_z=0.0, overhang=0.0):
    """Four-sided roof for towers. `size` is (w, d, h)."""
    w, d, h = size
    o = overhang
    verts = [(-o, -o, 0), (w + o, -o, 0), (w + o, d + o, 0), (-o, d + o, 0),
             (w / 2.0, d / 2.0, h)]
    faces = [(0, 3, 2, 1), (0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)]
    return _finish(name, verts, faces, mat, pos, rot_z)


def cylinder(name, pos, radius, height, mat, segments=16, cap=True, angle0=0.0):
    # angle0 rotates the ring of vertices, baked into the coordinates rather than
    # applied as an object rotation so the UV cube projection stays put. Lets a
    # low-segment prism (an octagon) present a flat FACE toward an axis instead
    # of an edge -- which is what a door or window wants to sit on.
    verts, faces = [], []
    for i in range(segments):
        a = angle0 + (i / segments) * math.tau
        verts.append((math.cos(a) * radius, math.sin(a) * radius, 0.0))
    for i in range(segments):
        a = angle0 + (i / segments) * math.tau
        verts.append((math.cos(a) * radius, math.sin(a) * radius, height))
    for i in range(segments):
        j = (i + 1) % segments
        faces.append((i, j, segments + j, segments + i))
    if cap:
        faces.append(tuple(range(segments - 1, -1, -1)))
        faces.append(tuple(range(segments, segments * 2)))
    return _finish(name, verts, faces, mat, pos)


def cone(name, pos, radius, height, mat, segments=16):
    verts = []
    for i in range(segments):
        a = (i / segments) * math.tau
        verts.append((math.cos(a) * radius, math.sin(a) * radius, 0.0))
    verts.append((0.0, 0.0, height))
    faces = [(i, (i + 1) % segments, segments) for i in range(segments)]
    faces.append(tuple(range(segments - 1, -1, -1)))
    return _finish(name, verts, faces, mat, pos)


def dome(name, pos, radius, height, mat, segments=20, rings=8):
    """Hemispherical dome. `pos` is the base centre; rises to `height` at the top.

    Built as stacked latitude rings so it can be taller than a true hemisphere
    (a slightly ogee cupola) by setting height > radius. Smooth-shaded so it
    reads as a curved lead or plaster dome rather than a faceted cone.
    """
    verts, faces = [], []
    for r in range(rings):
        phi = (r / rings) * (math.pi / 2.0)      # 0 at the base, pi/2 at the top
        rr = radius * math.cos(phi)
        z = height * math.sin(phi)
        for i in range(segments):
            a = (i / segments) * math.tau
            verts.append((math.cos(a) * rr, math.sin(a) * rr, z))
    apex = len(verts)
    verts.append((0.0, 0.0, height))
    for r in range(rings - 1):
        base, nxt = r * segments, (r + 1) * segments
        for i in range(segments):
            j = (i + 1) % segments
            faces.append((base + i, base + j, nxt + j, nxt + i))
    top = (rings - 1) * segments
    for i in range(segments):
        faces.append((top + i, top + (i + 1) % segments, apex))
    faces.append(tuple(range(segments - 1, -1, -1)))   # underside, so it reads solid
    return _finish(name, verts, faces, mat, pos, shade_smooth=True)


def crenellate(name_prefix, origin, width, depth, mat,
               merlon=0.22, gap=0.20, height=0.20, thickness=0.13, z=0.0):
    """
    Ring of merlons around a wall top -- the notched battlement silhouette that
    reads as 'castle' even at 40 pixels. Returns the list of created objects.
    """
    ox, oy = origin
    out = []
    step = merlon + gap

    def run(length, place):
        n = max(1, int(round((length + gap) / step)))
        actual = (length + gap) / n - gap
        for i in range(n):
            out.append(place(i * (actual + gap), actual))

    run(width, lambda t, ln: box(
        f"{name_prefix}_s{len(out)}", (ox + t, oy, z), (ln, thickness, height), mat))
    run(width, lambda t, ln: box(
        f"{name_prefix}_n{len(out)}", (ox + t, oy + depth - thickness, z),
        (ln, thickness, height), mat))
    run(depth - thickness * 2, lambda t, ln: box(
        f"{name_prefix}_w{len(out)}", (ox, oy + thickness + t, z),
        (thickness, ln, height), mat))
    run(depth - thickness * 2, lambda t, ln: box(
        f"{name_prefix}_e{len(out)}", (ox + width - thickness, oy + thickness + t, z),
        (thickness, ln, height), mat))
    return out


def arch_doorway(name, pos, width, height, depth, mat, segments=8):
    """
    A recessed round-topped doorway, built as a solid dark plug that sits
    slightly proud of the wall. Cheaper and more legible at sprite size than
    booleaning a hole through the wall.
    """
    r = width / 2.0
    straight = max(0.0, height - r)
    verts, faces = [], []

    profile = [(0.0, 0.0), (width, 0.0)]
    if straight > 0:
        profile = [(0.0, 0.0), (width, 0.0), (width, straight)]
    for i in range(segments + 1):
        a = (i / segments) * math.pi
        profile.append((r + math.cos(a) * r, straight + math.sin(a) * r))
    if straight > 0:
        profile.append((0.0, straight))

    n = len(profile)
    for (px, pz) in profile:
        verts.append((px, 0.0, pz))
    for (px, pz) in profile:
        verts.append((px, depth, pz))
    faces.append(tuple(range(n - 1, -1, -1)))
    faces.append(tuple(range(n, n * 2)))
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    return _finish(name, verts, faces, mat, pos)


def join(objects, name):
    """Merge objects into one mesh so the renderer frames and shades them as a unit."""
    objects = [o for o in objects if o is not None]
    if not objects:
        return None
    if len(objects) == 1:
        objects[0].name = name
        return objects[0]
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = name
    return joined


# ---------------------------------------------------------------------------
# Detail vocabulary
#
# Everything below exists because the camera now zooms to three times tile
# scale. At the old two-times ceiling a wall could be one plaster box and a
# roof one smooth prism: a tile was 64 screen pixels, a roof slope perhaps
# thirty, and there was nowhere to put a shingle. At 96 pixels per tile those
# same surfaces are broad blank planes, and blankness is what makes a building
# read as a placeholder rather than a building.
#
# The reference is unambiguous about what fills them: half-timbered walls with
# white infill panels caged by dark posts, rails and braces; roofs of clearly
# separate shingle courses or fat combed thatch; and a footing of rough stone
# lifting the timber off the mud.
#
# Two rules these builders all follow:
#
# * One mesh, not many. A shingled roof is a few hundred slabs, and each one
#   built as its own object would pay for a bmesh normal pass and -- far worse
#   -- a `bpy.ops.uv.cube_project`, which toggles edit mode. Accumulating into
#   a single `_Batch` and finishing once turns minutes of operator overhead
#   into milliseconds.
# * Jitter is seeded from the name, never from `random` directly. Every asset
#   is rendered four times, once per camera rotation, and those four renders
#   MUST be the same building. A shared global RNG makes each rotation a
#   different building, and the result is a hovel whose thatch visibly
#   reshuffles as the player rotates the map.
# ---------------------------------------------------------------------------

import zlib


def rng_for(name):
    """Deterministic RNG for a named piece of geometry. See the note above."""
    import random
    return random.Random(zlib.crc32(name.encode("utf-8")))


class _Batch:
    """Accumulates many convex chunks into one mesh."""

    def __init__(self):
        self.verts = []
        self.faces = []

    def slab(self, origin, u, v, w):
        """Parallelepiped from `origin` spanned by edge vectors u, v, w."""
        ox, oy, oz = origin
        ux, uy, uz = u
        vx, vy, vz = v
        wx, wy, wz = w
        n = len(self.verts)
        for a in (0, 1):
            for b in (0, 1):
                for c in (0, 1):
                    self.verts.append((ox + a * ux + b * vx + c * wx,
                                       oy + a * uy + b * vy + c * wy,
                                       oz + a * uz + b * vz + c * wz))
        # index = n + a*4 + b*2 + c
        def i(a, b, c):
            return n + a * 4 + b * 2 + c
        self.faces += [
            (i(0, 0, 0), i(0, 1, 0), i(0, 1, 1), i(0, 0, 1)),
            (i(1, 0, 0), i(1, 0, 1), i(1, 1, 1), i(1, 1, 0)),
            (i(0, 0, 0), i(0, 0, 1), i(1, 0, 1), i(1, 0, 0)),
            (i(0, 1, 0), i(1, 1, 0), i(1, 1, 1), i(0, 1, 1)),
            (i(0, 0, 0), i(1, 0, 0), i(1, 1, 0), i(0, 1, 0)),
            (i(0, 0, 1), i(0, 1, 1), i(1, 1, 1), i(1, 0, 1)),
        ]

    def box(self, pos, size):
        self.slab(pos, (size[0], 0.0, 0.0), (0.0, size[1], 0.0), (0.0, 0.0, size[2]))

    def prism(self, profile, extrude):
        """Extrude a closed 2-D profile of (x, z) points along +Y by `extrude`."""
        n = len(profile)
        base = len(self.verts)
        for (px, pz) in profile:
            self.verts.append((px, 0.0, pz))
        for (px, pz) in profile:
            self.verts.append((px, extrude, pz))
        self.faces.append(tuple(range(base + n - 1, base - 1, -1)))
        self.faces.append(tuple(range(base + n, base + n * 2)))
        for k in range(n):
            j = (k + 1) % n
            self.faces.append((base + k, base + j, base + n + j, base + n + k))

    def rod(self, a, b, radius, segments=6):
        """A capped prism between two points -- pegs, poles, binding rods."""
        import mathutils
        va, vb = mathutils.Vector(a), mathutils.Vector(b)
        axis = vb - va
        if axis.length < 1e-9:
            return
        z = axis.normalized()
        helper = mathutils.Vector((0.0, 0.0, 1.0))
        if abs(z.dot(helper)) > 0.95:
            helper = mathutils.Vector((1.0, 0.0, 0.0))
        x = z.cross(helper).normalized()
        y = z.cross(x)
        n = len(self.verts)
        for end in (va, vb):
            for s in range(segments):
                ang = (s / segments) * math.tau
                p = end + x * (math.cos(ang) * radius) + y * (math.sin(ang) * radius)
                self.verts.append((p.x, p.y, p.z))
        for s in range(segments):
            t = (s + 1) % segments
            self.faces.append((n + s, n + t, n + segments + t, n + segments + s))
        self.faces.append(tuple(range(n + segments - 1, n - 1, -1)))
        self.faces.append(tuple(range(n + segments, n + segments * 2)))

    def finish(self, name, mat, pos=(0.0, 0.0, 0.0), rot_z=0.0, shade_smooth=False):
        if not self.faces:
            return None
        return _finish(name, self.verts, self.faces, mat, pos, rot_z,
                       shade_smooth=shade_smooth)


def _slope(w, d, h, overhang, side):
    """
    Geometry of one gable slope, shared by the shingle and thatch roofs.

    Returns (eave_point, up_slope_unit, outward_normal, slope_length,
    ridge_direction, ridge_length). `side` is -1 for the -X slope, +1 for +X.
    Matches gable(): eaves at x = -o and x = w + o, ridge at x = w/2, z = h.
    """
    o = overhang
    run = w / 2.0 + o
    length = math.hypot(run, h)
    eave_x = (w + o) if side > 0 else -o
    up = (-side * run / length, 0.0, h / length)
    normal = (side * h / length, 0.0, run / length)
    return ((eave_x, -o, 0.0), up, normal, length,
            (0.0, 1.0, 0.0), d + 2.0 * o)


def shingle_roof(name, pos, size, mat, rot_z=0.0, overhang=0.13,
                 course=0.15, shingle=0.16, thick=0.030, gap=0.014,
                 ridge_mat=None):
    """
    A pitched roof of overlapping wooden shingles, laid in courses.

    Built as real overlapping boards rather than a textured prism because the
    thing that identifies a shingle roof at a distance is not the wood colour,
    it is the stepped edge: every course butts a few millimetres proud of the
    one below and casts a thin hard shadow line down the slope. A bump map
    cannot do that -- it does not change the silhouette at the eaves, and it
    vanishes the moment the roof faces away from the sun.

    Courses are laid from the eave upward and each one runs nearly two course
    steps up the slope, so it is genuinely overlapped by the course above in
    the way a real roof sheds water. Alternate courses are staggered by half a
    shingle so the vertical joints never line up into a stripe.

    Returns a list of objects, so it drops straight into a builder's `parts`.
    """
    w, d, h = size
    rnd = rng_for(name)
    boards = _Batch()
    caps = _Batch()

    for side in (-1, 1):
        eave, up, normal, length, along, span = _slope(w, d, h, overhang, side)
        n = max(2, int(round(length / course)))
        step = length / n
        for i in range(n):
            # Each course reaches well past the next course's butt line; the
            # overlap is what stops daylight showing between them at the seam.
            run = step * 1.85 if i < n - 1 else step * 1.15
            base = tuple(eave[k] + up[k] * (i * step) for k in range(3))
            # Alternate courses start half a shingle along the ridge.
            offset = (shingle + gap) * (0.5 if i % 2 else 0.0)
            t = offset - (shingle + gap) if offset else 0.0
            while t < span:
                width = min(shingle, span - t) if t + shingle > span else shingle
                keep = width if t >= 0 else width + t
                start = max(t, 0.0)
                if keep > 0.02:
                    # A little length and thickness variation, or the butt line
                    # reads as machined rather than split by hand.
                    jr = run * (1.0 + (rnd.random() - 0.5) * 0.12)
                    jt = thick * (0.85 + rnd.random() * 0.35)
                    origin = (base[0] + along[0] * start,
                              base[1] + along[1] * start,
                              base[2] + along[2] * start)
                    boards.slab(
                        origin,
                        tuple(up[k] * jr for k in range(3)),
                        tuple(along[k] * keep for k in range(3)),
                        tuple(normal[k] * jt for k in range(3)))
                t += shingle + gap

    # Ridge cap: a run of short boards straddling the apex, which also hides
    # the seam where the two slopes' top courses meet.
    _, up_l, norm_l, _, along, span = _slope(w, d, h, overhang, -1)
    cap_len = shingle * 1.5
    t = 0.0
    while t < span:
        ln = min(cap_len, span - t)
        for side in (-1, 1):
            eave, up, normal, length, _, _ = _slope(w, d, h, overhang, side)
            apex = tuple(eave[k] + up[k] * length for k in range(3))
            back = tuple(apex[k] - up[k] * (course * 0.9) for k in range(3))
            caps.slab(
                (back[0] + along[0] * t, back[1] + along[1] * t, back[2] + along[2] * t),
                tuple(up[k] * (course * 0.95) for k in range(3)),
                tuple(along[k] * (ln - gap) for k in range(3)),
                tuple(normal[k] * (thick * 1.6) for k in range(3)))
        t += cap_len

    out = [boards.finish(f"{name}_shingles", mat, pos, rot_z),
           caps.finish(f"{name}_ridge", ridge_mat or mat, pos, rot_z)]
    return [o for o in out if o is not None]


def thatch_roof(name, pos, size, mat, rot_z=0.0, overhang=0.20,
                course=0.21, bundle=0.055, thick=0.070, depth=0.10,
                binder_mat=None):
    """
    Fat combed thatch, laid as overlapping courses of straw bundles.

    The first attempt at this was a smooth prism swollen by a straw thickness,
    trusting the material's directional bump to sell it. It did not: rendered
    at three times tile scale a thatched roof came out as two flat panels of
    pale plywood. Bump cannot help, because what the eye is reading on a real
    thatch is not surface roughness -- it is a deep stack of separate layers,
    each throwing a soft shadow onto the one below, and a bottom edge so thick
    and ragged it breaks the roofline.

    So the straw is geometry, on the same principle as `shingle_roof` but with
    everything turned up: fatter courses, far more overlap, and a much wider
    random spread on the length and thickness of every bundle. The result is
    lumpy in silhouette, which is exactly the difference between thatch and
    board.

    A rolled ridge and rolled eaves cap it, since those two curves are what
    identify thatch when the roof is in shadow and the layering has gone dark.
    """
    w, d, h = size
    rnd = rng_for(name)
    straw = _Batch()

    # A thin core so no daylight shows between bundles at a grazing angle.
    o = overhang
    core = [(-o * 0.9, 0.0), (w + o * 0.9, 0.0), (w + o * 0.9, depth * 0.35),
            (w / 2.0, h + depth * 0.5), (-o * 0.9, depth * 0.35)]
    straw.prism(core, d + 2.0 * o * 0.9)
    for idx in range(len(straw.verts)):
        vx, vy, vz = straw.verts[idx]
        straw.verts[idx] = (vx, vy - o * 0.9, vz)

    for side in (-1, 1):
        eave, up, normal, length, along, span = _slope(w, d, h, overhang, side)
        n = max(3, int(round(length / course)))
        step = length / n
        for i in range(n):
            # Heavy overlap: a course reaches most of three courses down.
            run = step * 2.6 if i < n - 1 else step * 1.4
            base = tuple(eave[k] + up[k] * (i * step) for k in range(3))
            # Bundles are laid EDGE TO EDGE, not spaced. An earlier pass gave
            # them a gap and a half-bundle stagger, exactly as the shingles
            # have, and the roof came out looking tiled -- a grid of pale
            # rectangles. Straw has no vertical joints; what it has is a
            # ragged bottom edge, so the bundles are narrow, butted, and vary
            # only in how far down the slope they reach.
            t = 0.0
            while t < span:
                keep = min(bundle, span - t)
                if keep > 0.01:
                    jr = run * (1.0 + (rnd.random() - 0.5) * 0.42)
                    jt = thick * (0.72 + rnd.random() * 0.70)
                    origin = (base[0] + along[0] * t,
                              base[1] + along[1] * t,
                              base[2] + along[2] * t)
                    straw.slab(
                        origin,
                        tuple(up[k] * jr for k in range(3)),
                        tuple(along[k] * (keep + 0.004) for k in range(3)),
                        tuple(normal[k] * jt for k in range(3)))
                t += bundle

        # Rolled eave: the thick soft bulge that hangs past the wall.
        ex = (w + o) if side > 0 else -o
        straw.rod((ex, -o, thick * 0.75), (ex, d + o, thick * 0.75),
                  thick * 1.15, segments=8)

    # Ridge roll, sat slightly proud so it breaks the apex line.
    straw.rod((w / 2.0, -o, h + thick * 1.5),
              (w / 2.0, d + o, h + thick * 1.5), thick * 1.35, segments=8)

    parts = [straw.finish(f"{name}_thatch", mat, pos, rot_z)]

    # Hazel rods pinning the ridge down -- the only straight lines on a thatch,
    # and the detail that reads as craft rather than as a lump of hay.
    if binder_mat is not None:
        rods = _Batch()
        for dx in (-0.11, 0.11):
            rods.rod((w / 2.0 + dx, -o, h + thick * 1.9),
                     (w / 2.0 + dx, d + o, h + thick * 1.9), 0.014)
        n = max(3, int(round((d + 2 * o) / 0.42)))
        for i in range(n):
            y = -o + (d + 2 * o) * ((i + 0.5) / n)
            rods.rod((w / 2.0 - 0.20, y, h + thick * 0.9),
                     (w / 2.0 + 0.20, y, h + thick * 0.9), 0.013)
        parts.append(rods.finish(f"{name}_binders", binder_mat, pos, rot_z))
    return [p for p in parts if p is not None]


def timber_frame(name, pos, size, plaster_mat, timber_mat, rot_z=0.0,
                 member=0.085, proud=0.030, bay=0.58, braces=True,
                 mid_rail=None, sides=('-y', '+y', '-x', '+x'),
                 wall=None):
    """
    Half-timbered walls: a plaster box caged in posts, rails and braces.

    This is the single most recognisable thing about the reference town
    buildings -- bright lime panels divided by near-black oak -- and it is
    almost free, because the frame is the same handful of members on every
    building and only the bay count changes with the wall's length.

    The members stand `proud` of the plaster rather than being flush with it.
    Flush framing is a texture; proud framing casts its own shadow across the
    panel beside it, which is what makes the wall look built rather than
    painted, and it survives the two camera rotations that put the wall in
    shade.

    `sides` names which walls exist. Pass `wall` as a panel thickness to get an
    open-sided working shed -- the infill is then built as separate panels on
    the named sides only, instead of one solid block, so the shed genuinely has
    a hole in it that the light and the ground show through. Several buildings
    here are open-fronted and used to fake it with three loose boxes.

    Returns a list of objects.
    """
    w, d, h = size
    x0 = y0 = 0.0
    parts = []
    rail = member * 0.82
    inset = 0.014                     # how far a member bites into the plaster

    if mid_rail is None:
        mid_rail = h > 0.85

    core = _Batch()
    if wall is None:
        core.box((0.0, 0.0, 0.0), (w, d, h))
    else:
        for s in sides:
            if s == '-y':
                core.box((0.0, 0.0, 0.0), (w, wall, h))
            elif s == '+y':
                core.box((0.0, d - wall, 0.0), (w, wall, h))
            elif s == '-x':
                core.box((0.0, 0.0, 0.0), (wall, d, h))
            elif s == '+x':
                core.box((w - wall, 0.0, 0.0), (wall, d, h))
    obj = core.finish(f"{name}_infill", plaster_mat, pos, rot_z)
    if obj is not None:
        parts.append(obj)

    frame = _Batch()

    # Corner posts, straddling the corner so they read from both faces at once.
    for (cx, cy) in ((x0, y0), (x0 + w - member + proud * 2, y0),
                     (x0, y0 + d - member + proud * 2),
                     (x0 + w - member + proud * 2, y0 + d - member + proud * 2)):
        frame.box((cx - proud, cy - proud, 0.0), (member, member, h))

    def wall(length, place):
        """Lay sill, top plate, optional mid rail, studs and braces on a face."""
        # place(u_start, u_len, z, z_len) -> emits one member
        place(0.0, length, 0.0, rail)                       # sill
        place(0.0, length, h - rail, rail)                  # top plate
        if mid_rail:
            place(0.0, length, h * 0.52 - rail / 2.0, rail)
        n = max(1, int(round(length / bay)))
        for i in range(1, n):
            u = length * (i / n) - member / 2.0
            place(u, member, rail, h - rail * 2.0, vertical=True)
        return n

    def face(axis, sign):
        """Emit one wall face. axis 'x' means the wall lies in the XZ plane."""
        if axis == 'x':
            length = w
            yv = (y0 - proud) if sign < 0 else (y0 + d - inset)
            thickness = proud + inset

            def place(u, ln, z, zl, vertical=False):
                frame.box((x0 + u, yv, z), (ln, thickness, zl))

            def brace(u0, z0, u1, z1):
                frame.slab((x0 + u0, yv, z0),
                           (u1 - u0, 0.0, z1 - z0),
                           (0.0, thickness, 0.0),
                           (member * 0.72, 0.0, 0.0))
        else:
            length = d
            xv = (x0 - proud) if sign < 0 else (x0 + w - inset)
            thickness = proud + inset

            def place(u, ln, z, zl, vertical=False):
                frame.box((xv, y0 + u, z), (thickness, ln, zl))

            def brace(u0, z0, u1, z1):
                frame.slab((xv, y0 + u0, z0),
                           (0.0, u1 - u0, z1 - z0),
                           (thickness, 0.0, 0.0),
                           (0.0, member * 0.72, 0.0))

        n = wall(length, place)
        if braces and h > 0.55:
            reach = min(length / n * 0.85, h * 0.55)
            top = (h * 0.52 - rail / 2.0) if mid_rail else (h - rail)
            brace(member * 0.6, rail, member * 0.6 + reach, top)
            brace(length - member * 0.6 - reach, top, length - member * 0.6, rail)

    for s in sides:
        face(s[1], -1 if s[0] == '-' else 1)

    parts.append(frame.finish(f"{name}_frame", timber_mat, pos, rot_z))
    return [p for p in parts if p is not None]


def stone_footing(name, pos, size, mat, rot_z=0.0, height=0.16, block=0.26,
                  proud=0.045):
    """
    A course of undressed blocks under a timber wall.

    Every timber building in the reference sits on one of these, and it is
    doing real work at this zoom: it stops the wall meeting the ground in a
    single dead-straight line, it puts a band of cool grey under all that warm
    ochre, and its irregular top edge hides the seam between sprite and
    terrain. `size` is the wall footprint it wraps.
    """
    w, d, h = size
    rnd = rng_for(name)
    b = _Batch()

    def run(length, put):
        n = max(1, int(round(length / block)))
        step = length / n
        for i in range(n):
            j = step * (0.80 + rnd.random() * 0.26)
            put(i * step, min(j, step * 1.02),
                height * (0.72 + rnd.random() * 0.45),
                proud * (0.55 + rnd.random() * 0.8))

    run(w, lambda u, ln, hh, pr: b.box((u, -pr, 0.0), (ln, pr + 0.05, hh)))
    run(w, lambda u, ln, hh, pr: b.box((u, d - 0.05, 0.0), (ln, pr + 0.05, hh)))
    run(d, lambda u, ln, hh, pr: b.box((-pr, u, 0.0), (pr + 0.05, ln, hh)))
    run(d, lambda u, ln, hh, pr: b.box((w - 0.05, u, 0.0), (pr + 0.05, ln, hh)))
    obj = b.finish(f"{name}_footing", mat, pos, rot_z)
    return [obj] if obj else []


def rafters(name, pos, size, mat, rot_z=0.0, overhang=0.13, count=None,
            beam=0.055):
    """
    Beam ends poking out from under the eaves, along both long walls.

    A roof that meets a wall in a clean line looks moulded. Rafter ends break
    that line into a row of little shadows and cost eight vertices each.
    """
    w, d, h = size
    b = _Batch()
    n = count or max(3, int(round(d / 0.34)))
    for i in range(n):
        y = d * ((i + 0.5) / n) - beam / 2.0
        b.box((-overhang * 0.85, y, h - beam * 1.25),
              (overhang * 0.95, beam, beam))
        b.box((w - overhang * 0.10, y, h - beam * 1.25),
              (overhang * 0.95, beam, beam))
    obj = b.finish(f"{name}_rafters", mat, pos, rot_z)
    return [obj] if obj else []


def plank_door(name, pos, width, height, mat, band_mat=None, rot_z=0.0,
               depth=0.055, planks=4):
    """A boarded door: vertical planks with a gap between, plus iron bands."""
    b = _Batch()
    gap = 0.012
    pw = (width - gap * (planks - 1)) / planks
    for i in range(planks):
        x = i * (pw + gap)
        b.box((x, 0.0, 0.0), (pw, depth * (0.75 + 0.25 * (i % 2)), height))
    parts = [b.finish(f"{name}_planks", mat, pos, rot_z)]
    if band_mat is not None:
        ir = _Batch()
        for z in (height * 0.18, height * 0.74):
            ir.box((-0.012, 0.0, z), (width + 0.024, depth * 1.15, 0.032))
        parts.append(ir.finish(f"{name}_bands", band_mat, pos, rot_z))
    return [p for p in parts if p is not None]


def shuttered_window(name, pos, width, height, dark_mat, timber_mat,
                     rot_z=0.0, depth=0.05, shutters=True):
    """A dark window recess in a timber surround, optionally with open shutters."""
    b = _Batch()
    b.box((0.0, 0.0, 0.0), (width, depth * 0.6, height))
    parts = [b.finish(f"{name}_void", dark_mat, pos, rot_z)]

    f = _Batch()
    j = 0.032
    f.box((-j, 0.0, -j), (width + j * 2, depth, j))               # sill
    f.box((-j, 0.0, height), (width + j * 2, depth, j))           # lintel
    f.box((-j, 0.0, 0.0), (j, depth, height))                     # jambs
    f.box((width, 0.0, 0.0), (j, depth, height))
    if shutters:
        for sx, sw in ((-j - 0.10, 0.10), (width + j, 0.10)):
            f.box((sx, 0.0, 0.0), (sw, depth * 1.3, height))
    parts.append(f.finish(f"{name}_frame", timber_mat, pos, rot_z))
    return [p for p in parts if p is not None]


def barrel(name, pos, radius, height, body_mat, hoop_mat, rot_z=0.0):
    """An upright barrel, bellied in the middle, with two iron hoops."""
    b = _Batch()
    rings = ((0.0, radius * 0.86), (0.30, radius), (0.70, radius),
             (1.0, radius * 0.86))
    seg = 10
    prev = None
    for (t, r) in rings:
        n0 = len(b.verts)
        for i in range(seg):
            a = (i / seg) * math.tau
            b.verts.append((math.cos(a) * r, math.sin(a) * r, t * height))
        if prev is not None:
            for i in range(seg):
                j = (i + 1) % seg
                b.faces.append((prev + i, prev + j, n0 + j, n0 + i))
        prev = n0
    top = prev
    b.faces.append(tuple(range(top + seg - 1, top - 1, -1)))
    b.faces.append(tuple(range(top, top + seg)))
    parts = [b.finish(f"{name}_body", body_mat, pos, rot_z)]
    h = _Batch()
    for t in (0.22, 0.74):
        h.rod((0.0, 0.0, height * t), (0.0, 0.0, height * t + 0.028),
              radius * 1.03, segments=10)
    parts.append(h.finish(f"{name}_hoops", hoop_mat, pos, rot_z))
    return [p for p in parts if p is not None]


def crate(name, pos, size, mat, rot_z=0.0):
    """A planked crate: a body plus corner battens, so it is not a plain cube."""
    w, d, h = size
    b = _Batch()
    b.box((0.0, 0.0, 0.0), (w, d, h))
    t = 0.028
    for (x, y) in ((0, 0), (w - t, 0), (0, d - t), (w - t, d - t)):
        b.box((x - 0.008, y - 0.008, 0.0), (t + 0.016, t + 0.016, h))
    for z in (h * 0.10, h * 0.80):
        b.box((-0.008, -0.008, z), (w + 0.016, d + 0.016, t))
    obj = b.finish(name, mat, pos, rot_z)
    return [obj] if obj else []


def ladder(name, pos, length, width, mat, rot_z=0.0, lean=0.30, rungs=None):
    """A leaning ladder -- the cheapest possible sign that a roof gets used."""
    b = _Batch()
    rail = 0.035
    n = rungs or max(3, int(length / 0.28))
    tip = (lean, 0.0, math.sqrt(max(length ** 2 - lean ** 2, 0.01)))
    for sx in (0.0, width - rail):
        b.slab((sx, 0.0, 0.0), tip, (rail, 0.0, 0.0), (0.0, rail, 0.0))
    for i in range(1, n):
        t = i / n
        b.box((tip[0] * t, 0.004, tip[2] * t), (width, 0.026, 0.026))
    obj = b.finish(name, mat, pos, rot_z)
    return [obj] if obj else []


def log_stack(name, pos, count, log_len, radius, mat, rot_z=0.0, along='y'):
    """A stacked cord of logs, pyramided. Reads instantly as 'wood'."""
    b = _Batch()
    rnd = rng_for(name)
    rows = int(math.ceil((-1 + math.sqrt(1 + 8 * count)) / 2))
    placed = 0
    for row in range(rows):
        for col in range(rows - row):
            if placed >= count:
                break
            x = radius + col * radius * 2.05 + row * radius
            z = radius + row * radius * 1.78
            jitter = (rnd.random() - 0.5) * log_len * 0.10
            if along == 'y':
                b.rod((x, jitter, z), (x, log_len + jitter, z), radius, segments=8)
            else:
                b.rod((jitter, x, z), (log_len + jitter, x, z), radius, segments=8)
            placed += 1
    obj = b.finish(name, mat, pos, rot_z)
    return [obj] if obj else []


def stalks(name, pos, size, mat, rows=6, spacing=0.085, height=0.26,
           lean=0.05, rot_z=0.0):
    """
    A planted field: rows of individual tapered stalks.

    Crops used to be a flat slab of yellow per furrow, which at the old zoom
    passed for a line of wheat and at this one is unmistakably a strip of
    plastic. Stalks cost eight vertices each and give the field the broken,
    slightly uneven top edge that reads as growing.
    """
    w, d, _ = size
    rnd = rng_for(name)
    b = _Batch()
    for r in range(rows):
        y = d * ((r + 0.5) / rows)
        n = max(1, int(w / spacing))
        for i in range(n):
            x = w * ((i + 0.5) / n) + (rnd.random() - 0.5) * spacing * 0.5
            hh = height * (0.78 + rnd.random() * 0.44)
            lx = (rnd.random() - 0.5) * lean
            ly = (rnd.random() - 0.5) * lean
            t = spacing * 0.30
            b.slab((x - t / 2, y - t / 2, 0.0),
                   (t, 0.0, 0.0), (0.0, t, 0.0), (lx, ly, hh))
    obj = b.finish(name, mat, pos, rot_z)
    return [obj] if obj else []
