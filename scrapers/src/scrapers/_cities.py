#!/usr/bin/env python3
"""Shared search targets for the city scrapers.

Single source of truth for KEYWORDS, the country-wide sentinel, and the
German cities both the LinkedIn and Glassdoor scrapers sweep. Previously
this list was copy-pasted into each scraper and drifted apart on edits.

Radius-aware pruning
--------------------
The LinkedIn scraper now queries each city with a ~40 km radius
(``distance=25`` miles — see ``SEARCH_DISTANCE_MILES``). At that radius
many of the originally-curated cities fall inside a larger city's
catchment, so searching them again only re-fetches jobs the bigger
city's radius already returned. We prune greedily: walking the curated
list in priority order (metros first), we drop any city whose centre
lies within ``RADIUS_KM - BUFFER_KM`` (= 35 km) of a city we already
kept. The 5 km buffer leaves a margin so a dropped city's own periphery
stays comfortably inside the kept city's circle rather than right on its
edge.

``COUNTRYWIDE`` is never pruned — it is the nation-wide sweep and acts as
a safety net that still reaches any small town the radius pruning drops.
"""

from math import asin, cos, radians, sin, sqrt

KEYWORDS = [
    "AI",
    "LLM",
    "NLP",
    "AI Agent",
    "MLOps",
    "OpenAI",
    "RAG",
]

# Sentinel for the country-wide search. Each scraper recognises this value
# and runs a nation-wide pass (LinkedIn: location "Germany"; Glassdoor:
# the "Nation" location id) instead of a per-city filter.
COUNTRYWIDE = "Deutschland"

# LinkedIn "Distance" filter, in miles (the guest API's `distance` param is
# imperial regardless of UI locale). 25 mi ≈ 40 km — wide enough to pull in
# neighbouring towns (e.g. Neu-Ulm, Heidenheim around Ulm) that an exact-
# location search misses.
SEARCH_DISTANCE_MILES = 25
RADIUS_KM = 40.0
BUFFER_KM = 5.0

# Cities that bypass the redundancy prune even when they fall inside a
# kept city's radius. These are large/distinct labour markets worth
# searching in their own right despite geographic overlap — Düsseldorf
# (otherwise dropped for Köln) and Mainz (otherwise dropped for
# Frankfurt am Main).
FORCE_KEEP: set[str] = {"Düsseldorf", "Mainz"}

