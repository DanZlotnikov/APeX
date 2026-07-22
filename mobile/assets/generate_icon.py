"""One-off script to generate a placeholder 1024x1024 app icon (assets/icon.png).
Not part of the app build itself - run manually, then delete or keep for regeneration.
Replace icon.png with real branding before final App Store submission.
"""
from PIL import Image, ImageDraw

SIZE = 1024
BG = (11, 18, 32)       # #0B1220 - app's dark navy background
ACCENT = (0, 212, 188)  # #00D4BC - app's teal primary accent

img = Image.new("RGB", (SIZE, SIZE), BG)
draw = ImageDraw.Draw(img)

# Simple "apex" mark: an upward chevron/peak, centered, with a flat base bar
# underneath - reads as a mountain peak / upward performance trend, avoids
# needing a font (icon should be a simple mark, not a wordmark, per HIG).
margin = 200
top = (SIZE // 2, margin)
left = (margin, SIZE - margin - 80)
right = (SIZE - margin, SIZE - margin - 80)
stroke = 70

draw.line([left, top], fill=ACCENT, width=stroke, joint="curve")
draw.line([top, right], fill=ACCENT, width=stroke, joint="curve")
# round the joints/ends so it doesn't look like two separate hard-edged bars
r = stroke // 2
for pt in (top, left, right):
    draw.ellipse([pt[0] - r, pt[1] - r, pt[0] + r, pt[1] + r], fill=ACCENT)

# base bar
base_y = SIZE - margin + 40
draw.rounded_rectangle(
    [margin, base_y, SIZE - margin, base_y + 56],
    radius=28,
    fill=ACCENT,
)

img.save("assets/icon.png")
print("wrote assets/icon.png", img.size, img.mode)
