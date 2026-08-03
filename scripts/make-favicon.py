"""Draws the favicon: three blueberries, as a cartoon rather than a photo.

    uv run --with pillow python scripts/make-favicon.py

The site ships src/assets/icons/berries.svg as the primary icon, which scales
perfectly. This produces the PNG and ICO fallbacks by drawing the SAME shapes
programmatically, so the two never drift apart.

Why not the photograph: a photo of three blueberries on a white background is an
indistinct purple blob at 16px. Detail that survives that size has to be drawn,
not captured. Three rules do the work:

  1. Three circles in a triangle. The silhouette carries the meaning.
  2. A gap between each berry, cut in the page colour, so they stay countable.
  3. Three tints back to front, so depth survives when detail does not.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "src" / "assets" / "icons"
SIZES = (16, 32, 48, 64, 128, 180, 192, 512)

# Supersample, then downscale. Cheap antialiasing with no extra dependency.
SS = 16
CANVAS = 64

PAGE = (12, 10, 18, 255)

# (cx, cy, r, fill) in the 64x64 design space, painted back to front.
BERRIES = [
    (22, 24, 14.5, (91, 69, 168, 255)),
    (43, 26, 13.0, (122, 98, 210, 255)),
    (32, 43, 16.0, (155, 131, 232, 255)),
]
GAP = 2.5


def draw_icon(size: int) -> Image.Image:
    px = CANVAS * SS
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = lambda v: v * SS  # noqa: E731

    def circle(cx, cy, r, fill):
        d.ellipse([s(cx - r), s(cy - r), s(cx + r), s(cy + r)], fill=fill)

    for cx, cy, r, fill in BERRIES:
        # The gap is cut first, in the page colour, so the next berry reads as
        # separate rather than merging into a blob.
        circle(cx, cy, r + GAP, PAGE)
        circle(cx, cy, r, fill)

    # Highlights. Invisible below ~32px, which is fine; nothing depends on them.
    if size >= 32:
        hl = Image.new("RGBA", (px, px), (0, 0, 0, 0))
        hd = ImageDraw.Draw(hl)
        for (cx, cy, r, _), scale in zip(BERRIES, (0.31, 0.30, 0.33)):
            ox, oy = cx - r * 0.36, cy - r * 0.42
            rx, ry = r * scale, r * scale * 0.68
            hd.ellipse([s(ox - rx), s(oy - ry), s(ox + rx), s(oy + ry)], fill=(255, 255, 255, 56))
        img = Image.alpha_composite(img, hl)
        d = ImageDraw.Draw(img)

    # Calyx star on the front berry: the scar that makes it a blueberry.
    if size >= 48:
        cx, cy, r, _ = BERRIES[2]
        points = []
        for i in range(10):
            angle = math.pi / 2 + i * math.pi / 5
            radius = r * (0.44 if i % 2 == 0 else 0.19)
            points.append((s(cx + radius * math.cos(angle)), s(cy - radius * math.sin(angle))))
        d.polygon(points, fill=(42, 31, 77, 235))

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    for size in SIZES:
        draw_icon(size).save(OUT / f"icon-{size}.png")
    print(f"wrote {len(SIZES)} PNGs to {OUT.relative_to(REPO)}")

    base = draw_icon(256)
    base.save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("wrote favicon.ico")

    # Sanity: at 16px the three berries must still be three distinguishable
    # regions, or the icon has failed at the only size that really matters.
    tiny = draw_icon(16).convert("RGBA")
    tints = {p[:3] for p in tiny.getdata() if p[3] > 140}
    print(f"distinct tints at 16px: {len(tints)}")


if __name__ == "__main__":
    main()
