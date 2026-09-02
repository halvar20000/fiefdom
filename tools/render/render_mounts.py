"""
Render the horses and the war dog, eight facings per frame.

    blender -b -P tools/render/render_mounts.py -- --out public/assets/sprites
    blender -b -P tools/render/render_mounts.py -- --only war_dog

Same conventions as render_wildlife.py: one camera azimuth (a camera rotation
re-indexes the facing), one fixed frame per body so the animal does not jitter
around its own hooves, and a MERGE into units.json rather than a replace --
that file is shared with the peasants, the animals and the siege engines, and
an overwrite here would delete all of them.

The frame is MEASURED from the poses that will be rendered rather than guessed
from a bounding radius. A horse with a rider on it is half again as tall as it
is wide, and a guessed cube big enough for the nose is mostly air everywhere
else; trim_sprites.py would take that back afterwards, but a measured frame
also cannot silently clip a raised sword the way a guess can.
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
import mounts

DIRECTIONS = 8


def parse_args():
    argv = rig.argv_after_dashes()
    out = os.path.join(os.getcwd(), "public", "assets", "sprites")
    samples, only = 64, None
    i = 0
    while i < len(argv):
        if argv[i] == "--out": out = argv[i + 1]; i += 2
        elif argv[i] == "--samples": samples = int(argv[i + 1]); i += 2
        elif argv[i] == "--only": only = argv[i + 1].split(","); i += 2
        else: i += 1
    return out, samples, only


def merge_units(out_dir, clips_meta, metas):
    path = os.path.join(out_dir, "units.json")
    index = {"directions": DIRECTIONS, "clips": {}, "sprites": []}
    if os.path.exists(path):
        try:
            with open(path) as fh:
                index = json.load(fh)
        except (ValueError, OSError) as exc:
            print(f"!! ignoring unreadable units.json: {exc}", flush=True)
    index.setdefault("clips", {}).update(clips_meta)
    index["sprites"] = [s for s in index.get("sprites", [])
                        if s.get("clip") not in clips_meta] + metas
    index["directions"] = DIRECTIONS
    with open(path, "w") as fh:
        json.dump(index, fh, indent=2)
    return len(index["sprites"]), len(index["clips"])


def evaluated_bounds(meshes):
    deps = bpy.context.evaluated_depsgraph_get()
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for m in meshes:
        ev = m.evaluated_get(deps)
        mesh = ev.to_mesh()
        for v in mesh.vertices:
            w = ev.matrix_world @ v.co
            lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
            hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
        ev.to_mesh_clear()
    return lo, hi


def main():
    out_dir, samples, only = parse_args()
    os.makedirs(out_dir, exist_ok=True)
    t0 = time.time()
    total = 0

    for kind, builder in mounts.BUILDERS.items():
        clips = {c: v for c, v in mounts.CLIPS.items() if c.startswith(kind + "_")}
        if only and kind not in only:
            continue

        rig.reset_scene()
        rig.setup_world()
        rig.setup_sun()
        rig.setup_bounce()
        rig.setup_render(samples=samples)
        rig.add_shadow_catcher(size=5.0)

        root, objs, parts = builder()
        meshes = [o for o in objs if o.type == 'MESH']

        # One frame for the whole body, measured over every pose and facing it
        # will ever be drawn in.
        corners = []
        for clip, (nframes, _sec) in clips.items():
            for f in range(nframes):
                for d in range(DIRECTIONS):
                    mounts.pose(kind, parts, clip, f / nframes)
                    root.rotation_euler = (
                        root.rotation_euler.x, root.rotation_euler.y,
                        math.radians(mounts.BASE_YAW_DEG) + (d / DIRECTIONS) * math.tau)
                    bpy.context.view_layer.update()
                    lo, hi = evaluated_bounds(meshes)
                    for sx in (lo.x, hi.x):
                        for sy in (lo.y, hi.y):
                            for sz in (min(0.0, lo.z), hi.z):
                                corners.append(Vector((sx, sy, sz)))
        pad = 0.02
        box = [Vector((sx, sy, sz))
               for sx in (min(c.x for c in corners) - pad, max(c.x for c in corners) + pad)
               for sy in (min(c.y for c in corners) - pad, max(c.y for c in corners) + pad)
               for sz in (0.0, max(c.z for c in corners) + pad)]
        cam = rig.setup_camera(rig.AZIMUTHS_DEG[0])
        w, h, ax, ay = rig.frame_points(cam, box + rig.shadow_projected(box),
                                        Vector((0.0, 0.0, 0.0)))
        print(f"{kind} frame {w}x{h} anchor=({ax:.1f},{ay:.1f})", flush=True)

        metas, clips_meta = [], {}
        for clip, (nframes, seconds) in clips.items():
            clips_meta[clip] = {"frames": nframes, "fps": round(nframes / seconds, 3)}
            for f in range(nframes):
                for d in range(DIRECTIONS):
                    mounts.pose(kind, parts, clip, f / nframes)
                    root.rotation_euler = (
                        root.rotation_euler.x, root.rotation_euler.y,
                        math.radians(mounts.BASE_YAW_DEG) + (d / DIRECTIONS) * math.tau)
                    bpy.context.view_layer.update()
                    name = f"{clip}_{d}_{f}"
                    rig.render_to(os.path.join(out_dir, f"{name}.png"))
                    metas.append({
                        "name": name, "clip": clip, "direction": d, "frame": f,
                        "width": w, "height": h,
                        "anchor_x": round(ax, 2), "anchor_y": round(ay, 2),
                        "scale": rig.SPRITE_RENDER_SCALE,
                    })
            print(f"[{clip}] {nframes} frames x {DIRECTIONS} dirs "
                  f"{time.time() - t0:.1f}s", flush=True)

        n, nclips = merge_units(out_dir, clips_meta, metas)
        total += len(metas)
        print(f"units.json holds {n} sprites across {nclips} clips", flush=True)

    print(f"DONE {total} mount sprites in {time.time() - t0:.1f}s", flush=True)


main()
