#!/usr/bin/env bash
set -Eeuo pipefail
# TCDS hardened pull-deploy.
# Usage: ./scripts/prod-pull-deploy.sh [branch]        (default: main)
#   SKIP_TESTS=1   bypass the test gate
#   RESTART_ALL=1  restart every PM2 process (default: only currently-online)
# NOTE: .env is gitignored, so it is never touched by this script.

APP_DIR="/srv/arb-system/api"
BRANCH="${1:-main}"
SSH_KEY="$HOME/.ssh/tcds_arb_prod"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3101/domain4/listing/health}"
export GIT_SSH_COMMAND="ssh -i $SSH_KEY -o IdentitiesOnly=yes"

cd "$APP_DIR"
echo "==> Deploy branch=$BRANCH  dir=$APP_DIR"

# 1) refuse to clobber uncommitted TRACKED changes (untracked files are preserved)
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ABORT: uncommitted tracked changes present — commit/stash first." >&2
  git status --short >&2
  exit 1
fi

PREV=$(git rev-parse --short HEAD)
echo "==> Rollback point: $PREV"

# 2) fetch + hard reset to target branch
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"
NEW=$(git rev-parse --short HEAD)
echo "==> Now at: $NEW"

# 3) deps + build BEFORE touching the running app (abort leaves prod running old dist)
npm ci
npm run build

# 4) test gate (safe default: abort on failure)
if [ "${SKIP_TESTS:-0}" = "1" ]; then
  echo "==> Tests SKIPPED"
else
  if ! npm test -- --runInBand --passWithNoTests; then
    echo "ABORT: tests failed — app NOT restarted. Roll back: git reset --hard $PREV && npm ci && npm run build" >&2
    exit 1
  fi
fi

# 5) restart PM2 (default: only online processes; RESTART_ALL=1 for all)
if [ "${RESTART_ALL:-0}" = "1" ]; then
  pm2 restart all --update-env
else
  ONLINE=$(pm2 jlist | python3 -c "import sys,json;print(' '.join(str(p['pm_id']) for p in json.load(sys.stdin) if p['pm2_env']['status']=='online'))")
  [ -n "$ONLINE" ] && pm2 restart $ONLINE --update-env || echo "WARN: no online PM2 processes"
fi
pm2 save

# 6) health check
sleep 4
if curl -sf "$HEALTH_URL" >/dev/null; then
  echo "==> HEALTHY. Deploy complete: $PREV -> $NEW"
else
  echo "WARN: health check FAILED post-restart. Rollback: git reset --hard $PREV && npm ci && npm run build && pm2 restart all --update-env" >&2
  exit 1
fi
