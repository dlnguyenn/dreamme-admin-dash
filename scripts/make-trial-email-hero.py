"""Animated hero art for the trial emails (right half of a Live-Activity-style banner).

Sushi big and bleeding off the right/bottom edge, bobbing and swaying; gold
sparkles twinkle; bubbles (day 0) or little hearts (day 1) drift up.
Flat ground in the theme's banner colour, top-right corner rounded into the
page colour. One file per theme (blue, lux) and day.

usage: python scripts/make-trial-email-hero.py public/email
"""
import math
import sys
from PIL import Image, ImageDraw, ImageFilter

SRC = "C:/Users/Dan/Documents/DreamMe/claude/store-listings/search-card-2026-11/source/v6/"
OUT = sys.argv[1]

W, H = 480, 480  # 2x of 240x240
# Must match THEMES in src/lib/trial-emails/content.ts (hero, page).
THEMES = {
    "blue": {"sky": (45, 95, 138), "page": (234, 245, 250), "gold": (245, 166, 35), "bubble": (184, 228, 240)},
    "lux": {"sky": (230, 220, 207), "page": (244, 240, 234), "gold": (201, 162, 74), "bubble": (196, 178, 156)},
}
WHITE = (255, 255, 255)
CORAL = (244, 130, 106)
FRAMES = 16
MS = 110


def star(d: ImageDraw.ImageDraw, cx, cy, r, color, alpha):
    """Four-point sparkle."""
    w = r * 0.28
    pts = [(cx, cy - r), (cx + w, cy - w), (cx + r, cy), (cx + w, cy + w), (cx, cy + r), (cx - w, cy + w), (cx - r, cy), (cx - w, cy - w)]
    d.polygon(pts, fill=color + (int(255 * alpha),))


def heart(d: ImageDraw.ImageDraw, cx, cy, s, color, alpha):
    a = int(255 * alpha)
    r = s * 0.3
    d.ellipse([cx - 2 * r, cy - r * 1.6, cx, cy + r * 0.4], fill=color + (a,))
    d.ellipse([cx, cy - r * 1.6, cx + 2 * r, cy + r * 0.4], fill=color + (a,))
    d.polygon([(cx - 2 * r + 1, cy - r * 0.45), (cx + 2 * r - 1, cy - r * 0.45), (cx, cy + s * 0.75)], fill=color + (a,))


def make(pose: str, floaters: str, name: str, theme: str):
    pose_name = pose
    pal = THEMES[theme]
    SKY, PAGE, GOLD = pal["sky"], pal["page"], pal["gold"]
    sushi = Image.open(SRC + pose).convert("RGBA")
    sushi = sushi.crop(sushi.getbbox())
    scale = 470 / sushi.height
    sushi = sushi.resize((int(sushi.width * scale), int(sushi.height * scale)), Image.LANCZOS)

    # rounded top-right corner mask (radius 48 at 2x = 24px)
    corner = Image.new("L", (W, H), 255)
    cd = ImageDraw.Draw(corner)
    cd.rectangle([W - 48, 0, W, 48], fill=0)
    cd.pieslice([W - 96, 0, W, 96], 270, 360, fill=255)

    sparkles = [  # x, y, radius, colour, phase
        (70, 70, 22, GOLD, 0.0),
        (150, 36, 12, WHITE, 0.35),
        (40, 190, 14, WHITE, 0.6),
        (110, 300, 18, GOLD, 0.8),
        (440, 40, 14, GOLD, 0.15),
    ]
    floats = [(90, 0.0, 14), (180, 0.33, 10), (40, 0.66, 12), (240, 0.5, 9)]  # x, phase, size

    frames = []
    for f in range(FRAMES):
        t = f / FRAMES
        im = Image.new("RGBA", (W, H), SKY + (255,))
        d = ImageDraw.Draw(im, "RGBA")
        # soft bubble ring behind Sushi (the brand cover's circles)
        # floaters rising
        for x, ph, s in floats:
            p = (t + ph) % 1.0
            y = H + 20 - p * (H + 60)
            alpha = min(1.0, p * 4) * min(1.0, (1 - p) * 3)
            xx = x + 8 * math.sin(2 * math.pi * (p * 2 + ph))
            if floaters == "bubbles":
                d.ellipse([xx - s, y - s, xx + s, y + s], outline=pal["bubble"] + (int(220 * alpha),), width=3)
                d.ellipse([xx - s * 0.35, y - s * 0.55, xx - s * 0.05, y - s * 0.25], fill=(255, 255, 255) + (int(230 * alpha),))
            else:
                heart(d, xx, y, s * 1.5, CORAL, 0.9 * alpha)
        # Sushi: bob and sway
        dy = 10 * math.sin(2 * math.pi * t)
        rot = 4 * math.sin(2 * math.pi * t + math.pi / 3)
        s = sushi.rotate(rot, resample=Image.BICUBIC, expand=True)
        x = W - int(s.width * (0.90 if pose_name.endswith('waving.png') else 0.80))
        y = int(H - s.height * 0.88 + dy)
        im.alpha_composite(s, (x, y))
        # sparkles twinkle on top
        d = ImageDraw.Draw(im, "RGBA")
        for sx, sy, r, c, ph in sparkles:
            k = 0.5 + 0.5 * math.sin(2 * math.pi * (t + ph))
            star(d, sx, sy, r * (0.55 + 0.45 * k), c, 0.35 + 0.65 * k)
        # corner into page colour
        bg = Image.new("RGBA", (W, H), PAGE + (255,))
        im = Image.composite(im, bg, corner)
        frames.append(im.convert("RGB").resize((360, 360), Image.LANCZOS))

    # one shared palette keeps colours steady between frames
    pal = frames[0].quantize(colors=96, method=Image.Quantize.MEDIANCUT)
    q = [fr.quantize(palette=pal, dither=Image.Dither.NONE) for fr in frames]
    q[0].save(f"{OUT}/{name}.gif", save_all=True, append_images=q[1:], duration=MS, loop=0, optimize=True, disposal=1)


for theme in THEMES:
    make("clean_sushiwaving.png", "bubbles", f"hero-day0-{theme}", theme)
    make("clean_sushi_smiling_heart.png", "hearts", f"hero-day1-{theme}", theme)
print("ok")
