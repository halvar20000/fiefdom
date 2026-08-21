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
            uv_project=True, shade_smooth=False):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (0.0, 0.0, rot_z)

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


def cylinder(name, pos, radius, height, mat, segments=16, cap=True):
    verts, faces = [], []
    for i in range(segments):
        a = (i / segments) * math.tau
        verts.append((math.cos(a) * radius, math.sin(a) * radius, 0.0))
    for i in range(segments):
        a = (i / segments) * math.tau
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
