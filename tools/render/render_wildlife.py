"""
Render the wild animals, eight facings per frame.

    blender -b -P tools/render/render_wildlife.py -- --out public/assets/sprites

Same conventions as render_units.py: one camera azimuth only (camera rotation
re-indexes the facing), and ONE fixed frame for every sprite so the animal does
not jitter around its own hooves as its legs swing.

Writes into the SAME units.json the peasants use, and MERGES rather than
replaces. render_units.py used to overwrite that file outright, which would
have deleted every animal the moment anyone re-rendered a peasant clip -- the
identical bug that once wiped buildings.json.
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
import wildlife

DIRECTIONS = 8


def parse_args():
    argv = rig.argv_after_dashes()
    out = os.path.join(os.getcwd(), "public", "assets", "sprites")
    samples, only = 64, None
    i = 0
    while i < len(argv):
        if argv[i] == "--out":
            out = argv[i + 1]; i += 2
        elif argv[i] == "--samples":
            samples = int(argv[i + 1]); i += 2
        elif argv[i] == "--only":
            only = argv[i + 1].split(","); i += 2
        else:
            i += 1
    return out, samples, only


def merge_units(out_dir, clips_meta, metas):
    """Fold new clips into units.json without disturbing what is already there."""
    path = os.path.join(out_dir, "units.json")
    index = {"directions": DIRECTIONS, "clips": {}, "sprites": []}
    if os.path.exists(path):
        try:
            with open(path) as fh:
                index = json.load(fh)
        except (ValueError, OSError) as exc:
            print(f"!! ignoring unreadable units.json: {exc}", flush=True)

    index.setdefault("clips", {}).update(clips_meta)
    kept = [s for s in index.get("sprites", []) if s.get("clip") not in clips_meta]
    index["sprites"] = kept + metas
    index["directions"] = DIRECTIONS

    with open(path, "w") as fh:
        json.dump(index, fh, indent=2)
    return len(index["sprites"]), len(index["clips"])


def main():
    out_dir, samples, only = parse_args()
    os.makedirs(out_dir, exist_ok=True)
    t0 = time.time()

    rig.reset_scene()
    rig.setup_world()
    rig.setup_sun()
    rig.setup_bounce()
    rig.setup_render(samples=samples)
    rig.add_shadow_catcher(size=4.0)

    root, objs, parts = wildlife.build_gazelle()
    meshes = [o for o in objs if o.type == 'MESH']

    # one fixed frame for every sprite, sized for the yaw sweep plus the shadow
    r, top = 0.48, 0.56
    box = [Vector((sx * r, sy * r, sz))
           for sx in (-1, 1) for sy in (-1, 1) for sz in (0.0, top)]
    cam = rig.setup_camera(rig.AZIMUTHS_DEG[0])
    w, h, ax, ay = rig.frame_points(cam, box + rig.shadow_projected(box),
                                    Vector((0.0, 0.0, 0.0)))
    print(f"gazelle frame {w}x{h} anchor=({ax:.1f},{ay:.1f})", flush=True)

    metas, clips_meta = [], {}
    for clip, (nframes, seconds) in wildlife.CLIPS.items():
        if only and clip not in only:
            continue
        clips_meta[clip] = {"frames": nframes,
                            "fps": round(nframes / seconds, 3)}
        for f in range(nframes):
            t = f / nframes
            for d in range(DIRECTIONS):
                wildlife.pose(parts, clip, t)
                root.rotation_euler = (
                    0.0, 0.0,
                    math.radians(wildlife.BASE_YAW_DEG) + (d / DIRECTIONS) * math.tau)
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

    total, nclips = merge_units(out_dir, clips_meta, metas)
    print(f"units.json holds {total} sprites across {nclips} clips", flush=True)
    print(f"DONE {len(metas)} wildlife sprites in {time.time() - t0:.1f}s", flush=True)
    _ = meshes


main()
