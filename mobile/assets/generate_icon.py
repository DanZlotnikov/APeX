"""One-off script to generate the app icon (assets/icon.png).

Reproduces LoadingScreen.tsx's badge (outer ring + inner filled circle +
"APeX" wordmark) — same design as assets/splash-logo.png — but as an opaque
1024x1024 RGB square: app icons must have zero alpha channel (Apple rejects
icons with transparency; iOS applies its own corner rounding/masking), so
this fills the full canvas with the theme's background color instead of
leaving it transparent. Ring/border strokes are scaled up disproportionately
(not just by canvas size) so they stay visible once iOS downsamples this to
much smaller icon sizes. Not part of the app build itself - run manually,
then keep for regeneration if the in-app badge ever changes.
"""
from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
RING_D = 820
INNER_D = round(RING_D * (110 / 140))  # same ring:inner ratio as the in-app badge
RING_STROKE = 26   # thicker than a naive scale-up (~9px) so it survives downsampling
INNER_BORDER = 10

# Exact values from mobile/src/theme.ts.
BG = (7, 16, 28)          # #07101C
SURFACE = (14, 30, 47)    # #0E1E2F
PRIMARY = (0, 212, 188)   # #00D4BC
BORDER = (28, 46, 64)     # #1C2E40

img = Image.new("RGB", (SIZE, SIZE), BG)
draw = ImageDraw.Draw(img)
cx = cy = SIZE // 2

# Outer ring (unfilled, matches the static/base state of the pulsing ring).
r = RING_D / 2
draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=PRIMARY, width=RING_STROKE)

# Inner filled circle.
r = INNER_D / 2
draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=SURFACE, outline=BORDER, width=INNER_BORDER)

# "APeX" wordmark, manually letter-spaced (Pillow has no tracking param).
font = ImageFont.truetype("C:/Windows/Fonts/bahnschrift.ttf", 164)
try:
    font.set_variation_by_name("Bold")
except Exception:
    pass

text = "APeX"
letter_spacing = 23
widths = [draw.textbbox((0, 0), ch, font=font)[2] for ch in text]
total_w = sum(widths) + letter_spacing * (len(text) - 1)

# Vertical centering via the font's actual ink bbox, not its line metrics.
bbox = draw.textbbox((0, 0), text, font=font)
text_h = bbox[3] - bbox[1]
x = cx - total_w / 2
y = cy - text_h / 2 - bbox[1]
for ch, w in zip(text, widths):
    draw.text((x, y), ch, font=font, fill=PRIMARY)
    x += w + letter_spacing

img.save("assets/icon.png")
print("wrote assets/icon.png", img.size, img.mode)
