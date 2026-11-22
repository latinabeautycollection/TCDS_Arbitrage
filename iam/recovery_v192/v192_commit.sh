#!/usr/bin/env bash
# Commits the Recovery V1.9.2 staging package to the repo as iam/recovery_v192/ (develop), then merges develop into
# main --no-ff from a throwaway worktree, only if main has no file changes develop lacks. No co-author trailer.
#   CONFIRM=COMMIT-RECOVERY-V192 bash /tmp/recov192/v192_commit.sh
# Prints no secrets (aborts if anything that looks like one is in the files).
set -euo pipefail
[ "${CONFIRM:-}" = "COMMIT-RECOVERY-V192" ] || { echo "set CONFIRM=COMMIT-RECOVERY-V192"; exit 1; }
SRC=/tmp/recov192
REPO=/srv/arb-system/api
DEST=iam/recovery_v192
FILES=(README.md sha.txt sql flow644.sql v192_rehearse.sh v192_644_rehearse.sh stg_v192_install.sh graph_mail_check.sh v192_commit.sh)
cd "$SRC"; (sha256sum -c --quiet sha.txt) && echo "files: sha256 ok"
for f in "${FILES[@]}"; do [ -e "$f" ] || { echo "missing $SRC/$f - stopping"; exit 1; }; done
if grep -rnIE "postgres(ql)?://[^:/ ]+:[^@ ]+@|PGPASSWORD=['\"]?[^'\"\$ ]{6,}|(SECRET|PEPPER|HASH_KEY|PRIVATE_KEY)[A-Z_]*\s*[:=]\s*['\"][^'\"\$]{8,}" "${FILES[@]}"; then
  echo "possible secret above - stopping"; exit 1; fi
find "${FILES[@]}" -name '._*' -o -name '.DS_Store' | grep -q . && { echo "Mac junk files - stopping"; exit 1; }

cd "$REPO"
[ "$(git rev-parse --abbrev-ref HEAD)" = develop ] || { echo "repo is not on develop - stopping"; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "tracked files modified in the checkout - stopping"; exit 1; }
[ -e "$DEST" ] && { echo "$DEST already exists - stopping"; exit 1; }
git fetch -q origin
[ "$(git rev-list --count origin/develop..HEAD)" = 0 ] || { echo "local develop has unpushed commits - stopping"; exit 1; }
git merge -q --ff-only origin/develop
BASE=$(git rev-parse HEAD)
mkdir -p "$DEST"; (cd "$SRC" && cp -a "${FILES[@]}" "$REPO/$DEST/")
git add -- "$DEST"
n_files=$(find "$DEST" -type f | wc -l); n_staged=$(git diff --cached --name-only -- "$DEST" | wc -l)
[ "$n_files" = "$n_staged" ] || { echo "only $n_staged of $n_files files staged (.gitignore?) - unstaging, stopping"; git reset -q -- "$DEST"; rm -rf "$DEST"; exit 1; }
git commit -q -m "feat(iam): warehouse recovery V1.9.2 staging package + TCDS 644 runtime interface" -m "Vendor V1.9.2 SQL 634-643 as delivered (manifest-verified) plus TCDS 644:
- 644_pre records the 621 guard and the function owner's direct grants; 644_rollback_full returns the catalog to it.
- 644 replaces vendor 636/638: the vendor NOLOGIN roles could not run the vendor code on staging (no row-security
  rules on reset requests / sessions, SELECT-only grants under FOR UPDATE, no proof SELECT, login API without intake
  or queue access; the vendor 643 gate fails against 636). Instead tcds_login_api gets EXECUTE on 20 SECURITY DEFINER
  recovery_*_v192 functions owned by tcds_identity_function_owner, and no table access.
- Fixes D4 (stale code blocked new codes), D8 (two clock readings vs created+N CHECKs), D9 (second proof for the same
  reset), D10 (intake surfaced the 24h limit).
Staging rehearsals: vendor probes (v192_rehearse.sh); 644 functional flow 30/30 as tcds_login_api and full rollback
catalog-identical twice (v192_644_rehearse.sh). Staging install tool stg_v192_install.sh. Not on production." -- "$DEST"
git push -q origin develop; echo "develop: $(git log --oneline -1)"
if [ -z "$(git diff --name-only "$BASE" origin/main)" ]; then
  rm -rf /tmp/wt-main-v192; git worktree prune; git worktree add -q /tmp/wt-main-v192 origin/main
  git -C /tmp/wt-main-v192 merge --no-ff -q -m "Merge develop: warehouse recovery V1.9.2 staging package + 644" origin/develop
  git -C /tmp/wt-main-v192 push -q origin HEAD:main; git worktree remove /tmp/wt-main-v192; echo "main merged"
else echo "!! main has file changes develop did not have - main left untouched"; git diff --name-only "$BASE" origin/main | head; fi
git fetch -q origin; echo "develop=$(git rev-parse --short origin/develop) main=$(git rev-parse --short origin/main) branch=$(git rev-parse --abbrev-ref HEAD)"
