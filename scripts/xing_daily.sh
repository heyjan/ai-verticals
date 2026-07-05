#!/usr/bin/env bash
# Full Xing 24-hour pipeline, run linearly as one workflow:
#   1. scrape Xing per-city, last-24h activity window, radius 20
#   2. merge + within-batch dedup                     (make merge)
#   3. filter by AI relevance                          (make clean)
#   4. cross-DB dedup against the live DB + upsert      (make import)
#   5. categorize new 'Other' rows via DeepSeek         (make categorize)
#
# Xing's `sincePeriod=LAST_24_HOURS` filter (via `--since 24h`) bounds the
# scrape to the day's churn, exactly like LinkedIn's f_TPR window — so this is
# a near-clone of linkedin_daily.sh. Cross-DB dedup at import folds any reposts
# we already hold. Reuses the make targets; built to run unattended from cron.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Each sub-make must run in the foreground even if this script was itself
# launched with BG=1 (which would otherwise re-trigger the tmux wrapper for
# every step and spawn nested sessions).
unset BG

log() { echo "[xing-daily] $(date -Iseconds) $*"; }

# Final (non-partial, non-log) per-city output files, newest first.
newest_final() { ls -t data/raw/xing_cities_2*.json 2>/dev/null | head -1 || true; }

log "step 1/5 — scraping Xing (last 24h, radius 20)"
before="$(newest_final)"
make scrape-xing-cities ARGS="--since 24h --radius 20"

after="$(newest_final)"
if [ -z "$after" ] || [ "$after" = "$before" ]; then
  log "scrape produced no new output (newest still '${before:-none}') — no fresh Xing jobs in the last 24h, nothing to merge. Done."
  exit 0
fi
log "scrape output: $after"

log "step 2/5 — merge + within-batch dedup"
make merge ARGS="--xing $after"

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
