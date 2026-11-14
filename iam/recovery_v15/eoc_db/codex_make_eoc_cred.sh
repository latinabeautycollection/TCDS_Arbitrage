#!/usr/bin/env bash
# FOR CODEX, on the acquisition server (23.239.12.166), run as root:  bash /tmp/codex_make_eoc_cred.sh
# Creates the EOC staging database credential LOCALLY. The password never leaves this server.
# Writes /etc/tcds/eoc-staging/secrets/eoc_retail_db.env (tcds-eoc:tcds-eoc 0600) and prints ONLY the SCRAM-SHA-256
# verifier, which is safe to share: it cannot be used to log in and cannot be reversed to the password.
set -euo pipefail
umask 077
F=/etc/tcds/eoc-staging/secrets/eoc_retail_db.env
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
[ -e "$F" ] && { echo "$F already exists - stopping"; exit 1; }
command -v node >/dev/null || { echo "node not found"; exit 1; }
PW=$(openssl rand -hex 32)
VER=$(PW="$PW" node -e 'const c=require("crypto"),pw=process.env.PW,salt=c.randomBytes(16),it=4096;
  const sp=c.pbkdf2Sync(pw,salt,it,32,"sha256"),h=(k,m)=>c.createHmac("sha256",k).update(m).digest();
  const stored=c.createHash("sha256").update(h(sp,"Client Key")).digest();
  process.stdout.write(`SCRAM-SHA-256$${it}:${salt.toString("base64")}$${stored.toString("base64")}:${h(sp,"Server Key").toString("base64")}`)')
printf 'EOC_DB_USER=eoc_iam_bff_stg\nEOC_DB_PASSWORD=%s\nEOC_DATABASE_URL=postgres://eoc_iam_bff_stg:%s@db.crydmokyojaynmrtxkym.supabase.co:5432/postgres?sslmode=require\n' \
  "$PW" "$PW" > "$F"
chown tcds-eoc:tcds-eoc "$F"; chmod 600 "$F"; unset PW
ls -l "$F"
echo "Send this verifier (one line) to the Warehouse team:"
echo "$VER"
