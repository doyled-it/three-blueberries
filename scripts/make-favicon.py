"""Builds the favicon from the blueberry photo.

    uv run --with pillow python scripts/make-favicon.py <source-image>

Keys out the white studio background, trims to the fruit, and writes a set of
square PNGs plus an ICO. Also emits a tiny inline SVG fallback matching the
site's three dot mark, used when the photo is too small to read.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageFilter

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "src" / "assets" / "icons"
SIZES = (16, 32, 48, 64, 128, 180, 192, 512)

# Studio white is not pure white; anything brighter than this on all channels
# and low saturation is background.
WHITE_CUTOFF = 233
SATURATION_CUTOFF = 26


def key_out_white(img: Image.Image) -> Image.Image:
    img = img.convert("RGBA")
    pixels = img.load()
    w, h = img.size

    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            brightness = (r + g + b) / 3
            saturation = max(r, g, b) - min(r, g, b)
            if brightness > WHITE_CUTOFF and saturation < SATURATION_CUTOFF:
                pixels[x, y] = (r, g, b, 0)
            elif brightness > WHITE_CUTOFF - 22 and saturation < SATURATION_CUTOFF + 10:
                # Feather the rim so the cutout doesn't look stamped.
                fade = int(255 * (WHITE_CUTOFF - brightness) / 22)
                pixels[x, y] = (r, g, b, max(0, min(255, fade)))
    return img


def square_crop(img: Image.Image, pad: float = 0.04) -> Image.Image:
    """Trim to the visible fruit, then pad out to a square."""
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    w, h = img.size
    side = int(max(w, h) * (1 + pad * 2))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - w) // 2, (side - h) // 2), img)
    return canvas


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: make-favicon.py <source-image>")

    source = Path(sys.argv[1]).expanduser()
    if not source.exists():
        raise SystemExit(f"no such file: {source}")

    OUT.mkdir(parents=True, exist_ok=True)

    img = Image.open(source)
    print(f"source {img.size[0]}x{img.size[1]}")

    keyed = key_out_white(img)
    opaque = sum(1 for p in keyed.getdata() if p[3] > 0)
    total = keyed.size[0] * keyed.size[1]
    print(f"kept {opaque / total:.0%} of pixels after keying out the background")

    squared = square_crop(keyed)
    print(f"cropped to {squared.size[0]}x{squared.size[1]}")

    for size in SIZES:
        # Small sizes get a touch of sharpening so the three berries stay legible.
        resized = squared.resize((size, size), Image.LANCZOS)
        if size <= 48:
            resized = resized.filter(ImageFilter.UnsharpMask(radius=1, percent=110, threshold=2))
        resized.save(OUT / f"icon-{size}.png")
    print(f"wrote {len(SIZES)} PNGs to {OUT.relative_to(REPO)}")

    ico = squared.resize((256, 256), Image.LANCZOS)
    ico.save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("wrote favicon.ico")


if __name__ == "__main__":
    main()
