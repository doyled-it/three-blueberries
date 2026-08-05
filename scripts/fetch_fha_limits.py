"""Regenerate lib/data/ca-fha-limits.ts from HUD's own loan-limit master file.

FHA has its OWN county loan limits and they are not the FHFA conforming limits
this project already ships. The engine used to check FHA loans against the
conforming table and, when they exceeded it, call them "a jumbo". An FHA loan is
never a jumbo: over the FHA limit it is simply not an FHA loan, which is a
different and worse problem for the borrower.

The two tables diverge by a lot below the ceiling, because they have different
floors. Both agencies set a county's limit at 115% of the area median sale
price, and both cap it at 150% of the national conforming baseline. But FHFA
FLOORS at the baseline ($832,750 for 2026) while FHA floors at 65% of it
($541,287). So in a county whose median is modest, FHFA reports the baseline and
FHA reports something far lower:

    Stanislaus   FHFA $832,750   FHA $545,100   (a $287,650 gap)
    Riverside    FHFA $832,750   FHA $690,000
    Sacramento   FHFA $832,750   FHA $764,750

Using the conforming limit for an FHA borrower in Stanislaus overstated what
FHA will insure by more than a quarter of a million dollars.

    uv run python scripts/fetch_fha_limits.py

Source is HUD's CHUMS master file, the same records behind the lookup tool at
entp.hud.gov, published as a fixed-width text file with a documented layout:

    https://apps.hud.gov/pub/chums/file_layouts.html
    https://apps.hud.gov/pub/chums/cy2026-forward-limits.txt

Prefer this over the "Areas Above Floor and Below Ceiling" PDF. That PDF omits
every county at the floor or the ceiling, and its metro names are the giveaway
for why a partial parse is dangerous here: Alpine County sits in the
GARDNERVILLE RANCHOS, NV-CA metro, so a parse anchored on ", CA" silently drops
a county whose limit ($736,000) is neither the floor nor the ceiling.

Refuses to write unless all 58 California counties are present, every limit
falls between the published floor and ceiling inclusive, and the limit types
reconcile against the floor. A silent partial parse would quietly hand somebody
a limit their loan does not qualify for.
"""

from __future__ import annotations

import re
import sys
import urllib.request
from pathlib import Path

YEAR = 2026
LIMITS_URL = f"https://apps.hud.gov/pub/chums/cy{YEAR}-forward-limits.txt"

# Mortgagee Letter 2025-23, the national floor and ceiling for a one-unit
# property. Everything parsed below has to land inside these.
NATIONAL_FLOOR = 541_287
NATIONAL_CEILING = 1_249_125

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT = REPO_ROOT / "lib" / "data" / "ca-fha-limits.ts"

# Fixed-width field positions, 1-indexed inclusive, from the layouts page.
# Converted to Python slices below.
FIELDS = {
    "msa_name": (11, 60),
    "soa_code": (61, 65),
    "limit_type": (66, 66),
    "median_price": (67, 73),
    "one_unit": (74, 80),
    "state": (102, 103),
    "fips": (104, 106),
    "county_name": (133, 147),
}


def field(line: str, name: str) -> str:
    start, end = FIELDS[name]
    return line[start - 1 : end].strip()


def title_case_county(raw: str) -> str:
    """Undo HUD's 15-character truncation of '<NAME> COUNTY'.

    The field is X(15), so 'LOS ANGELES COUNTY' arrives as 'LOS ANGELES COU'
    and 'SAN FRANCISCO COUNTY' as 'SAN FRANCISCO C'. Stripping a whole trailing
    'COUNTY' misses every one of those, which is what the reconciliation guard
    caught: ten counties came through with names like 'Santa Cruz Coun'. Strip
    any PREFIX of 'COUNTY' instead, then repair the two names long enough for
    the truncation to eat into the name itself.
    """
    name = re.sub(r"\s+C(O(U(N(T(Y)?)?)?)?)?$", "", raw).strip()
    # Fifteen characters is not enough for these two even before ' COUNTY'.
    repairs = {"SAN LUIS OBISP": "SAN LUIS OBISPO"}
    name = repairs.get(name, name)
    return " ".join(w.capitalize() for w in name.split())


