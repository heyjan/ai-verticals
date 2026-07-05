#!/usr/bin/env bash
# Run an arbitrary command inside a detached tmux session so it survives
# SSH disconnects. Usage:
#   scripts/run-in-tmux.sh <session-name> <command...>
#
# If a session with the given name already exists, prints attach hint and
# exits non-zero rather than clobbering it. Pane stays open after the
# command finishes so you can read final output / exit status.

set -euo pipefail

if [ $# -lt 2 ]; then
  echo "usage: $0 <session-name> <command...>" >&2
  exit 64
fi

SESSION="$1"; shift
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "tmux session '$SESSION' already exists. Attach with: tmux attach -t $SESSION" >&2
  exit 1
fi

STATE_DIR="$(mktemp -d -t "tmux-${SESSION}-XXXXXX")"
SCRIPT="$STATE_DIR/cmd.sh"

{
  echo '#!/usr/bin/env bash'
  echo "cd $(printf '%q' "$ROOT")"
  echo "echo \"[\$(date -Iseconds)] running: $*\""
  printf '%q ' "$@"; echo
  echo 'rc=$?'
  echo 'echo "[$(date -Iseconds)] exit $rc"'
  echo 'echo "--- pane kept open; close with Ctrl-d ---"'
  echo 'exec bash'
} > "$SCRIPT"
chmod +x "$SCRIPT"

tmux new-session -d -s "$SESSION" "$SCRIPT"
echo "Started tmux session '$SESSION'."
echo "  attach: tmux attach -t $SESSION"
echo "  kill:   tmux kill-session -t $SESSION"
