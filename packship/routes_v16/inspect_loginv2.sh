#!/usr/bin/env bash
# READ ONLY. Inspects the production Login V2 API host (PM2 login-v2-api, 127.0.0.1:8095), which owns the PWA session
# cookie, CSRF and device checks, to decide how Pack/Ship routes mount on that middleware. Changes nothing.
# Prints env key NAMES only, never values; skips any file that looks like a secret.
# Usage: bash /tmp/domain6_scanner/packship_routes_v16/inspect_loginv2.sh 2>&1 | tee ~/inspect_loginv2.txt
set -uo pipefail
R=/srv/arb-system/loginv2_runtime
h(){ echo; echo "################ $*"; }
[ -d "$R" ] || { echo "no $R"; exit 1; }

h "1. layout (2 levels, no secrets dir contents)"
find "$R" -maxdepth 2 -not -path '*/node_modules*' -not -path '*/.git*' \( -type d -printf 'd %p\n' -o -type f -printf 'f %p %s\n' \) 2>/dev/null \
  | grep -viE 'secret|\.pem|\.key|\.env$|password|token' | sort | head -80
for d in "$R"/*/; do [ -f "$d/package.json" ] && echo "package: $d -> $(node -e 'const p=require(process.argv[1]);console.log(p.name+"@"+(p.version||"-")+" type="+(p.type||"commonjs")+" express="+((p.dependencies||{}).express||"-")+" pg="+((p.dependencies||{}).pg||"-"))' "$d/package.json")"; done
[ -f "$R/package.json" ] && node -e 'const p=require(process.argv[1]);console.log("root package: "+p.name+" express="+((p.dependencies||{}).express||"-")+" pg="+((p.dependencies||{}).pg||"-"))' "$R/package.json"

h "2. API host entry: runtime/identity-api-host.cjs"
F=$R/runtime/identity-api-host.cjs
echo "$(wc -l < "$F") lines, sha256 $(sha256sum "$F" | cut -c1-16)"
grep -nE "require\(|import\(|app\.use\(|\.listen\(|new Pool|createPool|mount|Router\(|process\.env\.[A-Z_]+" "$F" | sed -E 's/(process\.env\.[A-Z_]+)[^,;)]*/\1/g' | head -80

h "3. how the 6.1B adapter is built: mount function and its options"
SRC=$(grep -oE "require\(['\"][^'\"]+['\"]\)" "$F" | grep -oE "['\"][^'\"]+['\"]" | tr -d "'\"" | grep -E '^\.|^/' | head -10)
echo "relative requires from host: $SRC"
for s in $SRC; do
  for c in "$R/runtime/$s" "$R/runtime/$s.js" "$R/runtime/$s.cjs" "$R/runtime/$s/index.js" "$R/$s" "$R/$s.js"; do
    [ -f "$c" ] && { echo "## $c ($(wc -l < "$c") lines)"; grep -nE "^(export |exports\.|module\.exports)|function (mount|create|build)[A-Za-z]*|app\.use\(|router\.(get|post|use)\(" "$c" | head -40; break; }
  done
done

h "4. the 6.1B express layer: middleware names (session / csrf / device / permission)"
D=$(find "$R" -type d -path '*dist/express' -not -path '*/node_modules/*' 2>/dev/null | head -3)
echo "dist/express dirs: ${D:-none}"
for d in $D; do
  ls "$d" | tr '\n' ' '; echo
  grep -nE "^(exports\.[A-Za-z]+ *=|function [A-Za-z]+)" "$d"/*.js 2>/dev/null | grep -iE "session|csrf|device|permission|principal|require|attach|mount|create|origin|rate" | sed "s|$d/||" | head -60
done

h "5. what the session middleware puts on the request (res.locals / req.*)"
for d in $D; do grep -rnoE "res\.locals\.[A-Za-z]+ *=|req\.[a-zA-Z]+(Session|Identity|Principal|Context)[A-Za-z]* *=" "$d" 2>/dev/null | awk -F: '{print $NF}' | sort | uniq -c | sort -rn | head -30; done

h "6. routes the host serves today"
for d in $D; do grep -rnoE "\.(get|post|put|patch|delete)\(['\"\`]/[^'\"\`]+" "$d" 2>/dev/null | awk -F: '{print $NF}' | sort -u | head -60; done

h "7. cookie, CSRF header and origin settings (names only)"
for d in $D; do grep -rnoE "__Host-[A-Za-z0-9_-]+|['\"]x-(csrf|xsrf|tcds)[a-z0-9-]*['\"]|sameSite: *['\"][A-Za-z]+['\"]|ALLOWED_ORIGINS?|PUBLIC_ORIGIN" "$d" 2>/dev/null | awk -F: '{print $NF}' | sort | uniq -c | head -30; done

h "8. env key names the host is started with (PM2 config + env files, names only)"
for f in "$R"/*.config.cjs "$R"/ecosystem*.cjs "$R"/runtime/*.config.cjs; do [ -f "$f" ] && { echo "## $f"; grep -oE "[A-Z][A-Z0-9_]{3,}" "$f" | sort -u | tr '\n' ' '; echo; }; done
pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const p of JSON.parse(s)){if(!/^login-v2-api$/.test(p.name))continue;const e=p.pm2_env||{};console.log("pm2 "+p.name+": restarts="+e.restart_time+" uptime_since="+new Date(e.pm_uptime).toISOString()+" node="+e.node_version);console.log("env keys: "+Object.keys(e.env||{}).filter(k=>/^[A-Z][A-Z0-9_]+$/.test(k)&&!/^(PATH|HOME|PWD|SHELL|USER|LANG|TERM|LOGNAME|SHLVL|OLDPWD|XDG_|SSH_|MAIL|MOTD)/.test(k)).sort().join(" "))}})'
ls -la "$R" | awk '{print $1, $3, $NF}' | grep -E '\.env|secrets|config' || true

h "9. deployed version evidence"
for f in "$R"/SHA256SUMS* "$R"/*/SHA256SUMS* "$R"/DEPLOY* "$R"/*.json; do [ -f "$f" ] && echo "$f $(sha256sum "$f" | cut -c1-16)"; done 2>/dev/null | grep -viE 'secret|lock' | head -15
for d in $D; do echo "dist/express newest file: $(ls -t "$d" | head -1) $(stat -c %y "$d/$(ls -t "$d" | head -1)" | cut -c1-19)"; done

h "10. health from localhost (no credentials)"
for p in /api/v1/auth/session /api/v1/auth/health /health /internal/health/ready; do
  echo "  $(curl -s -o /dev/null -m 5 -w '%{http_code} %{content_type}' "http://127.0.0.1:8095$p") $p"
done
echo; echo "inspection finished (read only)"