def fetch(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "three-blueberries/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("latin-1")


def main() -> None:
    text = fetch(LIMITS_URL)

    counties: dict[str, dict[str, object]] = {}
    for line in text.splitlines():
        if len(line) < 147:
            continue
        if field(line, "state") != "CA":
            continue
        # 203B is the standard forward-mortgage Section of the Act. Anything
        # else in this file is a special program with its own limits.
        if field(line, "soa_code") != "203B":
            continue

        name = title_case_county(field(line, "county_name"))
        one_unit = int(field(line, "one_unit"))
        counties[name] = {
            "limit": one_unit,
            "median": int(field(line, "median_price")),
            "high_cost": field(line, "limit_type") == "H",
            "msa": field(line, "msa_name"),
            "fips": field(line, "fips"),
        }

    # --- reconciliation, before anything is written --------------------------
    problems: list[str] = []

    if len(counties) != 58:
        problems.append(f"expected 58 California counties, parsed {len(counties)}")

    for name, entry in counties.items():
        limit = entry["limit"]
        assert isinstance(limit, int)
        if not NATIONAL_FLOOR <= limit <= NATIONAL_CEILING:
            problems.append(f"{name}: ${limit:,} is outside the published floor/ceiling band")
        # 'S' means the county is AT the national floor. If HUD says standard
        # and the number is not the floor, one of the two is being misread.
        if not entry["high_cost"] and limit != NATIONAL_FLOOR:
            problems.append(f"{name}: typed Standard but the limit is ${limit:,}, not the floor")
        if entry["high_cost"] and limit <= NATIONAL_FLOOR:
            problems.append(f"{name}: typed High Cost but the limit is at or below the floor")

    # Cross-check against the names the rest of the project uses, so a HUD
    # renaming cannot silently produce a county this codebase cannot look up.
    known = re.findall(r"^\s+(?:\"([^\"]+)\"|([A-Za-z]+)):", (REPO_ROOT / "lib" / "data" / "ca-loan-limits.ts").read_text(), re.M)
    expected = {a or b for a, b in known}
    missing = expected - counties.keys()
    extra = counties.keys() - expected
    if missing:
        problems.append(f"missing from the HUD parse: {sorted(missing)}")
    if extra:
        problems.append(f"parsed counties this project does not know: {sorted(extra)}")

    if problems:
        print("REFUSING TO WRITE. The parse did not reconcile:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        sys.exit(1)

    # --- emit ----------------------------------------------------------------
    at_floor = sum(1 for e in counties.values() if not e["high_cost"])
    at_ceiling = sum(1 for e in counties.values() if e["limit"] == NATIONAL_CEILING)
    between = 58 - at_floor - at_ceiling

    lines = [
        "/**",
        " * GENERATED FILE. Do not hand-edit. Run `npm run data:fha-limits`.",
        " *",
        f" * FHA's own one-unit forward mortgage limit for every California county, CY{YEAR},",
        " * from HUD's CHUMS master file. This is the same record behind HUD's lookup",
        " * tool at entp.hud.gov, not a summary of it.",
        " *",
        " * THESE ARE NOT THE CONFORMING LIMITS. Both agencies set a county at 115% of",
        " * its area median sale price and cap it at 150% of the conforming baseline, but",
        " * FHFA floors at the baseline while FHA floors at 65% of it. Below the ceiling",
        " * the two diverge by a lot: Stanislaus is $832,750 conforming and",
        " * $545,100 FHA.",
        " *",
        f" * {at_floor} counties sit at the national floor of ${NATIONAL_FLOOR:,},",
        f" * {at_ceiling} at the ceiling of ${NATIONAL_CEILING:,}, and {between} in between.",
        " *",
        " * `medianPrice` is HUD's own median sale price estimate for the county, which is",
        " * what the limit is calculated from. It is NOT a current market median and must",
        " * not be presented as one: HUD uses the highest year since 2008 and the",
        " * high-price county within a metro, so it runs ahead of what houses are selling",
        " * for today.",
        " */",
        "",
        'import type { CaCounty } from "./ca-loan-limits.ts";',
        "",
        f"export const FHA_LIMIT_YEAR = {YEAR};",
        "/** 65% of the conforming baseline. The lowest FHA will insure anywhere. */",
        f"export const FHA_NATIONAL_FLOOR = {NATIONAL_FLOOR};",
        "/** 150% of the conforming baseline. The most FHA will insure anywhere. */",
        f"export const FHA_NATIONAL_CEILING = {NATIONAL_CEILING};",
        "",
        "export interface FhaCountyLimit {",
        "  /** One-unit forward mortgage limit. */",
        "  limit: number;",
        "  /** HUD's median sale price estimate, which the limit is 115% of. Not a market median. */",
        "  medianPrice: number;",
        "  /** False means the county is at the national floor. */",
        "  highCost: boolean;",
        "}",
        "",
        "export const CA_FHA_LIMITS: Record<CaCounty, FhaCountyLimit> = {",
    ]

    for name in sorted(counties):
        entry = counties[name]
        key = f'"{name}"' if " " in name else name
        lines.append(
            f"  {key}: {{ limit: {entry['limit']}, medianPrice: {entry['median']}, "
            f"highCost: {str(entry['high_cost']).lower()} }},"
        )

    lines += [
        "};",
        "",
        "/** FHA's one-unit limit for a county. Never the conforming limit. */",
        "export function fhaLimitFor(county: CaCounty): number {",
        "  return CA_FHA_LIMITS[county].limit;",
        "}",
        "",
    ]

    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {OUT.relative_to(REPO_ROOT)}")
    print(f"  {at_floor} at the floor, {between} in between, {at_ceiling} at the ceiling")
    ranked = sorted(counties.items(), key=lambda kv: kv[1]["limit"])
    print(f"  lowest:  {ranked[0][0]} ${ranked[0][1]['limit']:,}")
    print(f"  highest: {ranked[-1][0]} ${ranked[-1][1]['limit']:,}")


if __name__ == "__main__":
    main()
