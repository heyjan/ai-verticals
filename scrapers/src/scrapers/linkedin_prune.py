#!/usr/bin/env python3
"""Detect LinkedIn listings that have stopped accepting applications.

When a LinkedIn job ad closes, its guest detail fragment
(`/jobs-guest/jobs/api/jobPosting/{id}`) keeps serving the cached job
card — title, company, description all still render — but the apply
call-to-action button is **replaced** by a "No longer accepting
applications" error banner. Unlike Xing (which answers 410 Gone), the
status stays 200, so the only reliable signal is in the body: the
apply CTA (`top-card-layout__cta`) is present on a live posting and
absent once it closes. The error banner itself is rendered client-side
and is *not* in the fetchable HTML, so we key off the button.

This module re-checks every active LinkedIn job we hold and emits the
primary keys of the closed ones so a downstream DB step can soft-delete
them (set active=false). It is the counterpart to the scrape pipeline:
scraping adds fresh listings, this prunes the closed ones — the same
role `scrapers.xing_prune` plays for Xing.

Conservative by design — a row is only flagged closed on a *positive*
signal: either the detail page is gone (404/410) or a real job card
rendered (`top-card-layout__title`) with the apply CTA missing. Network
errors, timeouts, rate-limit (429) exhaustion, bot walls, or any
ambiguous 200 with neither a card nor a CTA leave the row untouched (a
transient blip must never deactivate real data). The check order is
shuffled so we don't walk LinkedIn's IDs in a predictable sequence.

Input  : JSON array of DB rows `[{id, source_id, url, title, company}, ...]`.
Output : JSON `{dead_ids, dead, checked, alive, dead_count, unknown, ...}`
         for the deleter + the run log.

Usage (scrapers image, data mounted):
    python -m scrapers.linkedin_prune \
        --input  data/processed/linkedin-live.json \
        --output data/processed/linkedin-dead.json \
        --shard-mod 7
"""

import argparse
import json
import random
import time
from datetime import date
from pathlib import Path

from .linkedin_cities import DETAIL_URL, RATE_LIMIT_BACKOFFS, new_session

# A live guest job card renders an apply call-to-action; a closed one
# replaces it with the "No longer accepting applications" banner. The
# *base* `top-card-layout__cta` class is too broad — it also styles the
# sign-in CTA shown on closed cards — so we key off apply-specific
# markers: the apply modal trigger (present for both offsite *and* Easy
# Apply), the offsite-apply icon, and the primary-CTA styling the apply
# button carries. Any one present ⇒ still accepting applications. This is
# the exact signal that split the validation set 14 live / 26 closed.
APPLY_MARKERS = (
    'data-modal="job-details-topcard-apply-modal"',
    "apply-button__offsite-apply-icon-svg",
    "top-card-layout__cta--primary",
)

# Confirms the guest fragment actually rendered a job card (vs. a bot
# wall / interstitial / empty body). Required before we trust a missing
# CTA to mean "closed" rather than "blocked".
RENDER_MARKER = "top-card-layout__title"

# Client-side-rendered, so usually absent from the raw HTML — kept only
# as a backup positive signal in case LinkedIn ever inlines it.
CLOSED_MARKERS = ("no longer accepting applications", "signal-error-small")

# Statuses that mean "you're going too fast", not "this listing is dead".
# 429 is LinkedIn's documented rate limit; 999 is its legacy anti-bot
# block; 403 shows up under soft throttling. We back off on all three
# and, if they persist, treat the row as unknown (kept) — never dead.
THROTTLE_CODES = (403, 429, 999)

# If this many requests in a row come back throttled even after a full
# backoff, we're soft-blocked; stop the sweep rather than dig in deeper.
MAX_CONSECUTIVE_THROTTLE = 5


def detail_url(row: dict) -> str:
    """Guest detail fragment URL for a row, keyed by the LinkedIn job id.

    `source_id` is the job id for every LinkedIn row; fall back to the
    trailing digits of the stored view URL if it's ever missing.
    """
    jid = str(row.get("source_id") or "").strip()
    if not jid:
        jid = row["url"].rstrip("/").split("-")[-1].split("?")[0]
    return DETAIL_URL.format(job_id=jid)


