#!/usr/bin/env bash
# tests/fix.sh — Run the diagnostic sweep, then hand the results to Claude Code.
#
# Usage:
#   ./tests/fix.sh          # run diagnose → ask Claude to fix issues
#   ./tests/fix.sh --loop   # run diagnose → fix → re-run until clean (max 3 passes)
#
# Requires: Claude Code CLI (`claude`) to be installed and in PATH.

set -euo pipefail

ISSUES_FILE="tests/results/issues.json"
MAX_PASSES=3
LOOP=false
[[ "${1:-}" == "--loop" ]] && LOOP=true

run_diagnose() {
  echo "── Running diagnostic sweep ────────────────────────────────"
  # Allow failures (exit 1 when issues found) so we can read the JSON
  npm run test:diagnose --silent 2>&1 || true
}

has_issues() {
  [[ -f "$ISSUES_FILE" ]] && \
    python3 -c "import json,sys; d=json.load(open('$ISSUES_FILE')); sys.exit(0 if d['pagesWithIssues']>0 else 1)" 2>/dev/null
}

ask_claude_to_fix() {
  echo ""
  echo "── Handing issues to Claude Code ───────────────────────────"
  claude --print "$(cat <<'PROMPT'
I just ran the Playwright diagnostic sweep on the PoolPro site.
Read the file tests/results/issues.json for the full structured output,
and read tests/screenshots/diagnose/ for screenshots of each page.

For every issue listed:
1. Identify which source file (HTML/CSS/JS) is responsible.
2. Fix it directly — edit the file, don't just describe the fix.
3. Do not modify firebase.js.
4. After fixing all issues, briefly summarise what you changed and why.
PROMPT
)"
}

pass=1

run_diagnose

if ! has_issues; then
  echo "✓ No issues found — nothing to fix."
  exit 0
fi

ask_claude_to_fix

if $LOOP; then
  while has_issues && (( pass < MAX_PASSES )); do
    pass=$(( pass + 1 ))
    echo ""
    echo "── Pass $pass / $MAX_PASSES — re-running diagnose after fixes ──"
    run_diagnose
    if has_issues; then
      ask_claude_to_fix
    fi
  done

  if has_issues; then
    echo "⚠  Still has issues after $MAX_PASSES passes. Review tests/results/issues.json manually."
    exit 1
  else
    echo "✓ All issues resolved after $pass pass(es)."
  fi
fi
