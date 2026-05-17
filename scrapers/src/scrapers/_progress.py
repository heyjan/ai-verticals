"""Append-only JSONL progress log shared by the city scrapers.

Each scrape run writes one file to `<output_dir>/<source>_cities_progress_<ts>.jsonl`,
appending a single line per event (start, city_start, city_done, error,
finished). Cheap to write, cheap to tail, survives crashes.

`make scrape-status` reads these files to show what's currently running.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path


class ProgressLog:
    def __init__(self, output_dir: Path, source: str, timestamp: str):
        self.path = output_dir / f"{source}_cities_progress_{timestamp}.jsonl"
        self.source = source
        self.timestamp = timestamp

    def _write(self, event: dict) -> None:
        event = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": self.source,
            **event,
        }
        # Append-only; create parents on first write.
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
            f.flush()
            os.fsync(f.fileno())  # status reader trusts what it sees on disk

    def start(self, cities: list[str], max_per_city: int) -> None:
        self._write({"event": "start", "cities": cities, "max_per_city": max_per_city, "pid": os.getpid()})

    def city_start(self, city: str, idx: int, total: int) -> None:
        self._write({"event": "city_start", "city": city, "idx": idx, "total": total})

    def city_done(self, city: str, idx: int, total: int, stats: dict) -> None:
        self._write({"event": "city_done", "city": city, "idx": idx, "total": total, "stats": stats})

    def city_error(self, city: str, idx: int, total: int, error: str) -> None:
        self._write({"event": "city_error", "city": city, "idx": idx, "total": total, "error": error})

    def finished(self, totals: dict) -> None:
        self._write({"event": "finished", "totals": totals})
