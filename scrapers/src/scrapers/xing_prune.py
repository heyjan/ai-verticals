#!/usr/bin/env python3
"""Detect Xing listings that have been taken down.

When a Xing job ad is removed, its detail URL no longer renders a
JSON-LD JobPosting — the server answers `410 Gone` (sometimes 404) and
the page shows the "This job ad isn't available." empty state (the
`job-not-available-styles` / `IllustrationEmptyStateSuitcase` markers).

This module re-checks every Xing job we hold and emits the primary keys
of the dead ones so a downstream DB step can soft-delete them (set
active=false). It is the counterpart to the scrape pipeline: scraping
adds fresh listings, this prunes the expired ones. Run weekly.

By default it uses **HEAD** requests: the removed-vs-live signal is the
HTTP status (410 vs 200), so we never download the ~140 KB page body —
~99% less bandwidth and a far lighter footprint than a full GET sweep of
~1600 URLs. A removed ad always answers 410 (the empty-state HTML only
renders under that status), so a HEAD 200 reliably means "still live".
`--method get` falls back to fetching the body and matching the
empty-state markers, for the rare case a takedown ever serves 200.

Conservative by design — a row is only flagged dead on a *positive*
not-available signal. Network errors, timeouts, rate-limit exhaustion,
5xx, or any ambiguous response leave the row untouched (a transient blip
must never deactivate real data). The check order is also shuffled so we
don't walk Xing's IDs in a predictable sequence.

Input  : JSON array of DB rows `[{id, url, title, company}, ...]`.
Output : JSON `{dead_ids: [...], dead: [...], checked, alive, dead_count,
         unknown}` for the deleter + the run log.

Usage (scrapers image, data mounted):
    python -m scrapers.xing_prune \
        --input  data/processed/xing-live.json \
        --output data/processed/xing-dead.json
"""

import argparse
import json
import random
import time
from datetime import date
from pathlib import Path

from .xing_cities import RATE_LIMIT_BACKOFFS, new_session

# Substrings unique to Xing's "job ad isn't available" empty state. The
# class hashes can drift, so these are only a *backup* signal (GET mode) —
# the authoritative one is the 410/404 status code.
NOT_AVAILABLE_MARKERS = ("job-not-available-styles", "IllustrationEmptyStateSuitcase")

# A live JobPosting page always embeds this in its JSON-LD block.
ALIVE_MARKER = '"JobPosting"'

# Statuses that mean "you're going too fast", not "this listing is dead".
# Observed: at ~1 req/s Xing starts answering 403 to perfectly live URLs
# (a soft rate-limit), alongside the documented 429. We back off on both
# and, if they persist, treat the row as unknown (kept) — never dead.
THROTTLE_CODES = (403, 429)

# If this many requests in a row come back throttled even after a full
# backoff, we're soft-blocked; stop the sweep rather than dig in deeper.
MAX_CONSECUTIVE_THROTTLE = 5


def fetch(session, url: str, method: str):
    """HEAD/GET with retry/backoff on throttle responses (403/429).

    Returns the response (the last one even if still throttled), or None
    on a hard request error.
    """
    fn = session.head if method == "head" else session.get
    resp = None
    for attempt, wait in enumerate((0.0,) + RATE_LIMIT_BACKOFFS):
        if wait > 0:
            print(f"      throttled; sleeping {wait:.0f}s before retry {attempt}", flush=True)
            time.sleep(wait)
        try:
            resp = fn(url, timeout=15, allow_redirects=True)
        except Exception as e:
            print(f"      request error: {e}", flush=True)
            return None
        if resp.status_code not in THROTTLE_CODES:
            return resp
    return resp


def classify(resp, method: str) -> str:
    """Return 'dead', 'alive', or 'unknown' for a fetched detail page.

    'unknown' means "could not determine" (transient/ambiguous) — the
    caller keeps the row. Only 'dead' triggers deactivation.
    """
    if resp is None:
        return "unknown"
    code = resp.status_code
    # 410 Gone is Xing's definitive "this listing was removed"; 404 too.
    if code in (404, 410):
        return "dead"
    if code != 200:
        return "unknown"
    if method == "head":
        # HEAD has no body. A removed ad answers 410, so 200 == live.
        # (Worst case is a false "alive" we keep — never a false "dead".)
        return "alive"
    body = resp.text
    if ALIVE_MARKER in body:
        return "alive"
    if any(m in body for m in NOT_AVAILABLE_MARKERS):
        return "dead"
    # 200 with neither a JobPosting nor the empty state — bot wall,
    # interstitial, partial render. Don't risk deactivating a live job.
    return "unknown"