def fetch(session, url: str):
    """GET with retry/backoff on throttle responses (403/429/999).

    Returns the response (the last one even if still throttled), or None
    on a hard request error.
    """
    resp = None
    for attempt, wait in enumerate((0.0,) + RATE_LIMIT_BACKOFFS):
        if wait > 0:
            print(f"      throttled; sleeping {wait:.0f}s before retry {attempt}", flush=True)
            time.sleep(wait)
        try:
            resp = session.get(url, timeout=15, allow_redirects=True)
        except Exception as e:
            print(f"      request error: {e}", flush=True)
            return None
        if resp.status_code not in THROTTLE_CODES:
            return resp
    return resp


def classify(resp) -> str:
    """Return 'dead', 'alive', or 'unknown' for a fetched detail fragment.

    'unknown' means "could not determine" (transient/ambiguous) — the
    caller keeps the row. Only 'dead' triggers deactivation.
    """
    if resp is None:
        return "unknown"
    code = resp.status_code
    # The posting was removed entirely.
    if code in (404, 410):
        return "dead"
    if code != 200:
        return "unknown"
    body = resp.text
    # Apply CTA present → still accepting applications.
    if any(m in body for m in APPLY_MARKERS):
        return "alive"
    low = body.lower()
    # No CTA, but a real card rendered (or the closed banner inlined) →
    # the listing has closed.
    if RENDER_MARKER in body or any(m in low for m in CLOSED_MARKERS):
        return "dead"
    # 200 with neither a card nor a CTA — bot wall, interstitial, partial
    # render. Don't risk deactivating a live job.
    return "unknown"


def main() -> None:
    ap = argparse.ArgumentParser(description="Flag LinkedIn listings that have stopped accepting applications")
    ap.add_argument("--input", required=True, help="JSON array of DB LinkedIn rows [{id, source_id, url, title, company}]")
    ap.add_argument("--output", required=True, help="Where to write the {dead_ids, ...} result")
    ap.add_argument("--delay-min", type=float, default=4.5, help="Min delay between requests (default: 4.5)")
    ap.add_argument("--delay-max", type=float, default=8.0, help="Max delay between requests (default: 8.0)")
    ap.add_argument("--shard-mod", type=int, default=0,
                    help="Spread the sweep over N days: each run only checks rows whose "
                         "id %% N matches today's shard, so a full pass takes N days and no "
                         "single run hammers LinkedIn. 0 = check everything in one run.")
    ap.add_argument("--limit", type=int, default=0, help="Only check the first N rows (0 = all; for testing)")
    args = ap.parse_args()

    rows = json.loads(Path(args.input).read_text(encoding="utf-8"))
    rows = [r for r in rows if r.get("url") or r.get("source_id")]

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

    # Shuffle so we don't sweep LinkedIn's IDs in a predictable order.
    random.shuffle(rows)
    if args.limit:
        rows = rows[: args.limit]
    total = len(rows)
    print(f"Checking {total} LinkedIn listings (GET, delay {args.delay_min}-{args.delay_max}s)...", flush=True)

    session = new_session()
    dead: list[dict] = []
    alive = unknown = 0
    consecutive_throttle = 0
    aborted = False
    checked = 0

    for i, row in enumerate(rows, start=1):
        resp = fetch(session, detail_url(row))
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
        verdict = classify(resp)
        if verdict == "dead":
            code = resp.status_code if resp is not None else "?"
            dead.append({
                "id": row["id"],
                "url": row.get("url", ""),
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
    print(f"Wrote {len(dead)} closed listing(s) -> {out}")
    if dead:
        sample = dead[: min(10, len(dead))]
        print(f"\nSample of {len(sample)} (of {len(dead)}) listings flagged as closed:")
        for d in sample:
            print(f"  [{d['id']}] ({d['status']}) {d['title']} @ {d['company']}")


if __name__ == "__main__":
    main()
