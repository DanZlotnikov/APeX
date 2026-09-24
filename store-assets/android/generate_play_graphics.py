"""One-off script: Google Play store graphics.

- play-icon-512.png: the 512x512 hi-res listing icon, a downscale of
  mobile/assets/icon.png. Play applies its own rounded-corner mask; the
  badge's ring is circular and centered, so the mask never clips it.
- feature-graphic-1024x500.png: required banner. Opaque RGB (Play rejects
  alpha here), same badge + palette as the app.

Run from the repo root: python store-assets/android/generate_play_graphics.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent
ICON_SRC = OUT.parent.parent / "mobile" / "assets" / "icon.png"
FONT = "C:/Windows/Fonts/bahnschrift.ttf"

# mobile/src/theme.ts
BG = (7, 16, 28)
SURFACE = (14, 30, 47)
PRIMARY = (0, 212, 188)
BORDER = (28, 46, 64)
TEXT = (240, 246, 255)
MUTED = (107, 127, 150)


def font(size: int, weight: str = "Bold") -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(FONT, size)
    try:
        f.set_variation_by_name(weight)
    except Exception:
        pass
    return f


def draw_spaced(draw, xy, text, fnt, fill, spacing):
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += draw.textbbox((0, 0), ch, font=fnt)[2] + spacing


def badge(draw, cx, cy, ring_d):
    # Same proportions as mobile/assets/generate_icon.py, scaled from its 820px ring.
    s = ring_d / 820
    r = ring_d / 2
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=PRIMARY, width=round(26 * s))
    r = round(ring_d * 110 / 140) / 2
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=SURFACE, outline=BORDER, width=max(1, round(10 * s)))
    f = font(round(164 * s))
    spacing = round(23 * s)
    widths = [draw.textbbox((0, 0), ch, font=f)[2] for ch in "APeX"]
    total = sum(widths) + spacing * 3
    bbox = draw.textbbox((0, 0), "APeX", font=f)
    draw_spaced(draw, (cx - total / 2, cy - (bbox[3] - bbox[1]) / 2 - bbox[1]), "APeX", f, PRIMARY, spacing)


def play_icon():
    Image.open(ICON_SRC).convert("RGB").resize((512, 512), Image.LANCZOS).save(OUT / "play-icon-512.png")


def feature_graphic():
    W, H = 1024, 500
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    # Content kept inside the central ~80%: Play may crop edges or overlay a play button.
    badge(d, 270, H // 2, 300)
    x = 470
    d.text((x, 150), "Tennis swing", font=font(54), fill=TEXT)
    d.text((x, 214), "analysis", font=font(54), fill=PRIMARY)
    d.text((x, 306), "Film your strokes. Get swing count,", font=font(28, "Regular"), fill=MUTED)
    d.text((x, 344), "swing range and knee bend.", font=font(28, "Regular"), fill=MUTED)
    img.save(OUT / "feature-graphic-1024x500.png")


if __name__ == "__main__":
    play_icon()
    feature_graphic()
    print("wrote", sorted(p.name for p in OUT.glob("*.png")))
