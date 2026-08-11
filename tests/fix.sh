#!/usr/bin/env bash
# tests/fix.sh — Run the diagnostic sweep, then hand the results to Claude Code.
#
# Usage:
#   ./tests/fix.sh             # sweep → fix → show diff
#   ./tests/fix.sh --loop      # sweep → fix → re-sweep until clean (max 3 passes)
#   ./tests/fix.sh --commit    # same as above, plus auto-commit each passing fix
#
# Requires: Claude Code CLI (`claude`) in PATH.

set -euo pipefail

ISSUES_FILE="tests/results/issues.json"
MAX_PASSES=3
LOOP=false
AUTO_COMMIT=false

for arg in "$@"; do
  [[ "$arg" == "--loop"   ]] && LOOP=true
  [[ "$arg" == "--commit" ]] && AUTO_COMMIT=true && LOOP=true
done

# ── Helpers ──────────────────────────────────────────────────────────────────

run_diagnose() {
  echo ""
  echo "── Diagnostic sweep ────────────────────────────────────────"
  npm run test:diagnose --silent 2>&1 || true
}

has_issues() {
  [[ -f "$ISSUES_FILE" ]] && \
    python3 -c "
import json, sys
d = json.load(open('$ISSUES_FILE'))
sys.exit(0 if d['pagesWithIssues'] > 0 else 1)
" 2>/dev/null
}

show_diff() {
  echo ""
  echo "── Changes made ────────────────────────────────────────────"
  if git diff --quiet 2>/dev/null; then
    echo "  (no file changes detected)"
  else
    # Stat summary first (which files, how many lines)
    git diff --stat
    echo ""
    # Full diff, with colour if the terminal supports it
    git diff --color=always
  fi
}

commit_fixes() {
  local pass="$1"
  if git diff --quiet 2>/dev/null; then
    echo "  (nothing to commit)"
    return
  fi
  echo ""
  echo "── Committing pass-$pass fixes ─────────────────────────────"
  git add -A
  git commit -m "fix: Playwright auto-fix pass $pass ($(date '+%Y-%m-%d %H:%M'))" \
    --no-edit 2>/dev/null || \
  git commit -m "fix: Playwright auto-fix pass $pass ($(date '+%Y-%m-%d %H:%M'))"
  echo "  committed: $(git log -1 --oneline)"
}

ask_claude_to_fix() {
  echo ""
  echo "── Asking Claude Code to fix issues ────────────────────────"
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

# ── Main ─────────────────────────────────────────────────────────────────────

pass=1
run_diagnose

if ! has_issues; then
  echo ""
  echo "✓ No issues found — nothing to fix."
  exit 0
fi

ask_claude_to_fix
show_diff
$AUTO_COMMIT && commit_fixes "$pass"

if $LOOP; then
  while has_issues && (( pass < MAX_PASSES )); do
    pass=$(( pass + 1 ))
    echo ""
    echo "── Pass $pass / $MAX_PASSES ────────────────────────────────────"
    run_diagnose
    if has_issues; then
      ask_claude_to_fix
      show_diff
      $AUTO_COMMIT && commit_fixes "$pass"
    fi
  done

  echo ""
  if has_issues; then
    echo "⚠  Still has issues after $MAX_PASSES passes."
    echo "   Review tests/results/issues.json and tests/screenshots/diagnose/ manually."
    exit 1
  else
    echo "✓ All issues resolved after $pass pass(es)."
  fi
fi
