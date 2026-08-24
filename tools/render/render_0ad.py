"""
Render 0 A.D. animations onto our peasant, eight facings per frame.

    blender -b -P tools/render/render_0ad.py -- --src /tmp/0ad-eval

Output goes to `public/assets/sprites/0ad/` and NOWHERE else. That separation
is the licence, not tidiness: the motion in these sprites is Wildfire Games'
CC BY-SA 3.0 work, so the files are too, even though the body in them is ours.
Keeping them in one directory with their own LICENSE.txt is what makes the
obligation checkable rather than a thing to remember. See docs/THIRD-PARTY.md.

The manifest entry's `name` carries the subdirectory, and the atlas loader
builds its file path from `name` while keying frames on `clip` -- so the
engine asks for `chop_0_3` and never learns where it came from.
"""

from __future__ import annotations
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
from mathutils import Vector

import rig
import peasant as PEASANT
import collada_anim
import retarget

HERE = os.path.dirname(os.path.abspath(__file__))
CHARACTER = os.path.join(HERE, "..", "..", "assets", "source", "mixamo", "YBot_TPose.fbx")
OUT_SUBDIR = "0ad"
UNIT_HEIGHT_TILES = 0.52
DIRECTIONS = 8

#: game clip -> (source .dae, frames)
#:
#: `fish` is new: the fishery has been miming a woodcutter's swing since it was
#: built, for want of anything better. `death` is new too -- soldiers have
#: simply vanished until now.
CLIPS = {
    "chop":  ("gather_wood.dae", 6),
    "carry": ("carry_wood_m.dae", 8),
    "fish":  ("hele_gather_fish.dae", 8),
    "death": ("death_a.dae", 6),
}


def parse_args():
    argv = rig.argv_after_dashes()
    src = "/tmp/0ad-eval"
    out = os.path.join(os.getcwd(), "public", "assets", "sprites")
    only, samples = None, 96
    i = 0
    while i < len(argv):
        if argv[i] == "--src":
            src = argv[i + 1]; i += 2
        elif argv[i] == "--out":
            out = argv[i + 1]; i += 2
        elif argv[i] == "--only":
            only = set(argv[i + 1].split(",")); i += 2
        elif argv[i] == "--samples":
            samples = int(argv[i + 1]); i += 2
        else:
            i += 1
    return src, out, only, samples


def bounds(objects):
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in objects:
        ev = o.evaluated_get(dg)
        pts += [ev.matrix_world @ Vector(c) for c in ev.bound_box]
    xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


def merge_units(out_dir, clips_meta, metas):
    """
    Fold these sprites into units.json without disturbing the rest.

    Same rule the buildings manifest learned the hard way: a partial render
    must MERGE. Overwriting here would erase every Mixamo clip and leave a
    game whose peasants render as nothing at all.
    """
    path = os.path.join(out_dir, "units.json")
    doc = {"directions": DIRECTIONS, "clips": {}, "sprites": []}
    if os.path.exists(path):
        with open(path) as f:
            doc = json.load(f)
    doc.setdefault("clips", {}).update(clips_meta)
    keep = [s for s in doc.get("sprites", [])
            if s.get("clip") not in clips_meta]
    doc["sprites"] = keep + metas
    with open(path, "w") as f:
        json.dump(doc, f, indent=1)
    print(f"units.json holds {len(doc['sprites'])} sprites "
          f"across {len(doc['clips'])} clips", flush=True)


def main():
    src_dir, out_dir, only, samples = parse_args()
    sprite_dir = os.path.join(out_dir, OUT_SUBDIR)
    os.makedirs(sprite_dir, exist_ok=True)
    t0 = time.time()

    rig.reset_scene()
    rig.setup_world()
    rig.setup_sun()
    rig.setup_bounce()
    rig.setup_render(samples=samples)

    bpy.ops.import_scene.fbx(filepath=CHARACTER)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    prefix = next((b.name[:b.name.index(':') + 1] for b in arm.data.bones
                   if ':' in b.name), "mixamorig:")
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        bpy.data.objects.remove(o, do_unlink=True)
    mesh = PEASANT.build(arm, prefix=prefix)

    # Size exactly as render_units does, or these sprites stand next to the
    # Mixamo ones at a different height.
    bpy.context.view_layer.update()
    lo, hi = bounds([mesh])
    raw = mesh.get("body_z_extent") or (hi.z - lo.z)
    arm.scale = tuple(s * (UNIT_HEIGHT_TILES / max(1e-6, raw)) for s in arm.scale)
    bpy.context.view_layer.update()
    lo, hi = bounds([mesh])
    base_z = -lo.z
    arm.location.z = base_z
    bpy.context.view_layer.update()

    rig.add_shadow_catcher(size=6.0)
    r, top = UNIT_HEIGHT_TILES * 0.85, UNIT_HEIGHT_TILES * 1.18
    box = [Vector((sx * r, sy * r, sz))
           for sx in (-1, 1) for sy in (-1, 1) for sz in (0.0, top)]
    cam = rig.setup_camera(rig.AZIMUTHS_DEG[0])
    w, h, ax, ay = rig.frame_points(cam, box + rig.shadow_projected(box),
                                    Vector((0.0, 0.0, 0.0)))
    print(f"[frame] {w}x{h} anchor=({ax:.1f},{ay:.1f})", flush=True)

    hips = prefix + "Hips"
    scene = bpy.context.scene
    metas, clips_meta = [], {}

    for clip, (dae, nframes) in CLIPS.items():
        if only and clip not in only:
            continue
        path = os.path.join(src_dir, dae)
        if not os.path.exists(path):
            print(f"  !! missing {path}, skipping {clip}", flush=True)
            continue
        loaded = collada_anim.load(path)
        pairs = retarget.apply(arm, prefix, loaded, nframes, f"zeroad_{clip}")
        print(f"[{clip}] {dae}: {collada_anim.summary(loaded)}, {pairs} pairs",
              flush=True)
        clips_meta[clip] = {"frames": nframes}

        for f in range(nframes):
            scene.frame_set(f + 1)
            for d in range(DIRECTIONS):
                arm.rotation_euler = (arm.rotation_euler.x, arm.rotation_euler.y,
                                      (d / DIRECTIONS) * math.tau)
                # Re-centre after turning: the hips drift off the origin as the
                # figure leans, and a sprite whose feet wander is a sprite that
                # slides across the ground when the clip plays.
                bpy.context.view_layer.update()
                pb = arm.pose.bones[hips]
                world = (arm.matrix_world @ pb.matrix).translation
                arm.location.x -= world.x
                arm.location.y -= world.y
                bpy.context.view_layer.update()

                name = f"{OUT_SUBDIR}/peasant_{clip}_{d}_{f}"
                rig.render_to(os.path.join(out_dir, f"{name}.png"))
                metas.append({
                    "name": name, "clip": clip, "direction": d, "frame": f,
                    "width": w, "height": h,
                    "anchor_x": round(ax, 2), "anchor_y": round(ay, 2),
                    "scale": 2,
                })
                arm.location.x = 0.0
                arm.location.y = 0.0
            print(f"  frame {f}", flush=True)

    if metas:
        merge_units(out_dir, clips_meta, metas)
    print(f"DONE {len(metas)} sprites in {time.time() - t0:.1f}s -> {sprite_dir}",
          flush=True)


main()
