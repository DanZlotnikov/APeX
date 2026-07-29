"""One-off script to generate the splash-screen logo mark (assets/splash-logo.png).

Reproduces LoadingScreen.tsx's badge (outer ring + inner filled circle +
"APeX" wordmark) as a static transparent PNG, since the native splash screen
renders before any React Native/JS loads and can't use that component
directly. Not part of the app build itself - run manually, then keep for
regeneration if the in-app badge ever changes.
"""
from PIL import Image, ImageDraw, ImageFont

SCALE = 3
RING_D = 140 * SCALE
INNER_D = 110 * SCALE
RING_STROKE = round(1.5 * SCALE)
INNER_BORDER = round(1 * SCALE)
PAD = 40
SIZE = RING_D + PAD * 2

# Exact values from mobile/src/theme.ts, not the earlier approximation.
SURFACE = (14, 30, 47, 255)     # #0E1E2F
PRIMARY = (0, 212, 188, 255)    # #00D4BC
BORDER = (28, 46, 64, 255)      # #1C2E40

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)
cx = cy = SIZE // 2

# Outer ring (unfilled, matches the static/base state of the pulsing ring).
r = RING_D / 2
draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=PRIMARY, width=RING_STROKE)

# Inner filled circle.
r = INNER_D / 2
draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=SURFACE, outline=BORDER, width=INNER_BORDER)

# "APeX" wordmark, manually letter-spaced (Pillow has no tracking param).
font = ImageFont.truetype("C:/Windows/Fonts/bahnschrift.ttf", round(28 * SCALE))
try:
    font.set_variation_by_name("Bold")
except Exception:
    pass

text = "APeX"
letter_spacing = round(4 * SCALE)
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

img.save("assets/splash-logo.png")
print("wrote assets/splash-logo.png", img.size, img.mode)
