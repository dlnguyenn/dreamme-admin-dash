"""Five-star rating strip for the trial emails' proof line, one per theme.

Drawn at 2x (164x28) and shown at 82x14, filled with the theme's Sushi coral
(THEMES[...].dotNow in src/lib/trial-emails/content.ts). Run from the repo root:
    python scripts/make-trial-email-stars.py
"""
import math
from PIL import Image, ImageDraw

THEMES = {"blue": "#E8735C", "lux": "#D9705A"}
SS = 4  # supersample, then downscale for clean edges
STAR, GAP, H = 28, 6, 28


def star(cx: float, cy: float, r_out: float, r_in: float):
    pts = []
    for k in range(10):
        a = -math.pi / 2 + k * math.pi / 5
        r = r_out if k % 2 == 0 else r_in
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


for name, colour in THEMES.items():
    w = 5 * STAR + 4 * GAP
    img = Image.new("RGBA", (w * SS, H * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i in range(5):
        cx = (i * (STAR + GAP) + STAR / 2) * SS
        cy = (H / 2 + 1) * SS
        d.polygon(star(cx, cy, STAR / 2 * SS, STAR / 2 * 0.45 * SS), fill=colour)
    img.resize((w, H), Image.LANCZOS).save(f"public/email/stars-{name}.png", optimize=True)
    print(f"public/email/stars-{name}.png", w, H)
