"""Cut a product photo out of a plain white, light-grey or fake-'transparent' checkerboard background.

usage: [MODE=all] [LARGEST=1] python3 scripts/cutout.py input.png output.png [crop x0 y0 x1 y1]
  MODE=all     every light colourless pixel is background (open filigree work; NOT for pieces with white stones)
  LARGEST=1    keep only the biggest piece (drops other items in the same photo)

How it works: pixels that are light and colourless (white / light grey, which covers baked-in checkerboards) AND connected
to the image border are treated as background. White stones INSIDE the jewellery are not touching the border, so they stay.
The edge is softened by 1-2 px so the cut-out sits naturally on skin. Check the result by eye: shadows on the backdrop and
light-coloured parts touching the edge of the photo can need a manual touch-up.
"""
import os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
if len(sys.argv) >= 7:
    im = im.crop(tuple(int(v) for v in sys.argv[3:7]))
a = np.asarray(im).astype(np.float32) / 255
mx, mn = a.max(2), a.min(2)
sat = (mx - mn) / np.maximum(mx, 1e-3)
allmode = os.environ.get('MODE') == 'all'
light = (mx > 0.70) & (sat < (0.2 if allmode else 0.10))  # white, off-white and light-grey checker squares
lab, _ = ndimage.label(light, structure=np.ones((3, 3)))  # 8-connected: checker squares only touch at corners
border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
bg = light if allmode else np.isin(lab, border[border > 0])
fg = ndimage.binary_opening(~bg, iterations=1)  # drop single-pixel specks
if os.environ.get('LARGEST'):
    fl, n = ndimage.label(ndimage.binary_dilation(fg, iterations=3))
    if n > 1:
        sizes = ndimage.sum(fg, fl, range(1, n + 1)); fg &= fl == (1 + int(np.argmax(sizes)))
alpha = ndimage.gaussian_filter(fg.astype(np.float32), 0.8)
alpha = np.clip((alpha - 0.15) / 0.7, 0, 1)
ys, xs = np.where(alpha > 0.05)
out = np.dstack([np.asarray(im), (alpha * 255).astype(np.uint8)])
out = out[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
Image.fromarray(out, 'RGBA').save(dst)
print(dst, out.shape[1], 'x', out.shape[0])
