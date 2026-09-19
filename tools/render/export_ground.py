"""
Bake the ground materials as albedo and normal tiles for the 3D renderer.

    blender -b -P tools/render/export_ground.py

The sprite renderer's ground tiles (render_ground.py) are top-down Cycles
renders with the sun in them; the 3D terrain lights itself with the same
sun the buildings get, so it wants the material's colour WITHOUT light and
its bump as a normal map. Same bake as the building materials
(export_glb.bake_material_tile): one 4x4-tile plane per ground type, 1024
texels, repeating. The engine samples a tile's own 1x1 patch of it, so a
4x4 block of ground is seamless and the same texture never sits next to
itself closer than four tiles.

Output: public/assets/ground/<type>_col.webp, <type>_nrm.webp, ground.json.
"""

from __future__ import annotations
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy

import rig
import render_ground as RG
import export_glb as EG

RES = 1024


def main():
    argv = rig.argv_after_dashes()
    out = os.path.join(os.getcwd(), "public", "assets", "ground")
    if "--out" in argv:
        out = argv[argv.index("--out") + 1]
    os.makedirs(out, exist_ok=True)
    rig.reset_scene()
    EG.setup_bake_scene()
    types = []
    for name, make in RG.TYPES.items():
        mat = make()
        EG.bake_material_tile(mat, name, out, res=RES)
        types.append(name)
    with open(os.path.join(out, "ground.json"), "w") as fh:
        json.dump({"types": types, "span": EG.TILE_SPAN, "px": RES}, fh, indent=1)
    print(f"DONE {len(types)} ground types -> {out}", flush=True)


if __name__ == "__main__":
    main()
