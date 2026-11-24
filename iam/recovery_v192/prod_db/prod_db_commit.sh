#!/usr/bin/env bash
# Commits the production database rollout package (installed 2026-11-24) to iam/recovery_v192/prod_db/ on develop,
# then merges develop into main --no-ff from a throwaway worktree, only if main has no file changes develop lacks.
# No co-author trailer. Prints no secrets.   CONFIRM=COMMIT-PROD-DB bash /tmp/prod_recovery/prod_db_commit.sh
#   health   read-only: production login API still answers after the database install (no commit)
set -euo pipefail
SRC=/tmp/prod_recovery; REPO=/srv/arb-system/api; D=iam/recovery_v192/prod_db
if [ "${1:-}" = health ]; then
  echo "prod login API /ready -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8095/api/v1/auth/ready)   (expect 200)"
  echo "prod verifier :8091 -> $( (exec 3<>/dev/tcp/127.0.0.1/8091) 2>/dev/null && echo listening || echo DOWN)"
  echo "password login with a bad body -> $(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H 'origin: https://warehouse-app.tcdsolutionsgroup.com' -H 'sec-fetch-site: same-origin' --data '{}' http://127.0.0.1:8095/api/v1/auth/password/login)   (expect 400/401/403, not 500)"
  pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const p of JSON.parse(s||"[]"))if(/^login-v2-(api|verifier)$/.test(p.name))console.log(p.name+": "+p.pm2_env.status+" restarts="+p.pm2_env.restart_time)})'
  echo "errors in the last 200 log lines: $(pm2 logs login-v2-api --lines 200 --nostream --raw 2>/dev/null | grep -ciE 'error|exception|permission denied' || true)"
  exit 0
fi
[ "${CONFIRM:-}" = COMMIT-PROD-DB ] || { echo "set CONFIRM=COMMIT-PROD-DB  (or: health)"; exit 1; }
(cd "$SRC" && sha256sum -c --quiet sha.txt) && echo "files: sha256 ok"
if grep -rnIE "postgres(ql)?://[^:/ ]+:[^@ ]+@|-----BEGIN [A-Z ]*PRIVATE KEY|(SECRET|PEPPER|HASH_KEY|MASTER_KEY|PASSWORD)[A-Z_]*\s*[:=]\s*['\"][A-Za-z0-9+/=_-]{16,}['\"]" "$SRC"; then
  echo "possible secret above - stopping"; exit 1; fi
cd "$REPO"
[ "$(git rev-parse --abbrev-ref HEAD)" = develop ] || { echo "repo is not on develop - stopping"; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "tracked files modified in the checkout - stopping"; exit 1; }
git fetch -q origin; [ "$(git rev-list --count origin/develop..HEAD)" = 0 ] || { echo "local develop has unpushed commits - stopping"; exit 1; }
git merge -q --ff-only origin/develop; BASE=$(git rev-parse HEAD)
[ -e "$D" ] && { echo "$D already exists - stopping"; exit 1; }
mkdir -p "$D"; (cd "$SRC" && tar --exclude=.DS_Store -cf - .) | (cd "$D" && tar -xf -); git add -A -- "$D"
git diff --cached --name-only | grep -vq "^$D/" && { git reset -q; echo "unexpected paths staged - stopping"; exit 1; }
git commit -q -m "feat(iam): production database rollout of warehouse password recovery (603-645)" -m "Installed on production vfxlrkqgakqqbnbbgecp 2026-11-24 06:27Z in ONE transaction that commits only if the result matches
staging (in-transaction catalog comparison: 0 problems). Same chain and order staging received: 603+603a leadership,
V1.5 604-617 + 620, 621, 622, 623, 624+625 (v13 wrapper), 626, 628, 630, 644_pre + 634/635/637/640/641 + 644, 645.
Rehearsed on production first (rolled back): chain == staging, and all 12 rollbacks in reverse returned production
exactly to its starting state (catalog incl. owners/ACLs/RLS/policies/memberships + seeded role rows).
prod_rehearse.sh preflight|rehearse|rollback-rehearse|install|uninstall|status; catalog.sql fingerprint (search_path
pinned, NULL-safe, procedures handled). Login API / verifier / app not deployed yet." -- "$D"
git push -q origin develop; echo "develop: $(git log --oneline -1)"
if [ -z "$(git diff --name-only "$BASE" origin/main)" ]; then
  rm -rf /tmp/wt-main-pdb; git worktree prune; git worktree add -q /tmp/wt-main-pdb origin/main
  git -C /tmp/wt-main-pdb merge --no-ff -q -m "Merge develop: production database rollout of warehouse password recovery" origin/develop
  git -C /tmp/wt-main-pdb push -q origin HEAD:main; git worktree remove /tmp/wt-main-pdb; echo "main merged"
else echo "!! main has file changes develop did not have - main left untouched"; git diff --name-only "$BASE" origin/main | head; fi
git fetch -q origin; echo "develop=$(git rev-parse --short origin/develop) main=$(git rev-parse --short origin/main) branch=$(git rev-parse --abbrev-ref HEAD)"
