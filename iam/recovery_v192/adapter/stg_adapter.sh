#!/usr/bin/env bash
# STAGING ONLY. Warehouse password recovery V1.9.2 adapter for login-v2-api-staging (~/stg_login/6.1B, :8195).
#   status                                 read-only
#   deps                                   pinned @simplewebauthn/server@13.1.1 into ~/stg_login/recovery_deps (6.1B node_modules untouched)
#   config   CONFIRM=CONFIG-STG-RECOVERY   adds api.RECOVERY_* (+ M365_* copied from the Domain 10 .env) to config.json, flags OFF
#   build                                  compiles 6.1B + adapter in ~/stg_login/recovery_v192/build with the server's own tsc; changes nothing live
#   deploy   CONFIRM=DEPLOY-STG-RECOVERY   backs up, installs the built files, restarts the API (recovery still OFF)
#   enable   CONFIRM=ENABLE-STG-RECOVERY   RECOVERY_ENABLED + WORKERS true, restart, checks the mount
#   mode capture|graph CONFIRM=MODE-STG-RECOVERY   capture = code to a 0600 file (tests); graph = real email via alerts@
#   e2e      [TO=address]                  end-to-end test (graph mode: you paste the link + code from the email)
#   disable  CONFIRM=DISABLE-STG-RECOVERY  flags OFF, restart
#   rollback CONFIRM=ROLLBACK-STG-RECOVERY restores the backed-up files, removes the adapter, flags OFF, restart
# Prints no secrets. Copy first: scp -r ~/Downloads/recov192/adapter apifydev@139.177.200.80:/tmp/recov192/
set -euo pipefail
S=$HOME/stg_login; APP=$S/6.1B; CFG=$S/config.json; DEPS=$S/recovery_deps; STATE=$S/recovery_v192; PKG=/tmp/recov192/adapter
PM2APP=login-v2-api-staging; B=$STATE/build
INTEGRATION_SHA=15408aef47dc47fb0bb6d200e722b2c0611736c7b781153ac509eaa3d0dc33a3   # staging integration.ts as inspected 2026-11-22
mkdir -p "$STATE"; chmod 700 "$STATE"
(cd "$PKG" && sha256sum -c --quiet sha.txt) || { echo "adapter files differ from the reviewed copy - stopping"; exit 1; }
need() { [ "${CONFIRM:-}" = "$1" ] || { echo "set CONFIRM=$1"; exit 1; }; }
health() {
  sleep 3
  echo "   pm2: $(pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(p=>p.name===process.argv[1]);console.log(p?p.pm2_env.status+" restarts="+p.pm2_env.restart_time:"missing")})' "$PM2APP")"
  echo "   GET /api/v1/auth/ready -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8195/api/v1/auth/ready)"
  echo "   GET /api/v1/auth/password-recovery/invitation/context -> $(curl -s -w ' %{http_code}' 'http://127.0.0.1:8195/api/v1/auth/password-recovery/invitation/context?ref=x')"
  pm2 logs "$PM2APP" --lines 15 --nostream --raw 2>/dev/null | grep -E 'listening|recovery|fatal|startup failed' | tail -4 | sed 's/^/   log: /' || true
}
cfg_set() {   # cfg_set KEY=VALUE ... (api.*), backup first, 0600, atomic
  cp -p "$CFG" "$STATE/config.json.bak-$(date -u +%Y%m%dT%H%M%SZ)"
  CFGF="$CFG" node -e 'const fs=require("fs"),f=process.env.CFGF,c=JSON.parse(fs.readFileSync(f,"utf8"));
    for(const kv of process.argv.slice(1)){const i=kv.indexOf("=");c.api[kv.slice(0,i)]=kv.slice(i+1);}
    fs.writeFileSync(f+".tmp",JSON.stringify(c,null,2)+"\n",{mode:0o600});fs.renameSync(f+".tmp",f);' "$@"
}
flags() { node -e 'const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).api;console.log("enabled="+(a.RECOVERY_ENABLED??"-")+" workers="+(a.RECOVERY_WORKERS_ENABLED??"-")+" delivery="+(a.RECOVERY_DELIVERY_MODE??"-")+" master_key="+(a.RECOVERY_MASTER_KEY?"set":"-")+" m365="+(a.M365_CLIENT_SECRET?"set":"-")+" sender="+(a.M365_SENDER??"-"))' "$CFG"; }

