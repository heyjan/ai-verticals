#!/usr/bin/env bash
# Run the daily pipeline inside a tmux session that survives SSH disconnects.
#
# Layout:
#   window 0 "scrape"   pane 0 (top)    linkedin   (slow; rate-limited)
#                       pane 1 (middle) glassdoor  (proxy; ~30 min)
#                       pane 2 (bottom) xing       (no auth; fastest)
#   window 1 "pipeline-fast"  waits for glassdoor + xing → full pipeline
#                             (merge → clean → import → categorize → classify)
#                             LinkedIn is NOT a blocker here.
#   window 2 "pipeline-late"  waits for linkedin → merge-all → clean →
#                             import (skip classify; subcategories already set)
#
# Sentinel files in $STATE_DIR record each scraper's exit status so the
# pipeline windows can detect a failure instead of hanging forever.

set -euo pipefail

SESSION="${SESSION:-ai-daily}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "tmux session '$SESSION' already exists."
  echo "  attach: tmux attach -t $SESSION"
  echo "  kill:   tmux kill-session -t $SESSION"
  exit 1
fi

STATE_DIR="$(mktemp -d -t ai-daily-XXXXXX)"
LINKEDIN_DONE="$STATE_DIR/linkedin.status"
GLASSDOOR_DONE="$STATE_DIR/glassdoor.status"
XING_DONE="$STATE_DIR/xing.status"

write_pane_script() {
  local out="$1" target="$2" sentinel="$3" label="$4"
  cat > "$out" <<EOF
#!/usr/bin/env bash
cd "$ROOT"
echo "[$label] starting at \$(date -Iseconds)"
make $target
rc=\$?
echo \$rc > "$sentinel"
echo "[$label] done at \$(date -Iseconds) with exit \$rc"
echo "--- pane kept open for inspection; close with Ctrl-d ---"
exec bash
EOF
  chmod +x "$out"
}

write_pane_script "$STATE_DIR/linkedin.sh"  scrape-linkedin-cities  "$LINKEDIN_DONE"  linkedin
write_pane_script "$STATE_DIR/glassdoor.sh" scrape-glassdoor-cities "$GLASSDOOR_DONE" glassdoor
write_pane_script "$STATE_DIR/xing.sh"      scrape-xing-cities      "$XING_DONE"      xing

# ---- pipeline-fast: kicks off as soon as glassdoor + xing finish --------
cat > "$STATE_DIR/pipeline-fast.sh" <<EOF
#!/usr/bin/env bash
cd "$ROOT"
echo "[pipeline-fast] waiting for glassdoor + xing sentinels in $STATE_DIR (LinkedIn not required)"
while [ ! -f "$GLASSDOOR_DONE" ] || [ ! -f "$XING_DONE" ]; do
  sleep 10
done
gd=\$(cat "$GLASSDOOR_DONE")
xg=\$(cat "$XING_DONE")
if [ "\$gd" != 0 ] && [ "\$xg" != 0 ]; then
  echo "[pipeline-fast] aborting — both glassdoor (=\$gd) and xing (=\$xg) failed"
  exec bash
fi

ARGS=""
GD_FILE=\$(ls -t data/raw/glassdoor_cities_*.json 2>/dev/null | grep -v _log_ | head -1)
[ -n "\$GD_FILE" ] && [ "\$gd" = 0 ] && ARGS="\$ARGS --glassdoor \$GD_FILE"
XG_FILE=\$(ls -t data/raw/xing_cities_*.json 2>/dev/null | grep -Ev '_log_|_partial_' | head -1)
[ -z "\$XG_FILE" ] && XG_FILE=\$(ls -t data/raw/xing_cities_partial_*.json 2>/dev/null | head -1)
[ -n "\$XG_FILE" ] && [ "\$xg" = 0 ] && ARGS="\$ARGS --xing \$XG_FILE"

# Opportunistically include LinkedIn if a fresh partial is already on disk;
# the late pipeline will redo it once the full file lands.
LK_FILE=\$(ls -t data/raw/linkedin_cities_partial_*.json 2>/dev/null | head -1)
[ -n "\$LK_FILE" ] && ARGS="\$ARGS --linkedin \$LK_FILE"

