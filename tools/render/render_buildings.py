"""
Render every building through the rig, four rotations each.

Run:
    blender -b -P tools/render/render_buildings.py -- --out public/assets/sprites
    blender -b -P tools/render/render_buildings.py -- --only keep --samples 32

Everything renders inside ONE Blender process on purpose. Cycles spends well
over a minute compiling its Metal kernels on first use; per-asset processes
would pay that cost every single time. Warm renders after the first are fast.
"""

from __future__ import annotations
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
from mathutils import Vector

from dataclasses import asdict

import rig
import buildings
import props
import piles


def parse_args():
    argv = rig.argv_after_dashes()
    out = os.path.join(os.getcwd(), "public", "assets", "sprites")
    only, samples = None, 96
    i = 0
    while i < len(argv):
        if argv[i] == "--out":
            out = argv[i + 1]; i += 2
        elif argv[i] == "--only":
            only = argv[i + 1].split(","); i += 2
        elif argv[i] == "--samples":
            samples = int(argv[i + 1]); i += 2
        else:
            i += 1
    return out, only, samples


def main():
    out_dir, only, samples = parse_args()
    registry = {**buildings.REGISTRY, **props.REGISTRY, **piles.REGISTRY}
    names = list(registry.keys())
    if only:
        names = [n for n in names if n in only]

    metas = []
    t_all = time.time()

    for name in names:
        builder = registry[name]

        for rot, azimuth in enumerate(rig.AZIMUTHS_DEG):
            t0 = time.time()

            # Full reset per render. Slower than reusing the scene, but it makes
            # every sprite provably independent of what was rendered before it.
            rig.reset_scene()
            rig.setup_world()
            rig.setup_sun()
            rig.setup_bounce()
            rig.setup_render(samples=samples)
            rig.add_shadow_catcher()

            obj, footprint = builder()
            cam = rig.setup_camera(azimuth)

            # keep the cast shadow inside the frame
            corners = rig._world_bounds([obj])
            extra = rig.shadow_projected(corners)

            w, h, ax, ay = rig.frame_object(cam, [obj], Vector((0.0, 0.0, 0.0)),
                                            extra_points=extra)

            path = os.path.join(out_dir, f"{name}_{rot}.png")
            rig.render_to(path)

            metas.append(rig.SpriteMeta(
                name=name, rotation=rot, width=w, height=h,
                anchor_x=round(ax, 2), anchor_y=round(ay, 2),
                footprint=list(footprint), scale=rig.SPRITE_RENDER_SCALE,
            ))
            print(f"[{name} rot{rot}] {w}x{h} anchor=({ax:.1f},{ay:.1f}) "
                  f"{time.time() - t0:.1f}s", flush=True)

    # Merge into any existing manifest instead of replacing it. A partial run
    # (--only keep) must not delete the catalogue entries for every other
    # building whose PNGs are still sitting right there on disk.
    manifest_path = os.path.join(out_dir, "buildings.json")
    merged = {}
    if os.path.exists(manifest_path):
        try:
            with open(manifest_path) as fh:
                for entry in json.load(fh):
                    merged[(entry["name"], entry["rotation"])] = entry
        except (ValueError, KeyError, OSError) as exc:
            print(f"!! ignoring unreadable manifest: {exc}", flush=True)

    for m in metas:
        merged[(m.name, m.rotation)] = asdict(m)

    ordered = sorted(merged.values(), key=lambda e: (e["name"], e["rotation"]))
    os.makedirs(out_dir, exist_ok=True)
    with open(manifest_path, "w") as fh:
        json.dump(ordered, fh, indent=2)
    print(f"manifest holds {len(ordered)} sprites "
          f"({len({e['name'] for e in ordered})} assets)", flush=True)
    print(f"DONE {len(metas)} sprites in {time.time() - t_all:.1f}s -> {out_dir}",
          flush=True)


main()
