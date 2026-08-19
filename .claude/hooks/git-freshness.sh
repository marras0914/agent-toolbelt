#!/usr/bin/env bash
# SessionStart hook — report how far this checkout is behind the remote.
#
# Read-only by design: it runs `git fetch` and nothing else. It never pulls,
# merges, rebases, or checks anything out, so it is safe with uncommitted
# changes and on a stacked feature branch, where an auto-pull could silently
# conflict or rebase work out from under an in-flight session.
#
# Silent when there is nothing to say — no output means the checkout is current.
# Also silent when offline or when git auth fails, so a plane ride does not
# produce a warning every single session.

set -uo pipefail

# Locate the repo from this script's own path (.claude/hooks/x.sh -> repo root)
# rather than trusting the caller's working directory.
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd) || exit 0
cd "$repo_root" 2>/dev/null || exit 0

git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# Bound the fetch so a hung network call can't stall session startup. `timeout`
# is not guaranteed present on every Git Bash install, so fall back rather than
# skipping the fetch entirely.
if command -v timeout >/dev/null 2>&1; then
  timeout 20 git fetch --quiet --prune 2>/dev/null || exit 0
else
  git fetch --quiet --prune 2>/dev/null || exit 0
fi

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0

notes=""
add() { if [ -n "$notes" ]; then notes="$notes; $1"; else notes="$1"; fi; }

upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)
if [ -n "$upstream" ]; then
  behind=$(git rev-list --count "HEAD..$upstream" 2>/dev/null || echo 0)
  ahead=$(git rev-list --count "$upstream..HEAD" 2>/dev/null || echo 0)
  if [ "${behind:-0}" -gt 0 ]; then add "$branch is $behind commit(s) BEHIND $upstream - pull before editing"; fi
  if [ "${ahead:-0}" -gt 0 ]; then add "$branch has $ahead unpushed commit(s)"; fi
else
  add "$branch has no upstream branch (never pushed)"
fi

# Also flag the default branch moving, which matters on a feature branch even
# when its own upstream is current.
default=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')
if [ -z "$default" ]; then default=master; fi
if [ "$branch" != "$default" ] && git rev-parse --verify --quiet "refs/remotes/origin/$default" >/dev/null 2>&1; then
  base_behind=$(git rev-list --count "HEAD..origin/$default" 2>/dev/null || echo 0)
  if [ "${base_behind:-0}" -gt 0 ]; then add "origin/$default has $base_behind commit(s) not in this branch"; fi
fi

if [ -z "$notes" ]; then exit 0; fi

# Branch names cannot contain a double quote, but escape anyway so a malformed
# ref can never emit invalid JSON and silently break the hook.
esc=$(printf '%s' "$notes" | sed 's/\\/\\\\/g; s/"/\\"/g')

printf '{"systemMessage":"git: %s","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Repo freshness checked at session start (fetch only, working tree untouched): %s"}}\n' "$esc" "$esc"