if [ -z "\$ARGS" ]; then
  echo "[pipeline-fast] aborting — no usable scraper outputs found"
  exec bash
fi
echo "[pipeline-fast] merging with ARGS=\$ARGS"
make merge ARGS="\$ARGS" \
  && make clean ARGS="--input data/processed/merged-latest.json --apply" \
  && make import categorize classify
rc=\$?
echo "[pipeline-fast] finished at \$(date -Iseconds) with exit \$rc"
exec bash
EOF
chmod +x "$STATE_DIR/pipeline-fast.sh"

# ---- pipeline-late: when linkedin eventually finishes, fold it in -------
cat > "$STATE_DIR/pipeline-late.sh" <<EOF
#!/usr/bin/env bash
cd "$ROOT"
echo "[pipeline-late] waiting for linkedin sentinel (this can take hours)"
while [ ! -f "$LINKEDIN_DONE" ]; do
  sleep 30
done
lk=\$(cat "$LINKEDIN_DONE")
if [ "\$lk" != 0 ]; then
  echo "[pipeline-late] linkedin exited rc=\$lk; checking for a partial to import anyway"
fi

LK_FILE=\$(ls -t data/raw/linkedin_cities_*.json 2>/dev/null | grep -Ev '_log_|_partial_' | head -1)
[ -z "\$LK_FILE" ] && LK_FILE=\$(ls -t data/raw/linkedin_cities_partial_*.json 2>/dev/null | head -1)
GD_FILE=\$(ls -t data/raw/glassdoor_cities_*.json 2>/dev/null | grep -v _log_ | head -1)
XG_FILE=\$(ls -t data/raw/xing_cities_*.json 2>/dev/null | grep -Ev '_log_|_partial_' | head -1)
[ -z "\$XG_FILE" ] && XG_FILE=\$(ls -t data/raw/xing_cities_partial_*.json 2>/dev/null | head -1)

if [ -z "\$LK_FILE" ]; then
  echo "[pipeline-late] no LinkedIn data on disk — nothing to do"
  exec bash
fi

ARGS="--linkedin \$LK_FILE"
[ -n "\$GD_FILE" ] && ARGS="\$ARGS --glassdoor \$GD_FILE"
[ -n "\$XG_FILE" ] && ARGS="\$ARGS --xing \$XG_FILE"
echo "[pipeline-late] re-merging with ARGS=\$ARGS"
# Skip classify: pipeline-fast already wired subcategories/tools for the
# overlap; UPSERT preserves them. We only re-run categorize so the new
# LinkedIn rows that land as 'Other' get a category.
make merge ARGS="\$ARGS" \
  && make clean ARGS="--input data/processed/merged-latest.json --apply" \
  && make import categorize
rc=\$?
echo "[pipeline-late] finished at \$(date -Iseconds) with exit \$rc"
exec bash
EOF
chmod +x "$STATE_DIR/pipeline-late.sh"

tmux new-session  -d -s "$SESSION" -n scrape "$STATE_DIR/linkedin.sh"
tmux split-window    -v -t "$SESSION:scrape"  "$STATE_DIR/glassdoor.sh"
tmux split-window    -v -t "$SESSION:scrape"  "$STATE_DIR/xing.sh"
tmux select-layout      -t "$SESSION:scrape" even-vertical
tmux new-window      -t "$SESSION"   -n pipeline-fast "$STATE_DIR/pipeline-fast.sh"
tmux new-window      -t "$SESSION"   -n pipeline-late "$STATE_DIR/pipeline-late.sh"
tmux select-window      -t "$SESSION:scrape"

cat <<EOF
Started tmux session '$SESSION'.
  attach:  tmux attach -t $SESSION
  detach:  Ctrl-b d
  windows: Ctrl-b 0 (scrape: linkedin / glassdoor / xing)
           Ctrl-b 1 (pipeline-fast — runs when glassdoor + xing finish)
           Ctrl-b 2 (pipeline-late — folds in LinkedIn whenever it finishes)
  state:   $STATE_DIR

Safe to disconnect SSH at any point.
EOF
