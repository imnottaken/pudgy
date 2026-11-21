#!/usr/bin/env bash
# Runs inside the pudgy GitHub Action. Everything arrives through env vars so
# nothing from the pull request is ever interpolated into a shell command.
set -uo pipefail

ACTION_DIR="${PUDGY_ACTION_DIR:?}"
WORKDIR="${PUDGY_WORKDIR:-.}"
PROD_FLAG=()
[ "${PUDGY_PROD:-false}" = "true" ] && PROD_FLAG=(--prod)
TMP="$(mktemp -d)"
trap 'git worktree remove --force "$TMP/base" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

pudgy() { node "$ACTION_DIR/dist/cli.js" "$@"; }

install_deps() {
  local dir="$1"
  if [ -n "${PUDGY_INSTALL:-}" ]; then
    (cd "$dir" && bash -c "$PUDGY_INSTALL")
  elif [ -f "$dir/pnpm-lock.yaml" ]; then
    (cd "$dir" && corepack enable >/dev/null 2>&1; pnpm install --frozen-lockfile --ignore-scripts)
  elif [ -f "$dir/yarn.lock" ]; then
    (cd "$dir" && corepack enable >/dev/null 2>&1; yarn install --frozen-lockfile --ignore-scripts)
  elif [ -f "$dir/package-lock.json" ] || [ -f "$dir/npm-shrinkwrap.json" ]; then
    (cd "$dir" && npm ci --ignore-scripts --no-audit --no-fund)
  else
    (cd "$dir" && npm install --ignore-scripts --no-audit --no-fund)
  fi
}

# 1. The pull request as it is now (dependencies are already installed).
if ! pudgy "$WORKDIR" --json ${PROD_FLAG[@]+"${PROD_FLAG[@]}"} > "$TMP/head.json"; then
  echo "pudgy: could not scan $WORKDIR. Run your install step before this action." >&2
  exit 1
fi

# 2. The base branch, for a before/after comparison. Best effort: a failure
#    here just means the comment shows no comparison.
BASE_ARGS=()
if [ -n "${PUDGY_BASE_SHA:-}" ] && git rev-parse --git-dir >/dev/null 2>&1; then
  REL="$(git rev-parse --show-prefix)"
  if git cat-file -e "$PUDGY_BASE_SHA" 2>/dev/null || git fetch --quiet --depth=1 origin "$PUDGY_BASE_SHA" 2>/dev/null; then
    if git worktree add --quiet --detach "$TMP/base" "$PUDGY_BASE_SHA" 2>/dev/null; then
      BASE_DIR="$TMP/base/$REL$WORKDIR"
      if [ -f "$BASE_DIR/package.json" ] && install_deps "$BASE_DIR" >"$TMP/install.log" 2>&1; then
        if pudgy "$BASE_DIR" --json ${PROD_FLAG[@]+"${PROD_FLAG[@]}"} > "$TMP/base.json" 2>/dev/null; then
          BASE_ARGS=(--base "$TMP/base.json")
        fi
      else
        echo "pudgy: could not install the base branch, so the comment will have no comparison." >&2
        tail -n 5 "$TMP/install.log" >&2 2>/dev/null || true
      fi
    fi
  fi
fi

pudgy "$WORKDIR" --markdown ${PROD_FLAG[@]+"${PROD_FLAG[@]}"} ${BASE_ARGS[@]+"${BASE_ARGS[@]}"} > "$TMP/comment.md" || exit 1

# 3. Always show it in the job summary; post it when we are allowed to.
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "$TMP/comment.md" >> "$GITHUB_STEP_SUMMARY"

if [ "${PUDGY_DRY_RUN:-}" = "1" ]; then
  cat "$TMP/comment.md"
  exit 0
fi

if [ -z "${PUDGY_PR_NUMBER:-}" ] || [ "${PUDGY_COMMENT:-true}" != "true" ]; then
  exit 0
fi

EXISTING="$(gh api "repos/$PUDGY_REPO/issues/$PUDGY_PR_NUMBER/comments" --paginate \
  --jq '.[] | select(.body | contains("<!-- pudgy-comment -->")) | .id' 2>/dev/null | head -n 1)"

if [ -n "$EXISTING" ]; then
  gh api -X PATCH "repos/$PUDGY_REPO/issues/comments/$EXISTING" -F body=@"$TMP/comment.md" >/dev/null
else
  gh api -X POST "repos/$PUDGY_REPO/issues/$PUDGY_PR_NUMBER/comments" -F body=@"$TMP/comment.md" >/dev/null
fi
STATUS=$?
if [ $STATUS -ne 0 ]; then
  # Pull requests from forks get a read-only token. The job summary still has the report.
  echo "::warning::pudgy could not post a pull request comment (read-only token?). The report is in the job summary."
fi
exit 0
