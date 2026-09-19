# Third-party material

Everything in this repository is Fiefdom's own work under AGPL-3.0 except the
material listed here.

## 0 A.D. animations — adopted

`public/assets/sprites/0ad/` holds sprites rendered from Fiefdom's own peasant
mesh driven by animations from [0 A.D.](https://play0ad.com) by Wildfire Games,
and `public/assets/units/0ad/` holds the same motion as bone matrices for the
3D renderer (`<body>.anim.bin`, one file per body; see `docs/RENDER-3D.md`).
Both directories carry the same `LICENSE.txt`.
The clips used are `gather_wood`, `carry_wood_m`, `hele_gather_fish`,
`death_a`, `farming`, `gather_fruit_m`, `gather_berries`, `seeding`,
`slaughter`, `gather_meat` and `build`, reaching the game as the `chop`,
`carry`, `fish`, `death`, `farm`, `pick`, `milk`, `feed`, `slaughter`,
`butcher` and `craft` animations. The tools that read and retarget them
(`tools/render/collada_anim.py`, `tools/render/retarget.py`) are ours and carry
no third-party licence; the rendered sprites do.

    Attribution: "Wildfire Games / 0 A.D., CC BY-SA 3.0"

That directory has its own `LICENSE.txt`. The terms:

| Part of 0 A.D. | Licence |
| --- | --- |
| Engine and code | GPL-2.0-or-later |
| **Art, animation, audio** | **CC BY-SA 3.0** |

CC BY-SA 3.0 **cannot be relicensed** under this project's AGPL-3.0. Creative
Commons declared GPLv3 a compatible licence for BY-SA **4.0** only, one way,
in October 2015; for 3.0 no non-CC licence has ever been designated. The
workable route is therefore aggregation, not merger — their material keeps its
own licence beside ours, exactly as 0 A.D. itself ships GPL code beside CC
BY-SA art.

Adopting any of it would mean:

1. A directory of its own, say `public/assets/sprites/0ad/`, with its own
   `LICENSE.txt` and a credit to Wildfire Games.
2. Sprites rendered from their animation are **adaptations**, so those files
   are CC BY-SA 3.0 even though the mesh in them is ours. ShareAlike applies to
   the output, not just the input.
3. No pre-baked atlas mixing their sprites with ours. The runtime atlas is
   assembled in the browser and never distributed, which keeps the two apart;
   shipping a combined image file would not.
4. Saying so in the README and in the Community Applications description.
5. Avoiding `binaries/system/` in their tree, which their own licence file
   warns may contain proprietary components.

This is a summary of their licence file and Creative Commons' published
compatibility position, not legal advice.

## Mixamo animations — used, never handed on

The unit bodies are animated with clips from [Mixamo](https://www.mixamo.com)
(Adobe): `Idle`, `Walking`, `Digging`, `Heavy Weapon Swing`, `Baseball
Strike`, `Standing Draw Arrow`, and the Y Bot skeleton they ride on. Adobe's
terms allow the animations to be used and incorporated in a project, and do
not allow the animation data itself to be passed on as an asset. The line
drawn here:

- The FBX files never enter the repository (`assets/source/**/*.fbx` is
  ignored); the sprites rendered from them do, as renders of our own mesh.
- The 3D renderer's bone-matrix files, `public/assets/units/<body>.anim.bin`,
  are the motion in a form close to the clips themselves, so they follow the
  FBX files: generated locally by `tools/render/export_units.sh` and ignored
  by git. A build made where they exist carries them into the game, which
  is use in a project; a clone without them draws those units as sprites.
- The 0 A.D. motion sits apart in `public/assets/units/0ad/`, committed
  under its own licence as above.

This is a reading of Adobe's published terms, not legal advice.
