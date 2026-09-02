"""
Crop every sprite down to the pixels that can actually be drawn.

    python3 tools/render/trim_sprites.py --out public/assets/sprites
    python3 tools/render/trim_sprites.py --dry-run

Why this exists
---------------
Every sprite is framed ONCE per body or building, from a box measured over all
its poses and rotations, and that one frame is then reused for every animation
frame and every facing. That is deliberate -- reframing per pose would make the
figure swim around its own feet -- but it means each individual sprite carries
the margin of the WORST pose in the set, and the cast shadow's soft tail on top
of that. Measured across the catalogue, a unit sprite is 36% drawable pixels
and 64% air.

That air is not free. Everything is packed into ONE texture at load time,
because the scene is drawn as a single back-to-front batch and sprites split
across two batches cannot be sorted against each other. One texture means one
hardware limit -- 8192 on a good deal of hardware -- and at sprite render scale
3 the catalogue was already 8192x6588 with nothing new in it.

So: crop each PNG to its own content and move its anchor by exactly the amount
cropped. Nothing moves on screen -- the anchor is what positions a sprite, and
shifting it by the crop offset is an identity. This is a packing change, not an
art change.

What counts as content
----------------------
The sprite shader discards any texel below alpha 0.02, which is 5 in eight-bit
terms. So a pixel of alpha 5 or less is not merely faint, it is never drawn at
all, under any zoom -- and the shadow catcher covers the whole frame in exactly
such pixels, which is why a plain "alpha > 0" bbox finds 99.9% of the frame
occupied and saves nothing.

MARGIN keeps a band of those undrawable pixels around the content rather than
cutting flush. The atlas mipmaps, and at the coarser levels a texel averages
several pixels across a frame boundary; cutting flush would let a neighbour's
content bleed into a sprite's edge when the camera is zoomed out. The packer
adds two more pixels of its own on top of this.

Idempotent: a second run finds the content already sitting MARGIN from every
edge and rewrites nothing.
"""

from __future__ import annotations
import argparse
import json
import os
import sys

try:
    import numpy as np
    from PIL import Image
except ImportError:                                        # pragma: no cover
    sys.exit("trim_sprites needs Pillow and numpy: pip install pillow numpy")

#: Alpha at or below which the sprite shader discards the texel outright.
#: Mirrors `uEpsilon`-independent `if (texel.a < 0.02) discard;` in sprites.ts.
ALPHA_FLOOR = 5

#: Undrawable pixels kept around the content, so mipmaps have somewhere to
#: blend before they reach the next sprite in the atlas.
MARGIN = 3


def content_box(alpha: np.ndarray) -> tuple[int, int, int, int] | None:
    """Bounding box of everything the shader would draw, or None if nothing is."""
    rows = np.nonzero((alpha > ALPHA_FLOOR).any(axis=1))[0]
    cols = np.nonzero((alpha > ALPHA_FLOOR).any(axis=0))[0]
    if not len(rows) or not len(cols):
        return None
    return int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1


def trim(path: str, dry: bool) -> tuple[int, int, int, int] | None:
    """
    Crop `path` to its content plus MARGIN.

    Returns (dx, dy, width, height) -- how far the top-left moved and the new
    size -- or None if the file is missing, empty, or already tight.
    """
    if not os.path.exists(path):
        return None
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    box = content_box(np.array(im)[:, :, 3])
    if box is None:
        # Nothing drawable at all. Leave it alone and let the caller say so:
        # a sprite that renders to nothing is a modelling bug, not a packing
        # one, and silently cropping it to a pixel would hide that.
        return None
    x0 = max(0, box[0] - MARGIN)
    y0 = max(0, box[1] - MARGIN)
    x1 = min(w, box[2] + MARGIN)
    y1 = min(h, box[3] + MARGIN)
    if (x0, y0, x1, y1) == (0, 0, w, h):
        return None
    if not dry:
        im.crop((x0, y0, x1, y1)).save(path, optimize=True)
    return x0, y0, x1 - x0, y1 - y0


def retarget(entry: dict, dx: int, dy: int, w: int, h: int) -> None:
    """Move the anchor by the crop, so the sprite lands exactly where it did."""
    entry["width"] = w
    entry["height"] = h
    entry["anchor_x"] = round(entry["anchor_x"] - dx, 2)
    entry["anchor_y"] = round(entry["anchor_y"] - dy, 2)


def pass_over(out: str, manifest: str, files, dry: bool) -> tuple[int, int, int, int]:
    """Trim every sprite a manifest names, and rewrite the manifest."""
    path = os.path.join(out, manifest)
    if not os.path.exists(path):
        print(f"!! no {manifest}, skipping", flush=True)
        return 0, 0, 0, 0
    with open(path) as fh:
        doc = json.load(fh)

    entries = doc["sprites"] if isinstance(doc, dict) else doc
    before = after = changed = empty = 0
    for e in entries:
        before += e["width"] * e["height"]
        got = trim(os.path.join(out, files(e)), dry)
        if got is None:
            after += e["width"] * e["height"]
            if not os.path.exists(os.path.join(out, files(e))):
                empty += 1
            continue
        dx, dy, w, h = got
        retarget(e, dx, dy, w, h)
        after += w * h
        changed += 1

    if not dry and changed:
        with open(path, "w") as fh:
            json.dump(doc, fh, indent=2)
    return before, after, changed, empty


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join("public", "assets", "sprites"))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    total_before = total_after = 0
    for manifest, files in (
        ("buildings.json", lambda e: f"{e['name']}_{e['rotation']}.png"),
        ("units.json", lambda e: f"{e['name']}.png"),
    ):
        b, a, n, missing = pass_over(args.out, manifest, files, args.dry_run)
        total_before += b
        total_after += a
        pct = 100.0 * a / b if b else 100.0
        print(f"{manifest}: {n} sprites trimmed, "
              f"{b / 1e6:.1f} -> {a / 1e6:.1f} Mpx ({pct:.0f}%)"
              + (f", {missing} files missing" if missing else ""), flush=True)

    pct = 100.0 * total_after / total_before if total_before else 100.0
    print(f"atlas content {total_before / 1e6:.1f} -> {total_after / 1e6:.1f} Mpx "
          f"({pct:.0f}%){' [dry run]' if args.dry_run else ''}", flush=True)


main()
