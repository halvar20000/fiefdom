# Third-party material

Everything in this repository is Fiefdom's own work under AGPL-3.0 unless it is
listed here. Nothing is listed yet.

## 0 A.D. animations — evaluated, not adopted

`tools/render/collada_anim.py` and `tools/render/retarget.py` were written to
read [0 A.D.](https://play0ad.com)'s animation set. **The tools are ours and
carry no third-party licence.** No 0 A.D. material is committed to this
repository, and nothing in `public/assets/` derives from any.

If that changes, the terms are:

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