case "${1:-}" in
status)
  echo "config: $(flags)"
  echo "deps: $(node -e 'try{console.log(require(process.argv[1]+"/node_modules/@simplewebauthn/server/package.json").version)}catch{console.log("not installed")}' "$DEPS")"
  echo "live adapter: $([ -d "$APP/dist/express/recovery" ] && echo installed || echo not installed)   last backup: $(cat "$STATE/last_backup" 2>/dev/null || echo none)"
  echo "live integration.ts sha: $(sha256sum "$APP/src/express/integration.ts" | cut -c1-16) (original ${INTEGRATION_SHA:0:16})"
  health ;;

deps)
  mkdir -p "$DEPS"; cd "$DEPS"; [ -f package.json ] || echo '{"name":"recovery-deps","private":true}' > package.json
  npm install --no-audit --no-fund --ignore-scripts --save-exact @simplewebauthn/server@13.1.1 2>&1 | tail -1
  node -e 'const s=require(process.argv[1]+"/node_modules/@simplewebauthn/server");console.log("ok @simplewebauthn/server loads: "+typeof s.verifyAuthenticationResponse)' "$DEPS" ;;

config)
  need CONFIG-STG-RECOVERY
  node -e 'const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).api;if(a.RECOVERY_MASTER_KEY){console.log("already configured: "+Object.keys(a).filter(k=>/^(RECOVERY|M365)_/.test(k)).join(","));process.exit(3)}' "$CFG" || exit 0
  # Secrets never pass through argv or the shell: node reads the Domain 10 .env and generates the master key itself.
  cp -p "$CFG" "$STATE/config.json.bak-$(date -u +%Y%m%dT%H%M%SZ)"
  CFGF="$CFG" STATE="$STATE" DEPS="$DEPS" node -e '
    const fs=require("fs"),crypto=require("crypto"),f=process.env.CFGF,c=JSON.parse(fs.readFileSync(f,"utf8")),e={};
    for(const l of fs.readFileSync("/srv/arb-system/api/.env","utf8").split(/\r?\n/)){const m=l.match(/^\s*(M365_[A-Z_]+)\s*=\s*(.*)$/);if(m)e[m[1]]=m[2].replace(/^["\x27]|["\x27]$/g,"");}
    for(const k of ["M365_TENANT_ID","M365_CLIENT_ID","M365_CLIENT_SECRET","M365_ALLOWED_SENDER"])if(!e[k]){console.log("missing "+k+" in the Domain 10 .env");process.exit(1);}
    Object.assign(c.api,{RECOVERY_ENABLED:"false",RECOVERY_WORKERS_ENABLED:"false",RECOVERY_MASTER_KEY:crypto.randomBytes(32).toString("hex"),
      RECOVERY_LINK_BASE:"https://warehouse-app.tcdsolutionsgroup.com/auth/recovery/new-password",RECOVERY_DELIVERY_MODE:"capture",
      RECOVERY_CAPTURE_FILE:process.env.STATE+"/capture.jsonl",RECOVERY_DEPS_DIR:process.env.DEPS,RECOVERY_TICK_MS:"3000",
      M365_TENANT_ID:e.M365_TENANT_ID,M365_CLIENT_ID:e.M365_CLIENT_ID,M365_CLIENT_SECRET:e.M365_CLIENT_SECRET,M365_SENDER:e.M365_ALLOWED_SENDER});
    fs.writeFileSync(f+".tmp",JSON.stringify(c,null,2)+"\n",{mode:0o600});fs.renameSync(f+".tmp",f);'
  echo "config: $(flags)" ;;

