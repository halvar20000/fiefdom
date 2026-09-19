"""
Export the human units -- the peasant and every soldier body -- for the 3D
renderer: a rest-pose mesh and an animation texture of bone matrices.

    blender -b -P tools/render/export_units.py -- --body peasant
    blender -b -P tools/render/export_units.py -- --src /path/to/0ad-daes
    tools/render/export_units.sh                       # every body, one process each

Not glTF. The bodies are rigidly bound -- every vertex belongs to exactly one
bone (see peasant.py) -- so a unit needs no skin weights, just a bone index
per vertex, and the whole army can then be drawn as ONE InstancedMesh per
body: the vertex shader fetches its bone's matrix for the instance's frame
from a texture and that is the skinning, done. No SkinnedMesh per soldier,
no CPU work per frame. Writing the two buffers directly keeps everything in
one space (world, Y-up, feet at the origin) with no exporter conventions to
second-guess.

Per body, under public/assets/units/:
    <body>.json         layout: vertex/index counts, bone count, clips
    <body>.bin          positions f32x3, normals f32x3, colours u8x4, bone u8x4, indices u32
    <body>.anim.bin     Mixamo clips: per frame, per bone, a 3x4 affine as three RGBA32F texels
    0ad/<body>.anim.bin the 0 A.D. clips, same layout, in their own directory --
                        that separation IS the licence (docs/THIRD-PARTY.md)

The engine appends the two animation files into one texture at load.
"""

from __future__ import annotations
import json
import os
import struct
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
from mathutils import Matrix, Vector

import rig
import peasant as PEASANT
import render_units as RU
import render_0ad as R0
import collada_anim
import retarget

UNIT_HEIGHT_TILES = RU.UNIT_HEIGHT_TILES
#: Frames sampled per clip: the sprite renders' count times this, so a walk
#: that was 12 frames is 24. Cheap -- a frame is 65 bones x 48 bytes.
OVERSAMPLE = 2

#: Blender Z-up -> engine Y-up: (x, y, z) -> (x, z, -y).
YUP = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
YUP_INV = YUP.inverted()


def parse_args():
    argv = rig.argv_after_dashes()
    out = os.path.join(os.getcwd(), "public", "assets", "units")
    src = "/tmp/0ad-eval"
    body = None
    i = 0
    while i < len(argv):
        if argv[i] == "--out":
            out = argv[i + 1]; i += 2
        elif argv[i] == "--src":
            src = argv[i + 1]; i += 2
        elif argv[i] == "--body":
            body = argv[i + 1]; i += 2
        else:
            i += 1
    return out, src, body


def deselect_all():
    for o in bpy.context.selected_objects:
        o.select_set(False)


def action_fcurves(act):
    out = []
    for layer in getattr(act, "layers", []) or []:
        for strip in layer.strips:
            for bag in getattr(strip, "channelbags", []) or []:
                out.extend(bag.fcurves)
    if not out:
        out = list(getattr(act, "fcurves", []) or [])
    return out


def assign(arm, act):
    RU.assign_action(arm, act)


def scale_location_curves(act, factor):
    for fc in action_fcurves(act):
        if fc.data_path.endswith(".location"):
            for kp in fc.keyframe_points:
                kp.co[1] *= factor
                kp.handle_left[1] *= factor
                kp.handle_right[1] *= factor
            fc.update()


def flatten_root_motion(arm, act, hips_name):
    """Hold the hips over the origin horizontally; keep the vertical bob.
    The same thing render_units.centre_hips does per frame, done once."""
    bone = arm.data.bones[hips_name]
    up = Vector((0.0, 0.0, 1.0))
    axes = [abs((bone.matrix_local.to_3x3() @ Vector(a)).dot(up))
            for a in ((1, 0, 0), (0, 1, 0), (0, 0, 1))]
    vertical = axes.index(max(axes))
    path = f'pose.bones["{hips_name}"].location'
    for fc in action_fcurves(act):
        if fc.data_path == path and fc.array_index != vertical and fc.keyframe_points:
            base = fc.keyframe_points[0].co[1]
            for kp in fc.keyframe_points:
                kp.co[1] = base; kp.handle_left[1] = base; kp.handle_right[1] = base
            fc.update()


