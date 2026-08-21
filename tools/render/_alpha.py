import bpy, numpy as np
for name in ("keep_0.png", "keep_2.png", "hovel_2.png"):
    im = bpy.data.images.load(f"/Volumes/AI/Projects/Stronghold_New/public/assets/sprites/{name}")
    w, h = im.size
    a = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)
    alpha = a[:, :, 3]
    rgb = a[:, :, :3]
    lum = rgb.mean(axis=2)
    # shadow pixels: partially transparent AND dark
    partial = (alpha > 0.05) & (alpha < 0.95)
    shadowish = partial & (lum < 0.15)
    # of those, how many survive an alphaTest of 0.45 (drawn fully opaque black)?
    survive = shadowish & (alpha >= 0.45)
    print(f"RESULT|{name}|px={w*h}|partialAlpha={partial.sum()}"
          f"|darkPartial={shadowish.sum()}|survivingCutout={survive.sum()}"
          f"|meanAlphaOfThose={alpha[survive].mean() if survive.sum() else 0:.2f}", flush=True)
