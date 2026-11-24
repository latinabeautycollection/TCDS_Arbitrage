#!/usr/bin/env bash
# Commits the production login rollout tooling (login API + verifier deploy, login site, approver, app deploy, test
# employee, verification) to iam/recovery_v192/prod_login/ on develop, then merges develop into main --no-ff from a
# throwaway worktree only if main has no file changes develop lacks. No co-author trailer. Prints no secrets.
#   CONFIRM=COMMIT-PROD-LOGIN bash /tmp/prod_recovery/login/prod_login_commit.sh
set -euo pipefail
SRC=/tmp/prod_recovery/login; REPO=/srv/arb-system/api; D=iam/recovery_v192/prod_login
[ "${CONFIRM:-}" = COMMIT-PROD-LOGIN ] || { echo "set CONFIRM=COMMIT-PROD-LOGIN"; exit 1; }
(cd "$SRC" && sha256sum -c --quiet sha.txt) && echo "files: sha256 ok"
if grep -rnIE "postgres(ql)?://[^:/ ]+:[^@ ]+@|-----BEGIN [A-Z ]*PRIVATE KEY|(SECRET|PEPPER|HASH_KEY|MASTER_KEY|PASSWORD)[A-Z_]*\s*[:=]\s*['\"][A-Za-z0-9+/=_-]{16,}['\"]" "$SRC"; then
  echo "possible secret above - stopping"; exit 1; fi
cd "$REPO"
[ "$(git rev-parse --abbrev-ref HEAD)" = develop ] || { echo "repo is not on develop - stopping"; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "tracked files modified in the checkout - stopping"; exit 1; }
git fetch -q origin; [ "$(git rev-list --count origin/develop..HEAD)" = 0 ] || { echo "local develop has unpushed commits - stopping"; exit 1; }
git merge -q --ff-only origin/develop; BASE=$(git rev-parse HEAD)
[ -e "$D" ] && { echo "$D already exists - stopping"; exit 1; }
mkdir -p "$D"; (cd "$SRC" && tar --exclude=.DS_Store --exclude='*.tgz' -cf - .) | (cd "$D" && tar -xf -); git add -A -- "$D"
git diff --cached --name-only | grep -vq "^$D/" && { git reset -q; echo "unexpected paths staged - stopping"; exit 1; }
git commit -q -m "feat(iam): warehouse password recovery live on production (login API, login site, approver, app)" -m "2026-11-24, after the database rollout (prod_db): production login API 6.1B + verifier 6.1C upgraded to the code staging
runs (compiled with production's tsc, byte-identical to staging's dist; Pack/Ship host untouched); central passkey host
https://login.tcdsolutionsgroup.com (nginx + Let's Encrypt, /approve/ + /enroll/ only); approver anthony.malone enrolled
his passkey on his own device and holds IAM_RECOVERY_DESTINATION_APPROVER; approval notices to his address (test email
confirmed); app rebuilt with the recovery screens + Recovery email menu (and Pack/Ship camera on for the LV2TEST checks).
First end-to-end test through the real screens passed (test employee recovery.test at LV2TEST): recovery email added,
code confirmed, approved by Anthony's passkey; forgot password -> approved by tictac's passkey -> emailed code -> new
password -> sign-in. Passkey page wording: 'device' (phone, tablet or computer), not 'laptop' (staging first).
Tools: prod_login_deploy.sh, prod_login_site.sh, prod_approver.sh, pwa_recovery_deploy.sh, prod_recovery_tester.sh,
prod_verify.sh, stg_device_wording.sh." -- "$D"
git push -q origin develop; echo "develop: $(git log --oneline -1)"
if [ -z "$(git diff --name-only "$BASE" origin/main)" ]; then
  rm -rf /tmp/wt-main-plg; git worktree prune; git worktree add -q /tmp/wt-main-plg origin/main
  git -C /tmp/wt-main-plg merge --no-ff -q -m "Merge develop: warehouse password recovery live on production" origin/develop
  git -C /tmp/wt-main-plg push -q origin HEAD:main; git worktree remove /tmp/wt-main-plg; echo "main merged"
else echo "!! main has file changes develop did not have - main left untouched"; git diff --name-only "$BASE" origin/main | head; fi
git fetch -q origin; echo "develop=$(git rev-parse --short origin/develop) main=$(git rev-parse --short origin/main) branch=$(git rev-parse --abbrev-ref HEAD)"
