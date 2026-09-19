# The 3D renderer

Branch `3d-render`. The sprite scenery is being replaced by real meshes
under a real sun, one milestone at a time. Each milestone leaves the game
playable; `?r3d=0` falls back to the sprite scenery while both exist.

The background: `/Volumes/AI/Projects/Fiefdom_3d/MACHBARKEIT-3D-PORT.md`
(the analysis) and `SPIKE-GODOT.md` (a Godot spike that proved the look
transfers, and that the look is the models and the light, not the engine).

## Milestones

1. **Static world as meshes** — done. Buildings, walls, trees, yards and
   ghosts as `InstancedMesh`; a `DirectionalLight` with a shadow map that the
   terrain, the buildings and the unit sprites receive.
2. **Free camera** — done. Continuous azimuth and zoom, gliding between the
   old resting places; middle-drag / Alt-drag / two-finger twist to turn,
   wheel and pinch to zoom. Sprite lookups still use the nearest quadrant.
   *This is where the branch is.*
3. **Look tuning** against the sprite screenshots — shadow softness, bounce,
   bake resolution or procedural shader materials for the big buildings,
   ground tiles re-rendered as plain albedo.
4. **Units as skinned meshes** — last, and optional; the hybrid is a fine
   place to stop.

## How the meshes get here

`tools/render/export_glb.py` runs the same builders the sprite renderers use
(`buildings.py`, `props.py`, `piles.py`) and writes one `.glb` per model to
`public/assets/models/` (geometry only), `models.json` with the footprints,
and the material tiles under `mat/` with `materials.json`. `tools/render/export_models.sh` does all of them, one Blender
process each with retries — this headless Blender build segfaults in Cycles
bake now and then.

What glTF cannot carry is the procedural node materials, so each distinct
material is baked ONCE, on a flat 4×4-tile plane, into a tileable colour
texture and a tangent-space normal map; the models keep the world-scale
cube-projected UVs their patterns were built on and the engine repeats the
tile across them (`engine/models.ts`). Per-model bakes were tried first and
blurred the bricks away: 1024² over every face of a 3×3 keep is one texel
of mortar.

Tiles are 1024² for a patterned material (brick, plank, thatch) and 256²
for a plain one (cloth, iron, leaves). The whole set — 146 models and ~120
material tiles — is 24 MB against the 74 MB of sprites it replaces.

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
- The renderer outputs **linear**. The sprite and terrain shaders are raw and
  never encoded to sRGB, so the game's look has always been the art through a
  gamma curve (a keep sprite authored as pale sandstone shows as deep gold);
  three's lit materials are told to do the same so meshes match their own
  sprites. Undoing this properly means re-tuning the whole game's brightness.

## Licence note

The exported buildings are the project's own models under AGPL. Nothing
from Mixamo or 0 A.D. is in `public/assets/models/`; units are still
sprites. When units move to skinned meshes, the Mixamo clips must not ship
as animation curves in a public `.glb` — see the analysis, section 8.
