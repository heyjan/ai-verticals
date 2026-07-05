#!/usr/bin/env python3
"""Print live state of any in-progress scraper.

Reads the JSONL progress files written by `scrapers.linkedin_cities` /
`scrapers.glassdoor_cities`. Also lists running scrape processes from
the host's process table. Safe to run while a scrape is in flight —
the progress files are append-only with fsync after each event.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"


# ── helpers ───────────────────────────────────────────────────────────
def list_processes() -> list[dict]:
    """Find currently-running scrape processes (host or container).

    Matches the `python -m scrapers.<linkedin|glassdoor>_cities` pattern.
    Won't see processes inside a container that the host can't enumerate,
    but for `uv run` and bare `python -m` invocations this is exact.
    """
    try:
        out = subprocess.check_output(
            ["ps", "-eo", "pid,etime,cmd", "--no-headers"],
            text=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []

    procs: list[dict] = []
    pat = re.compile(r"scrapers\.(linkedin_cities|glassdoor_cities|xing_cities)\b")
    for line in out.splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) < 3:
            continue
        pid, etime, cmd = parts
        m = pat.search(cmd)
        if not m:
            continue
        procs.append({"pid": pid, "etime": etime, "source": m.group(1).split("_")[0], "cmd": cmd})
    return procs


def latest_progress_file(source: str) -> Path | None:
    if not RAW_DIR.exists():
        return None
    candidates = sorted(
        RAW_DIR.glob(f"{source}_cities_progress_*.jsonl"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return candidates[0] if candidates else None


def read_jsonl(path: Path) -> list[dict]:
    events: list[dict] = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    # Tail might be a partially-written line — skip.
                    continue
    except FileNotFoundError:
        pass
    return events


# ── reporters ─────────────────────────────────────────────────────────
def report_source(source: str) -> None:
    path = latest_progress_file(source)
    title = source.upper().rjust(11)
    if not path:
        print(f"  {title} │ no progress file")
        return

    events = read_jsonl(path)
    if not events:
        print(f"  {title} │ progress file empty: {path.name}")
        return

    starts = [e for e in events if e["event"] == "start"]
    finishes = [e for e in events if e["event"] == "finished"]
    city_starts = [e for e in events if e["event"] == "city_start"]
    city_dones = [e for e in events if e["event"] == "city_done"]
    city_errors = [e for e in events if e["event"] == "city_error"]
    total = city_starts[-1]["total"] if city_starts else (starts[-1]["cities"] and len(starts[-1]["cities"]))
    started_at = starts[-1]["ts"] if starts else "?"
    state = "FINISHED" if finishes else "RUNNING" if city_starts and not finishes else "STARTED"

    cum_total = sum((d.get("stats", {}).get("total_unique", 0)) for d in city_dones)
    cum_new = sum((d.get("stats", {}).get("new_vs_existing", 0)) for d in city_dones)

    print(f"  {title} │ {state:<8} · started {started_at}")
    print(f"             │ file: {path.name}")
    print(f"             │ {len(city_dones):>3}/{total or '?'} cities done · {cum_total} jobs · {cum_new} new · {len(city_errors)} errors")

    # Currently-running city (most recent city_start with no matching city_done/error)
    done_set = {e["city"] for e in city_dones} | {e["city"] for e in city_errors}
    in_flight = [e["city"] for e in city_starts if e["city"] not in done_set]
    if in_flight and not finishes:
        print(f"             │ \033[1mscraping: {in_flight[-1]}\033[0m")

    # Last 5 completed cities (most recent first)
    tail = city_dones[-5:] if city_dones else []
    if tail:
        print(f"             │ recent:")
        for d in reversed(tail):
            s = d.get("stats", {})
            print(f"             │   {d['city']:<22} {s.get('total_unique', 0):>4} jobs · {s.get('new_vs_existing', 0):>4} new")


def main() -> int:
    # 1. Running processes
    procs = list_processes()
    print()
    print("  ── SCRAPE STATUS ───────────────────────────────────────────")
    if procs:
        for p in procs:
            print(f"  PID {p['pid']:>6} · running {p['etime']:>8} · {p['source']}")
    else:
        print("  no scrape processes currently running")

    # 2. Per-source state
    print()
    report_source("linkedin")
    print()
    report_source("glassdoor")
    print()
    report_source("xing")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
