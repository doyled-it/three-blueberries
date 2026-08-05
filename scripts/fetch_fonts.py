"""Download the two typefaces so the site can serve them itself.

The footer says nothing you type is sent anywhere, and that was true of the
form. It was NOT true of the page: every view fetched Fraunces and IBM Plex Mono
from fonts.googleapis.com and fonts.gstatic.com, which hands a third party the
visitor's IP address, user agent and referring URL before they have clicked
anything. On a site whose entire pitch is "no lead capture, nothing sold", one
outbound request to an ad company is the wrong thing to have.

    uv run python scripts/fetch_fonts.py

Downloads the LATIN SUBSET only. The page's complete non-ASCII inventory is the
minus sign and an ellipsis, both of which the latin subset carries, so the
latin-ext and Cyrillic/Greek/Vietnamese cuts would be dead weight. If the copy
ever grows an accented character, this script prints the subset coverage so the
omission is visible rather than silent.

Both families are SIL Open Font License 1.1, which permits redistribution
provided the licence travels with the font. It is written alongside them.

Regenerating is only necessary to pick up an upstream font revision. The files
are committed, so a fresh clone needs no network access to render correctly.
"""

from __future__ import annotations

import re
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = REPO_ROOT / "src" / "assets" / "fonts"

# The same request the <link> used to make. Fraunces is variable on two axes, so
# roman and italic are one file each across the whole 400-600 weight range.
CSS_URL = (
    "https://fonts.googleapis.com/css2"
    "?family=Fraunces:ital,opsz,wght@0,9..144,400..600;1,9..144,400..600"
    "&family=IBM+Plex+Mono:wght@400;500"
    "&display=swap"
)

# Ask as a modern browser or Google serves the truetype fallback instead of woff2.
CHROME_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)

# Every character the built page contains outside ASCII lives in this range set.
LATIN_SUBSET_MARKER = "U+0000-00FF"

LICENCES = {
    "Fraunces": "https://raw.githubusercontent.com/undercasetype/Fraunces/master/OFL.txt",
    "IBM Plex Mono": "https://raw.githubusercontent.com/IBM/plex/master/LICENSE.txt",
}


def get(url: str, *, ua: str | None = None) -> bytes:
    headers = {"User-Agent": ua or "three-blueberries/1.0"}
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as response:
        return response.read()


def slug(family: str, style: str) -> str:
    base = family.strip("'\"").lower().replace(" ", "-")
    return f"{base}-{style}"


def main() -> None:
    css = get(CSS_URL, ua=CHROME_UA).decode("utf-8")

    faces: list[dict[str, str]] = []
    for block in re.finditer(r"@font-face \{(.*?)\}", css, re.S):
        body = block.group(1)

        def value(key: str) -> str:
            match = re.search(rf"{key}:\s*([^;]+);", body)
            return match.group(1).strip() if match else ""

        unicode_range = value("unicode-range")
        if not unicode_range.startswith(LATIN_SUBSET_MARKER):
            continue

        url_match = re.search(r"url\((https://[^)]+\.woff2)\)", body)
        if not url_match:
            continue

        faces.append(
            {
                "family": value("font-family"),
                "style": value("font-style"),
                "weight": value("font-weight"),
                "url": url_match.group(1),
                "range": unicode_range,
            }
        )

    if len(faces) != 4:
        print(
            f"REFUSING TO WRITE: expected 4 latin faces (Fraunces roman + italic, "
            f"IBM Plex Mono 400 + 500), found {len(faces)}.",
            file=sys.stderr,
        )
        for face in faces:
            print(f"  - {face['family']} {face['style']} {face['weight']}", file=sys.stderr)
        sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    written: list[tuple[str, int]] = []
    for face in faces:
        # Fraunces is variable, so the weight is a range and the style is the
        # only thing distinguishing its two files.
        variable = " " in face["weight"]
        name = slug(face["family"], face["style"] if variable else face["weight"].replace(" ", ""))
        path = OUT_DIR / f"{name}.woff2"
        data = get(face["url"])
        path.write_bytes(data)
        written.append((path.name, len(data)))

    for family, url in LICENCES.items():
        target = OUT_DIR / f"{slug(family, 'OFL')}.txt"
        target.write_bytes(get(url))

    total = sum(size for _, size in written)
    print(f"wrote {len(written)} fonts to {OUT_DIR.relative_to(REPO_ROOT)}")
    for name, size in sorted(written):
        print(f"  {name:34s} {size / 1024:6.1f} KB")
    print(f"  {'total':34s} {total / 1024:6.1f} KB")
    print(f"  subset: latin only ({faces[0]['range'][:38]}...)")


if __name__ == "__main__":
    main()
