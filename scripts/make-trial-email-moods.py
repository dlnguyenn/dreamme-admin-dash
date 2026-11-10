"""Day-1 mood tiles for the trial emails (Great / Okay / Rough / Tired).

Cropped from the shot-day Live Activity scenes in the app repo
(widgets/Assets.xcassets/{happy,content,sad,sleeping}sushi.imageset), with the
blue water shifted to warm sand so the tiles match the neutral email palette.
Sushi (coral/cream), sand, coral and greenery keep their colours.

usage: python scripts/make-trial-email-moods.py <dir with the four scene PNGs> public/email
"""
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw

SRC, OUT = sys.argv[1], sys.argv[2]
CROPS = {
    "great": ("happysushi.png", (285, 5, 445, 165)),
    "okay": ("contentsushi.png", (275, 170, 515, 410)),
    "rough": ("sadsushi.png", (195, 175, 435, 415)),
    "tired": ("sleepingsushi.png", (185, 140, 425, 380)),
}


def neutralize(im: Image.Image) -> Image.Image:
    hsv = cv2.cvtColor(np.asarray(im.convert("RGB")), cv2.COLOR_RGB2HSV).astype(np.float32)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    blue = (h >= 80) & (h <= 135) & (s > 40)  # OpenCV hue is 0-179
    hsv[..., 0] = np.where(blue, 18, h)
    hsv[..., 1] = np.where(blue, np.clip(s * 0.28, 0, 255), s)
    hsv[..., 2] = np.where(blue, np.clip(v * 0.55 + 110, 0, 255), v)
    return Image.fromarray(cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2RGB))


for name, (file, box) in CROPS.items():
    tile = neutralize(Image.open(f"{SRC}/{file}").crop(box)).resize((160, 160), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L", (160, 160), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, 159, 159], fill=255)
    tile.putalpha(mask)
    tile.save(f"{OUT}/mood-{name}.png", optimize=True)
print("ok")