# ---------------------------------------------------------------------------
# colours
# ---------------------------------------------------------------------------

def material_colour(mat):
    """A flat linear RGB for a material: its Base Color, or the mean of the
    ramp feeding it when the colour is procedural (iron, timber)."""
    if mat is None or not mat.use_nodes:
        return (0.5, 0.5, 0.5)
    bsdf = next((n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled"), None)
    if bsdf is None:
        em = next((n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeEmission"), None)
        return tuple(em.inputs["Color"].default_value)[:3] if em else (0.5, 0.5, 0.5)
    inp = bsdf.inputs["Base Color"]
    if not inp.is_linked:
        return tuple(inp.default_value)[:3]
    ramp = next((n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeValToRGB"), None)
    if ramp is not None:
        els = ramp.color_ramp.elements
        return tuple(sum(e.color[i] for e in els) / len(els) for i in range(3))
    return (0.5, 0.5, 0.5)


# ---------------------------------------------------------------------------
# mesh
# ---------------------------------------------------------------------------

def export_mesh(body, arm, bone_index):
    """The rest-pose mesh in world space, welded, with a bone per vertex."""
    arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    me = ev.to_mesh()
    mw = ev.matrix_world
    nw = mw.to_3x3().inverted().transposed()
    me.calc_loop_triangles()

    colours = [material_colour(m) for m in body.data.materials]
    groups = {g.index: g.name for g in body.vertex_groups}

    def bone_of(v):
        best, bw = None, -1.0
        for g in v.groups:
            if g.weight > bw and groups.get(g.group) in bone_index:
                best, bw = groups[g.group], g.weight
        return bone_index.get(best, 0)

    verts = {}
    order = []
    indices = []
    for tri in me.loop_triangles:
        col = colours[tri.material_index] if tri.material_index < len(colours) else (0.5, 0.5, 0.5)
        c8 = tuple(max(0, min(255, round(c * 255))) for c in col)
        for li, vi in zip(tri.loops, tri.vertices):
            v = me.vertices[vi]
            p = YUP @ (mw @ v.co)
            n = YUP.to_3x3() @ (nw @ me.loops[li].normal)
            n.normalize()
            b = bone_of(v)
            key = (round(p.x, 5), round(p.y, 5), round(p.z, 5),
                   round(n.x, 3), round(n.y, 3), round(n.z, 3), c8, b)
            idx = verts.get(key)
            if idx is None:
                idx = len(order)
                verts[key] = idx
                order.append((p, n, c8, b))
            indices.append(idx)
    ev.to_mesh_clear()
    arm.data.pose_position = 'POSE'
    return order, indices


# ---------------------------------------------------------------------------
# animation
# ---------------------------------------------------------------------------

def skin_matrices(arm, bones):
    """World-space skinning matrix per bone for the current pose, Y-up."""
    W = arm.matrix_world
    Wi = W.inverted()
    out = []
    for b in bones:
        pb = arm.pose.bones[b.name]
        M = W @ pb.matrix @ b.matrix_local.inverted() @ Wi
        out.append(YUP @ M @ YUP_INV)
    return out


def sample_clip(arm, bones, act, nframes):
    """`nframes` evenly spaced poses across the action, as skin matrices."""
    assign(arm, act)
    f0, f1 = act.frame_range
    rows = []
    for i in range(nframes):
        # a looping clip: the last sample stops one step short of the first
        f = f0 + (f1 - f0) * i / nframes
        bpy.context.scene.frame_set(int(f), subframe=f - int(f))
        bpy.context.view_layer.update()
        rows.append(skin_matrices(arm, bones))
    return rows


def write_anim(path, rows):
    """RGBA32F texels: per frame, per bone, the three rows of the affine."""
    with open(path, "wb") as fh:
        for mats in rows:
            for m in mats:
                for r in range(3):
                    fh.write(struct.pack("<4f", m[r][0], m[r][1], m[r][2], m[r][3]))


def verify(body, arm, bones, act, tolerance=0.01):
    """Check the matrices against what Blender actually deforms: one vertex
    per bone, at a mid-clip frame. A mistake in the skinning maths is a body
    that silently comes apart, so it is measured rather than trusted.

    Two evaluations, rest then posed, each read out completely before the
    next: an evaluated mesh is freed by the next to_mesh() on its object."""
    groups = {g.index: g.name for g in body.vertex_groups}
    bone_index = {b.name: i for i, b in enumerate(bones)}
    bone_of = {}
    for v in body.data.vertices:
        g = max(v.groups, key=lambda g: g.weight, default=None)
        bi = bone_index.get(groups.get(g.group)) if g else None
        if bi is not None and bi not in bone_of.values():
            bone_of[v.index] = bi

    def positions():
        dg = bpy.context.evaluated_depsgraph_get()
        ev = body.evaluated_get(dg)
        me = ev.to_mesh()
        out = {i: YUP @ (ev.matrix_world @ me.vertices[i].co) for i in bone_of}
        ev.to_mesh_clear()
        return out

    arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    rest = positions()

    arm.data.pose_position = 'POSE'
    assign(arm, act)
    f0, f1 = act.frame_range
    f = (f0 + f1) / 2
    bpy.context.scene.frame_set(int(f), subframe=f - int(f))
    bpy.context.view_layer.update()
    posed = positions()
    mats = skin_matrices(arm, bones)

    worst = moved = 0.0
    for i, bi in bone_of.items():
        worst = max(worst, (mats[bi] @ rest[i] - posed[i]).length)
        moved = max(moved, (posed[i] - rest[i]).length)
    print(f"  skinning check: worst error {worst:.4f} tiles over {len(bone_of)} bones; "
          f"the pose moved a vertex {moved:.3f} tiles", flush=True)
    if worst > tolerance:
        raise SystemExit(f"skinning maths off by {worst:.3f}")
    if moved < 0.01:
        raise SystemExit("the check frame did not pose the body -- nothing was verified")


# ---------------------------------------------------------------------------

def export_body(kind, out_dir, src_0ad):
    rig.reset_scene()
    bpy.ops.import_scene.fbx(filepath=RU.CHARACTER)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    prefix = RU.detect_prefix(arm)
    hips = prefix + "Hips"
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        bpy.data.objects.remove(o, do_unlink=True)
    keep = set(bpy.data.objects.keys())
    spec = RU.SOLDIERS.get(kind, {})
    body = PEASANT.build(arm, prefix=prefix, palette=spec.get("palette"), kit=spec.get("kit"))
    keep.add(body.name)

    # Scale to unit height, feet on the ground, then bake the scale into the
    # bones -- as the sprite renderer does per frame, done once here.
    bpy.context.view_layer.update()
    lo, hi = RU.evaluated_bounds([body])
    raw_h = body.get("body_z_extent") or (hi.z - lo.z)
    factor = UNIT_HEIGHT_TILES / max(1e-6, raw_h)
    arm.scale = tuple(s * factor for s in arm.scale)
    bpy.context.view_layer.update()
    lo, hi = RU.evaluated_bounds([body])
    arm.location.z -= lo.z
    bpy.context.view_layer.update()
    total = arm.scale.x
    deselect_all()
    arm.select_set(True); body.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    # --- clips: Mixamo (through render_units' tables) ...
    clips = dict(RU.CLIPS)
    if kind in RU.SOLDIERS:
        for dead in RU.WORKER_ONLY_CLIPS:
            clips.pop(dead, None)
        if spec.get("attack_src"):
            clips["attack"] = (spec["attack_src"], spec.get("attack_frames", clips["attack"][1]),
                               spec.get("attack_seconds", clips["attack"][2]))
    else:
        clips.pop("attack", None)      # a worker never fights
    mixamo = {}
    for clip, (filename, frames, seconds) in clips.items():
        path = os.path.join(RU.SRC, filename)
        if not os.path.exists(path):
            print(f"  !! missing {filename}, skipping {clip}", flush=True); continue
        before = set(bpy.data.actions.keys())
        bpy.ops.import_scene.fbx(filepath=path)
        new = [a for a in bpy.data.actions if a.name not in before]
        for a in bpy.data.actions:
            a.use_fake_user = True
        for name in list(bpy.data.objects.keys()):
            if name not in keep:
                bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)
        if not new:
            continue
        act = new[0]
        RU.retarget_action(act, prefix)
        scale_location_curves(act, total)
        flatten_root_motion(arm, act, hips)
        mixamo[clip] = (act, frames * OVERSAMPLE, seconds)

    # ... and 0 A.D., for the peasant's trades and everyone's death
    zeroad = {}
    wanted = R0.CLIPS if kind not in RU.SOLDIERS else {"death": R0.CLIPS["death"]}
    for clip, (dae, frames, seconds) in wanted.items():
        path = os.path.join(src_0ad, dae)
        if not os.path.exists(path):
            print(f"  !! missing {dae}, skipping {clip}", flush=True); continue
        loaded = collada_anim.load(path)
        retarget.apply(arm, prefix, loaded, frames * OVERSAMPLE, f"zeroad_{clip}")
        act = arm.animation_data.action
        act.use_fake_user = True
        flatten_root_motion(arm, act, hips)
        zeroad[clip] = (act, frames * OVERSAMPLE, seconds)

    bones = list(arm.data.bones)
    bone_index = {b.name: i for i, b in enumerate(bones)}

    # --- mesh
    order, indices = export_mesh(body, arm, bone_index)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, f"{kind}.bin"), "wb") as fh:
        for p, n, c, b in order:
            fh.write(struct.pack("<3f", p.x, p.y, p.z))
        for p, n, c, b in order:
            fh.write(struct.pack("<3f", n.x, n.y, n.z))
        for p, n, c, b in order:
            fh.write(struct.pack("<4B", c[0], c[1], c[2], 255))
        for p, n, c, b in order:
            fh.write(struct.pack("<4B", b, 0, 0, 0))
        for i in indices:
            fh.write(struct.pack("<I", i))

    # --- animation textures
    meta_clips = {}
    def bake(clipset, path, source):
        rows = []
        for clip, (act, n, seconds) in clipset.items():
            meta_clips[clip] = {"source": source, "start": len(rows), "count": n, "fps": n / seconds}
            rows.extend(sample_clip(arm, bones, act, n))
        write_anim(path, rows)
        return len(rows)
    n_mix = bake(mixamo, os.path.join(out_dir, f"{kind}.anim.bin"), "mixamo")
    n_0ad = 0
    if zeroad:
        os.makedirs(os.path.join(out_dir, "0ad"), exist_ok=True)
        n_0ad = bake(zeroad, os.path.join(out_dir, "0ad", f"{kind}.anim.bin"), "0ad")

    first = next(iter(mixamo.values()))[0] if mixamo else next(iter(zeroad.values()))[0]
    verify(body, arm, bones, first)

    meta = {
        "verts": len(order), "indices": len(indices), "bones": len(bones),
        "frames": {"mixamo": n_mix, "0ad": n_0ad},
        "clips": meta_clips,
        "height": UNIT_HEIGHT_TILES,
    }
    with open(os.path.join(out_dir, f"{kind}.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    print(f"[{kind}] verts={len(order)} tris={len(indices) // 3} bones={len(bones)} "
          f"frames mixamo={n_mix} 0ad={n_0ad} clips={sorted(meta_clips)}", flush=True)


def main():
    out_dir, src_0ad, body = parse_args()
    bodies = [body] if body else ["peasant", *RU.SOLDIERS.keys()]
    t0 = time.time()
    for kind in bodies:
        t1 = time.time()
        export_body(kind, out_dir, src_0ad)
        print(f"  -> {kind} in {time.time() - t1:.1f}s", flush=True)
    manifest = os.path.join(out_dir, "units.json")
    have = set()
    if os.path.exists(manifest):
        with open(manifest) as fh:
            have = set(json.load(fh).get("bodies", []))
    have.update(bodies)
    with open(manifest, "w") as fh:
        json.dump({"bodies": sorted(have)}, fh, indent=1)
    print(f"DONE {len(bodies)} bodies in {time.time() - t0:.1f}s", flush=True)


if __name__ == "__main__":
    main()