build)
  [ "$(sha256sum "$APP/src/express/integration.ts" | cut -d' ' -f1)" = "$INTEGRATION_SHA" ] || { echo "live integration.ts is not the inspected one (already patched?) - stopping"; exit 1; }
  rm -rf "$B"; mkdir -p "$B"; cp -a "$APP/src" "$APP/tsconfig.json" "$APP/package.json" "$B/"; ln -s "$APP/node_modules" "$B/node_modules"
  cp -a "$PKG/src/express/recovery" "$B/src/express/"
  (cd "$B" && patch -s -p1 < "$PKG/integration.patch") && echo "ok integration.ts patched"
  (cd "$B" && node node_modules/typescript/bin/tsc -p tsconfig.json) && echo "ok compiled with the server's tsc ($(node -e 'console.log(require(process.argv[1]+"/node_modules/typescript/package.json").version)' "$APP"))"
  echo "== compiled files that differ from the live dist (expect: express/integration.js + new express/recovery/*)"
  (cd "$B/dist" && find . -name '*.js' | sort | while read -r f; do if [ ! -f "$APP/dist/$f" ]; then echo "   new     $f"; elif ! cmp -s "$f" "$APP/dist/$f"; then echo "   changed $f"; fi; done)
  echo "== integration.js live vs new"; diff "$APP/dist/express/integration.js" "$B/dist/express/integration.js" | head -20 || true
  echo "BUILD DONE (nothing live changed)" ;;

deploy)
  need DEPLOY-STG-RECOVERY
  [ -f "$B/dist/express/recovery/recoveryInstall.js" ] || { echo "run build first"; exit 1; }
  [ -d "$DEPS/node_modules/@simplewebauthn/server" ] || { echo "run deps first"; exit 1; }
  BK="$STATE/backup-$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$BK"
  cp -p "$APP/src/express/integration.ts" "$APP/dist/express/integration.js" "$BK/"; echo "$BK" > "$STATE/last_backup"
  cp -a "$B/src/express/recovery" "$APP/src/express/"; cp -p "$B/src/express/integration.ts" "$APP/src/express/integration.ts"
  mkdir -p "$APP/dist/express/recovery"; cp -a "$B/dist/express/recovery/." "$APP/dist/express/recovery/"; cp -p "$B/dist/express/integration.js" "$APP/dist/express/integration.js"
  echo "backup: $BK"; pm2 restart "$PM2APP" >/dev/null; health; echo "DEPLOYED (recovery flags: $(flags))" ;;

enable)
  need ENABLE-STG-RECOVERY; cfg_set RECOVERY_ENABLED=true RECOVERY_WORKERS_ENABLED=true
  pm2 restart "$PM2APP" >/dev/null; health; echo "config: $(flags)" ;;

mode)
  need MODE-STG-RECOVERY; case "${2:-}" in capture|graph) ;; *) echo "mode capture|graph"; exit 1;; esac
  cfg_set "RECOVERY_DELIVERY_MODE=$2"; pm2 restart "$PM2APP" >/dev/null; health; echo "config: $(flags)" ;;

e2e)
  cd /srv/arb-system/api
  eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
  export PGHOST=db.kqcdqtazcqaawdkmcfed.supabase.co PGPORT=5432 PGDATABASE=postgres PGUSER=postgres
  LOGINV2_CONFIG="$CFG" LOGINV2_6_1B="$APP" RECOVERY_STATE="$STATE" TO="${TO:-}" node "$PKG/harness/stg_recovery_e2e.cjs" ;;

disable)
  need DISABLE-STG-RECOVERY; cfg_set RECOVERY_ENABLED=false RECOVERY_WORKERS_ENABLED=false
  pm2 restart "$PM2APP" >/dev/null; health; echo "config: $(flags)" ;;

rollback)
  need ROLLBACK-STG-RECOVERY; BK=$(cat "$STATE/last_backup" 2>/dev/null || true); [ -n "$BK" ] && [ -d "$BK" ] || { echo "no backup recorded"; exit 1; }
  cfg_set RECOVERY_ENABLED=false RECOVERY_WORKERS_ENABLED=false
  cp -p "$BK/integration.ts" "$APP/src/express/integration.ts"; cp -p "$BK/integration.js" "$APP/dist/express/integration.js"
  rm -rf "$APP/src/express/recovery" "$APP/dist/express/recovery"
  pm2 restart "$PM2APP" >/dev/null; health
  echo "ROLLED BACK to $BK (integration.ts sha $(sha256sum "$APP/src/express/integration.ts" | cut -c1-16))" ;;
*) sed -n '2,14p' "$0"; exit 2 ;;
esac
