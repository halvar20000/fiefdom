"""Composite sprites onto a flat field for eyeballing. Dev tool, not pipeline.

    blender -b -P tools/render/_sheet.py -- --out /tmp/x.png --bg 0.55,0.47,0.34 a.png b.png
"""
import os, sys
import bpy, numpy as np

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out, bg, files = "/tmp/sheet.png", (0.55, 0.47, 0.34), []
i = 0
while i < len(argv):
    if argv[i] == "--out": out = argv[i + 1]; i += 2
    elif argv[i] == "--bg": bg = tuple(float(v) for v in argv[i + 1].split(",")); i += 2
    else: files.append(argv[i]); i += 1

imgs = []
for f in files:
    im = bpy.data.images.load(f)
    w, h = im.size
    imgs.append(np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4))

pad = 12
H = max(a.shape[0] for a in imgs) + pad * 2
W = sum(a.shape[1] for a in imgs) + pad * (len(imgs) + 1)
canvas = np.zeros((H, W, 4), dtype=np.float32)
canvas[:, :, 0], canvas[:, :, 1], canvas[:, :, 2] = bg
canvas[:, :, 3] = 1.0

x = pad
for a in imgs:
    h, w, _ = a.shape
    al = a[:, :, 3:4]
    canvas[pad:pad + h, x:x + w, 0:3] = a[:, :, 0:3] * al + canvas[pad:pad + h, x:x + w, 0:3] * (1 - al)
    x += w + pad

ni = bpy.data.images.new("sheet", width=W, height=H, alpha=False)
ni.pixels = canvas.flatten().tolist()
ni.filepath_raw = out
ni.file_format = 'PNG'
ni.save()
print("SHEET", out, W, H)
