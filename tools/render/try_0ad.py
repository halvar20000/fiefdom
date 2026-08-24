"""
Render one 0 A.D. animation on our peasant, for comparison.

An evaluation harness, not part of the asset build. It exists so a borrowed
motion can be looked at beside our own before anything is committed to, because
the question "does this fit" is not one the licence or the file format can
answer -- only a picture can.

    blender -b -P tools/render/try_0ad.py -- \
        --dae /tmp/0ad-eval/gather_wood.dae --out /tmp/0ad-eval/render --frames 6

Anything it produces is an adaptation of CC BY-SA 3.0 work by Wildfire Games
and carries that licence. Nothing here writes into public/assets.
"""

from __future__ import annotations
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
from mathutils import Vector

import rig
import peasant as PEASANT
import collada_anim
import retarget

CHARACTER = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         "..", "..", "assets", "source", "mixamo", "YBot_TPose.fbx")
UNIT_HEIGHT_TILES = 0.52


def parse_args():
    argv = rig.argv_after_dashes()
    dae, out, frames, direction = None, "/tmp/0ad-eval/render", 6, 0
    i = 0
    while i < len(argv):
        if argv[i] == "--dae":
            dae = argv[i + 1]; i += 2
        elif argv[i] == "--out":
            out = argv[i + 1]; i += 2
        elif argv[i] == "--frames":
            frames = int(argv[i + 1]); i += 2
        elif argv[i] == "--dir":
            direction = int(argv[i + 1]); i += 2
        else:
            i += 1
    if not dae:
        raise SystemExit("need --dae <file.dae>")
    return dae, out, frames, direction


def main():
    dae, out_dir, frames, direction = parse_args()
    os.makedirs(out_dir, exist_ok=True)

    clip = collada_anim.load(dae)
    print(f"[collada] {os.path.basename(dae)}: {collada_anim.summary(clip)}", flush=True)

    rig.reset_scene()
    rig.setup_world()
    rig.setup_sun()
    rig.setup_bounce()
    rig.setup_render(samples=64)

    bpy.ops.import_scene.fbx(filepath=CHARACTER)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    prefix = next((b.name[:b.name.index(':') + 1] for b in arm.data.bones
                   if ':' in b.name), "mixamorig:")
    print(f"[rig] bone prefix {prefix!r}, {len(arm.data.bones)} bones", flush=True)

    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        bpy.data.objects.remove(o, do_unlink=True)
    mesh = PEASANT.build(arm, prefix=prefix)

    n = retarget.apply(arm, prefix, clip, frames, "zeroad_test")
    print(f"[retarget] {n} bone pairs driven", flush=True)

    # Same sizing the real renderer uses, so the comparison is like for like.
    bpy.context.view_layer.update()
    lo, hi = _bounds([mesh])
    raw = mesh.get("body_z_extent") or (hi.z - lo.z)
    factor = UNIT_HEIGHT_TILES / max(1e-6, raw)
    arm.scale = tuple(s * factor for s in arm.scale)
    bpy.context.view_layer.update()
    lo, hi = _bounds([mesh])
    arm.location.z = -lo.z
    bpy.context.view_layer.update()

    rig.add_shadow_catcher(size=6.0)
    r, top = UNIT_HEIGHT_TILES * 0.85, UNIT_HEIGHT_TILES * 1.18
    box = [Vector((sx * r, sy * r, sz))
           for sx in (-1, 1) for sy in (-1, 1) for sz in (0.0, top)]
    cam = rig.setup_camera(rig.AZIMUTHS_DEG[0])
    w, h, ax, ay = rig.frame_points(cam, box + rig.shadow_projected(box),
                                    Vector((0.0, 0.0, 0.0)))
    print(f"[frame] {w}x{h} anchor=({ax:.1f},{ay:.1f})", flush=True)

    scene = bpy.context.scene
    arm.rotation_euler = (arm.rotation_euler.x, arm.rotation_euler.y,
                          (direction / 8) * math.tau)
    base = os.path.splitext(os.path.basename(dae))[0]
    for f in range(frames):
        scene.frame_set(f + 1)
        rig.render_to(os.path.join(out_dir, f"{base}_{f}.png"))
        print(f"  frame {f}", flush=True)
    print(f"DONE -> {out_dir}", flush=True)


def _bounds(objects):
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in objects:
        ev = o.evaluated_get(dg)
        pts += [ev.matrix_world @ Vector(c) for c in ev.bound_box]
    xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


main()
