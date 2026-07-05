#!/usr/bin/env bash
# Full LinkedIn 24-hour pipeline, run linearly as one workflow:
#   1. scrape LinkedIn jobs posted in the past 24h   (make linkedin-24hours)
#   2. merge + within-batch dedup                     (make merge)
#   3. filter by AI relevance                          (make clean)
#   4. cross-DB dedup against the live DB + upsert      (make import)
#   5. categorize new 'Other' rows via DeepSeek         (make categorize)
#
# Reuses the existing make targets so the docker incantations stay in one
# place. Built to run unattended from cron and to survive SSH disconnects
# when launched via `BG=1 make linkedin-daily` (detaches into tmux).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Each sub-make must run in the foreground even if this script was itself
# launched with BG=1 (which would otherwise re-trigger the tmux wrapper for
# every step and spawn nested sessions).
unset BG

log() { echo "[linkedin-daily] $(date -Iseconds) $*"; }

# Final (non-partial, non-log) per-city output files, newest first.
newest_final() { ls -t data/raw/linkedin_cities_2*.json 2>/dev/null | head -1 || true; }

log "step 1/5 — scraping LinkedIn jobs posted in the past 24h"
before="$(newest_final)"
make linkedin-24hours

after="$(newest_final)"
if [ -z "$after" ] || [ "$after" = "$before" ]; then
  log "scrape produced no new output (newest still '${before:-none}') — aborting to avoid re-importing stale data"
  exit 1
fi
log "scrape output: $after"

log "step 2/5 — merge + within-batch dedup"
make merge ARGS="--linkedin $after"

log "step 3/5 — filter by AI relevance (clean, in place)"
make clean ARGS="--input data/processed/merged-latest.json --apply"

log "step 4/5 — cross-DB dedup against the live DB + upsert"
make import

# categorize hits the external DeepSeek API; a transient failure there must
# NOT mask a successful import (the rows are safely in the DB and just stay
# 'Other' — re-runnable with `make categorize`).
log "step 5/5 — categorize new 'Other' rows (DeepSeek)"
make categorize || log "WARNING categorize failed; new rows remain 'Other' — rerun 'make categorize' later"

log "pipeline complete"