def main() -> None:
    ap = argparse.ArgumentParser(description="Flag Xing listings that have been taken down")
    ap.add_argument("--input", required=True, help="JSON array of DB Xing rows [{id, url, title, company}]")
    ap.add_argument("--output", required=True, help="Where to write the {dead_ids, ...} result")
    ap.add_argument("--method", choices=("head", "get"), default="head",
                    help="head = status-only, no body download (default, much lighter); "
                         "get = fetch body and match the empty-state markers too")
    ap.add_argument("--delay-min", type=float, default=4.5, help="Min delay between requests (default: 4.5)")
    ap.add_argument("--delay-max", type=float, default=8.0, help="Max delay between requests (default: 8.0)")
    ap.add_argument("--shard-mod", type=int, default=0,
                    help="Spread the sweep over N days: each run only checks rows whose "
                         "id %% N matches today's shard, so a full pass takes N days and no "
                         "single run hammers Xing. 0 = check everything in one run.")
    ap.add_argument("--limit", type=int, default=0, help="Only check the first N rows (0 = all; for testing)")
    args = ap.parse_args()

    rows = json.loads(Path(args.input).read_text(encoding="utf-8"))
    rows = [r for r in rows if r.get("url")]

    # Daily sharding: pick today's slice by id %% N, keyed to the calendar
    # day so consecutive days cover consecutive shards and the whole set is
    # swept every N days. toordinal() advances by 1 each day, so the shard
    # cycles 0..N-1 cleanly regardless of weekday naming.
    if args.shard_mod > 1:
        shard = date.today().toordinal() % args.shard_mod
        before = len(rows)
        rows = [r for r in rows if int(r["id"]) % args.shard_mod == shard]
        print(f"Shard {shard}/{args.shard_mod} (today's slice): {len(rows)} of {before} active listings",
              flush=True)

    # Shuffle so we don't sweep Xing's IDs in a predictable order.
    random.shuffle(rows)
    if args.limit:
        rows = rows[: args.limit]
    total = len(rows)
    print(f"Checking {total} Xing listings ({args.method.upper()}, "
          f"delay {args.delay_min}-{args.delay_max}s)...", flush=True)

    session = new_session()
    dead: list[dict] = []
    alive = unknown = 0
    consecutive_throttle = 0
    aborted = False
    checked = 0

    for i, row in enumerate(rows, start=1):
        resp = fetch(session, row["url"], args.method)
        throttled = resp is not None and resp.status_code in THROTTLE_CODES
        if throttled:
            consecutive_throttle += 1
            if consecutive_throttle >= MAX_CONSECUTIVE_THROTTLE:
                print(f"\nAborting: {consecutive_throttle} consecutive throttled responses "
                      f"after backoff at {i}/{total} — likely soft-blocked. Stopping to "
                      f"avoid escalation; rerun later to finish.", flush=True)
                aborted = True
                break
        else:
            consecutive_throttle = 0

        checked = i
        verdict = classify(resp, args.method)
        if verdict == "dead":
            code = resp.status_code if resp is not None else "?"
            dead.append({
                "id": row["id"],
                "url": row["url"],
                "title": row.get("title", ""),
                "company": row.get("company", ""),
                "status": code,
            })
        elif verdict == "alive":
            alive += 1
        else:
            unknown += 1

        if i % 100 == 0 or i == total:
            print(f"  {i}/{total}  alive={alive} dead={len(dead)} unknown={unknown}", flush=True)
        if i < total:
            time.sleep(random.uniform(args.delay_min, args.delay_max))

    result = {
        "checked": checked,
        "total": total,
        "aborted": aborted,
        "alive": alive,
        "dead_count": len(dead),
        "unknown": unknown,
        "dead_ids": [d["id"] for d in dead],
        "dead": dead,
    }
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    status = "ABORTED (soft-blocked)" if aborted else "Done"
    print(f"\n{status}. checked={checked}/{total} alive={alive} dead={len(dead)} unknown={unknown}")
    print(f"Wrote {len(dead)} dead listing(s) -> {out}")
    if dead:
        sample = dead[: min(10, len(dead))]
        print(f"\nSample of {len(sample)} (of {len(dead)}) listings flagged as taken down:")
        for d in sample:
            print(f"  [{d['id']}] ({d['status']}) {d['title']} @ {d['company']}")


if __name__ == "__main__":
    main()
