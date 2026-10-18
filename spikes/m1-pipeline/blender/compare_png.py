# THROWAWAY SPIKE CODE (M1 pipeline spike, 2026-10-12). PSNR between screenshots.
# Blender -b --factory-startup --python compare_png.py -- ref.png a.png [b.png ...]
import sys

import bpy
import numpy as np


def load(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(h, w, 4)[..., :3]


args = sys.argv[sys.argv.index('--') + 1:]
ref = load(args[0])
for p in args[1:]:
    d = load(p) - ref
    mse = float(np.mean(d * d))
    psnr = 10 * np.log10(1.0 / mse) if mse > 0 else float('inf')
    print(f'[psnr] {p.split("/")[-1]}: {psnr:.1f} dB, max abs {float(np.abs(d).max()) * 255:.0f}/255')
