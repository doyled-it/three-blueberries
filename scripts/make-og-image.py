"""Draws the social preview card.

    uv run --with pillow python scripts/make-og-image.py

This is the image that shows up when the link is pasted into a message, a Slack,
or a search result preview. It is 1200x630 because that is what every platform
crops to, and it is drawn rather than screenshotted so it stays legible when a
timeline renders it 400px wide.

It imports the berry geometry from make-favicon.py on purpose. The mark on the
card and the mark in the browser tab are then the same shapes by construction,
and cannot drift when one is edited.

The type is deliberately plain. A social card that tries to be a poster reads as
marketing, and the whole pitch of this site is that it is not selling anything.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "src" / "assets" / "og.png"

WIDTH, HEIGHT = 1200, 630
PAGE = (12, 10, 18, 255)
INK = (236, 231, 244, 255)
INK_2 = (182, 173, 199, 255)
INK_3 = (138, 129, 156, 255)
BERRY_BRIGHT = (192, 173, 255, 255)
RULE = (40, 32, 52, 255)

# The headline as it breaks on the page itself: runs per line, so the
# emphasised word can take the berry colour without hand-measured offsets.
TITLE_LINES = [
    [("What does this house", "ink")],
    [("actually", "berry"), (" cost?", "ink")],
]
KICKER = "THREE BLUEBERRIES"
SUB = "The real monthly cost of a California house, itemised and sourced."
FOOT = "blueberries.doyled-it.com"

# macOS ships these; the site's own Fraunces/IBM Plex are webfonts we would have
# to vendor. Falling back to the default bitmap font would look broken, so say so
# loudly rather than shipping something ugly.
SERIF_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
    "/System/Library/Fonts/Supplemental/Georgia.ttf",
    "/Library/Fonts/Georgia.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
]
SANS_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Helvetica.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]
MONO_CANDIDATES = [
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/Supplemental/Courier New Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
]


def load_font(candidates: list[str], size: int) -> ImageFont.FreeTypeFont:
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    raise SystemExit(f"No usable font found among {candidates}. Install one or edit the list.")


def berry_mark(size: int) -> Image.Image:
    """The icon, drawn by the favicon script so the two cannot diverge."""
    spec = importlib.util.spec_from_file_location("make_favicon", REPO / "scripts" / "make-favicon.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module.draw_icon(size)


def main() -> None:
    img = Image.new("RGBA", (WIDTH, HEIGHT), PAGE)
    draw = ImageDraw.Draw(img)

    margin = 80
    mark_size = 96
    img.alpha_composite(berry_mark(mark_size), (margin, margin))

    kicker_font = load_font(MONO_CANDIDATES, 22)
    title_font = load_font(SERIF_CANDIDATES, 78)
    sub_font = load_font(SANS_CANDIDATES, 30)
    foot_font = load_font(MONO_CANDIDATES, 24)

    # Kicker, vertically centred against the mark.
    draw.text(
        (margin + mark_size + 28, margin + mark_size / 2),
        " ".join(KICKER),
        font=kicker_font,
        fill=INK_3,
        anchor="lm",
    )

    # The headline, with the emphasised word in the berry colour, laid out by
    # measuring each run rather than guessing at spacing.
    colours = {"ink": INK, "berry": BERRY_BRIGHT}
    line_height = 92
    y = margin + mark_size + 58
    widest = 0.0
    for line in TITLE_LINES:
        x = float(margin)
        for text, colour in line:
            draw.text((x, y), text, font=title_font, fill=colours[colour])
            x += draw.textlength(text, font=title_font)
        widest = max(widest, x - margin)
        y += line_height

    draw.text((margin, y + 30), SUB, font=sub_font, fill=INK_2)

    draw.line([(margin, HEIGHT - 132), (WIDTH - margin, HEIGHT - 132)], fill=RULE, width=2)
    draw.text((margin, HEIGHT - 96), FOOT, font=foot_font, fill=INK_3)
    draw.text(
        (WIDTH - margin, HEIGHT - 96),
        "No lead capture. No email gate.",
        font=foot_font,
        fill=INK_3,
        anchor="ra",
    )

    # Nothing may run off the edge; a clipped headline is worse than no card.
    if margin + widest > WIDTH - margin:
        raise SystemExit(f"Headline is {round(margin + widest)}px wide, the card is {WIDTH - margin}px.")
    if margin + draw.textlength(SUB, font=sub_font) > WIDTH - margin:
        raise SystemExit("The subtitle overflows the card.")
    if y + 30 > HEIGHT - 150:
        raise SystemExit("The text block collides with the footer rule.")

    img.convert("RGB").save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT.relative_to(REPO)} ({OUT.stat().st_size // 1024} KB, {WIDTH}x{HEIGHT})")


if __name__ == "__main__":
    main()