# Curated search targets as (name, lat, lon) in priority order — metros
# first, then tech hubs. Coordinates are city-centre approximations; only
# used for the redundancy prune below, so ~1 km precision is plenty.
_CITY_COORDS: list[tuple[str, float, float]] = [
    # Top metro areas
    ("Berlin", 52.520, 13.405),
    ("Hamburg", 53.550, 9.993),
    ("München", 48.137, 11.575),
    ("Köln", 50.937, 6.960),
    ("Frankfurt am Main", 50.110, 8.682),
    ("Stuttgart", 48.775, 9.182),
    ("Düsseldorf", 51.227, 6.773),
    ("Leipzig", 51.340, 12.375),
    ("Dortmund", 51.514, 7.466),
    ("Essen", 51.456, 7.012),
    ("Bremen", 53.079, 8.802),
    ("Dresden", 51.050, 13.738),
    ("Hannover", 52.376, 9.740),
    # Bavaria / Baden-Württemberg tech hubs
    ("Ulm", 48.401, 9.987),
    ("Augsburg", 48.366, 10.894),
    ("Böblingen", 48.685, 9.011),
    ("Karlsruhe", 49.007, 8.404),
    ("Heidelberg", 49.398, 8.672),
    ("Mannheim", 49.487, 8.466),
    ("Darmstadt", 49.872, 8.651),
    ("Freiburg", 47.999, 7.842),
    ("Heilbronn", 49.142, 9.218),
    ("Nürnberg", 49.452, 11.077),
    ("Erlangen", 49.598, 11.004),
    ("Herzogenaurach", 49.567, 10.886),
    ("Ditzingen", 48.826, 9.066),
    ("Renningen", 48.766, 8.935),
    ("Immenstaad", 47.679, 9.366),
    ("Kitzingen", 49.740, 10.160),
    ("Ingolstadt", 48.766, 11.425),
    ("Regensburg", 49.013, 12.101),
    ("Sindelfingen", 48.713, 9.003),
    ("Friedrichshafen", 47.654, 9.479),
    ("Ottobrunn", 48.063, 11.667),
    ("Tübingen", 48.520, 9.055),
    ("Konstanz", 47.660, 9.175),
    ("Würzburg", 49.790, 9.950),
    # Rhein/Ruhr + central
    ("Wiesbaden", 50.082, 8.240),
    ("Mörfelden-Walldorf", 49.994, 8.586),
    ("Mainz", 49.992, 8.247),
    ("Bonn", 50.737, 7.098),
    ("Aachen", 50.776, 6.084),
    ("Bochum", 51.482, 7.216),
    ("Duisburg", 51.435, 6.763),
    ("Saarbrücken", 49.234, 6.997),
    ("Koblenz", 50.356, 7.589),
    ("Göttingen", 51.541, 9.916),
    ("Bielefeld", 52.030, 8.532),
    ("Münster", 51.960, 7.626),
    ("Paderborn", 51.719, 8.754),
    # North + East
    ("Wolfsburg", 52.423, 10.787),
    ("Braunschweig", 52.268, 10.526),
    ("Kiel", 54.323, 10.122),
    ("Lübeck", 53.866, 10.685),
    ("Rostock", 54.092, 12.099),
    ("Potsdam", 52.400, 13.066),
    ("Erfurt", 50.978, 11.029),
    ("Jena", 50.927, 11.589),
    ("Magdeburg", 52.120, 11.627),
    ("Halle", 51.482, 11.970),
    ("Chemnitz", 50.828, 12.921),
]


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two WGS84 points, in kilometres."""
    r = 6371.0088
    p1, p2 = radians(lat1), radians(lat2)
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(p1) * cos(p2) * sin(dlon / 2) ** 2
    return 2 * r * asin(sqrt(a))


def prune_cities(
    cities: list[tuple[str, float, float]],
    radius_km: float = RADIUS_KM,
    buffer_km: float = BUFFER_KM,
    force_keep: set[str] = FORCE_KEEP,
) -> tuple[list[str], list[tuple[str, str, float]]]:
    """Greedily drop cities already covered by a kept higher-priority city.

    Cities in ``force_keep`` are never dropped, even when they fall inside
    a kept city's radius. Returns ``(kept_names, dropped)`` where
    ``dropped`` is a list of ``(dropped_city, covered_by, distance_km)``
    for auditing.
    """
    threshold = radius_km - buffer_km
    kept: list[tuple[str, float, float]] = []
    dropped: list[tuple[str, str, float]] = []
    for name, lat, lon in cities:
        nearest: tuple[str, float] | None = None
        for kname, klat, klon in kept:
            d = _haversine_km(lat, lon, klat, klon)
            if nearest is None or d < nearest[1]:
                nearest = (kname, d)
        if name not in force_keep and nearest is not None and nearest[1] <= threshold:
            dropped.append((name, nearest[0], round(nearest[1], 1)))
            continue
        kept.append((name, lat, lon))
    return [n for n, _, _ in kept], dropped


_KEPT, _DROPPED = prune_cities(_CITY_COORDS)

# Final sweep order: nation-wide pass first, then the pruned city list.
TARGET_CITIES: list[str] = [COUNTRYWIDE] + _KEPT

# Exposed for auditing / logging which cities the radius prune removed.
PRUNED_CITIES: list[tuple[str, str, float]] = _DROPPED


if __name__ == "__main__":
    print(f"Radius {RADIUS_KM:.0f} km, buffer {BUFFER_KM:.0f} km "
          f"(drop threshold {RADIUS_KM - BUFFER_KM:.0f} km)\n")
    print(f"KEPT ({len(_KEPT)} + nationwide):")
    for n in TARGET_CITIES:
        print(f"  {n}")
    print(f"\nDROPPED ({len(_DROPPED)}):")
    for name, by, dist in _DROPPED:
        print(f"  {name:<22} covered by {by} ({dist} km)")
