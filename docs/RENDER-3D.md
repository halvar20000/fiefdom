# The 3D renderer

Branch `3d-render`. The sprite scenery is being replaced by real meshes
under a real sun, one milestone at a time. Each milestone leaves the game
playable; `?r3d=0` falls back to the sprite scenery while both exist.

The background: `/Volumes/AI/Projects/Fiefdom_3d/MACHBARKEIT-3D-PORT.md`
(the analysis) and `SPIKE-GODOT.md` (a Godot spike that proved the look
transfers, and that the look is the models and the light, not the engine).

## Milestones

1. **Static world as meshes** — buildings, walls, trees, yards, ghosts as
   `InstancedMesh`; `DirectionalLight` with a shadow map that the terrain and
   the buildings receive. Camera unchanged (four rotations, four zooms);
   units unchanged (sprites). *This is where the branch is.*
2. **Free camera** — continuous rotation and zoom. Unit sprites pick their
   facing from heading minus azimuth already, so they survive it; the HUD,
   minimap, touch and editor need their rotation assumptions loosened.
3. **Look tuning** against the sprite screenshots — shadow softness, bounce,
   bake resolution or procedural shader materials for the big buildings,
   ground tiles re-rendered as plain albedo.
4. **Units as skinned meshes** — last, and optional; the hybrid is a fine
   place to stop.

## How the meshes get here

`tools/render/export_glb.py` runs the same builders the sprite renderers use
(`buildings.py`, `props.py`, `piles.py`) and writes one `.glb` per model to
`public/assets/models/`, textures embedded as WebP, plus `models.json` with
the footprints. `tools/render/export_models.sh` does all of them, one Blender
process each with retries — this headless Blender build segfaults in Cycles
bake now and then.

What glTF cannot carry is the procedural node materials, so each model gets
a smart-projected UV layer and two bakes: base colour, and the shading normal
in **object** space (tangent-space bakes crash this Blender when a mesh has
two UV layers; object space needs no tangents and three.js reads it natively
as `ObjectSpaceNormalMap`). The exporter swizzles the bake to Y-up; the
engine rotates it by the instance matrix (`engine/models.ts`).

Bake sizes: 1024² for anything 2×2 and up, 256² for a 1×1 prop or pile.
The whole set is ~35 MB against the 74 MB of sprites it replaces.

## Conventions the engine relies on

- Model origin = north-west corner of the footprint; the model extends +X
  across and **−Z** down the footprint (Blender +Y). A building on tile
  (x, z) with depth d is placed at (x, footing, z + d) — the sprite anchor's
  rule, kept.
- A quarter turn is +90° about +Y around the footprint's middle, which is
  what `rig.turn_object` did to the sprites.
- `SUN_DIRECTION` in `iso.ts` is the light for everything: sprites (baked),
  terrain slopes, and now the meshes and their shadow map.
- Tints are per-instance colours multiplying the albedo, the same numbers the
  sprite batch used.

## Licence note

The exported buildings are the project's own models under AGPL. Nothing
from Mixamo or 0 A.D. is in `public/assets/models/`; units are still
sprites. When units move to skinned meshes, the Mixamo clips must not ship
as animation curves in a public `.glb` — see the analysis, section 8.
