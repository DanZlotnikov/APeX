"""One-off script to generate the Android adaptive-icon foreground
(assets/adaptive-icon-foreground.png).

Same badge design as assets/icon.png (see that script's own header) --
outer ring + inner filled circle + "APeX" wordmark -- but reworked for
Android's adaptive icon spec instead of a flat app icon:

- Transparent background (RGBA), not filled with the theme's bg color --
  app.json's android.adaptiveIcon.backgroundColor supplies that layer
  separately, composited underneath this foreground by the OS.
- The whole badge is scaled down to fit within Android's "safe zone" (the
  center ~66% of the canvas): adaptive icons get masked into a shape the
  launcher chooses at runtime (circle, squircle, rounded square, ...), and
  anything outside that inner zone risks being cropped depending on which
  shape a given launcher/device uses. The flat icon.png's ring occupies 80%
  of its canvas -- fine for iOS's fixed, unmasked square, too big here -- so
  everything below is scaled down by the same factor (620/820) rather than
  redrawn from different numbers, keeping the two icons' proportions
  identical.

Not part of the app build itself - run manually, then keep for
regeneration if the in-app badge ever changes.
"""
from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
SCALE = 620 / 820  # shrink icon.png's proportions to fit the adaptive safe zone
RING_D = round(820 * SCALE)          # ~620px = ~60.5% of canvas, inside the 66% safe zone
INNER_D = round(RING_D * (110 / 140))  # same ring:inner ratio as icon.png
RING_STROKE = round(26 * SCALE)
INNER_BORDER = round(10 * SCALE)

# Exact values from mobile/src/theme.ts. No BG here -- see module docstring.
SURFACE = (14, 30, 47)    # #0E1E2F
PRIMARY = (0, 212, 188)   # #00D4BC
BORDER = (28, 46, 64)     # #1C2E40

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
font = ImageFont.truetype("C:/Windows/Fonts/bahnschrift.ttf", round(164 * SCALE))
try:
    font.set_variation_by_name("Bold")
except Exception:
    pass

text = "APeX"
letter_spacing = round(23 * SCALE)
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

img.save("assets/adaptive-icon-foreground.png")
print("wrote assets/adaptive-icon-foreground.png", img.size, img.mode)
