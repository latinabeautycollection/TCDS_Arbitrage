#!/usr/bin/env bash
# STAGING ONLY. mTLS route EOC (acquisition 23.239.12.166) -> Warehouse IAM bridge (127.0.0.1:8196), no root needed.
#   ca-init     private CA + server cert (DNS:iam-bridge-stg.tcds.internal, IP:139.177.200.80) in ~/stg_login/mtls
#   sign <csr>  check Codex's CSR (signature, EC P-256, exact CN), issue a 90-day clientAuth cert with OUR identity
#               extensions (CN + SAN URI), allowlist its fingerprint; prints the two PUBLIC files to send back
#   start       run eocMtlsProxy.cjs under PM2 as eoc-mtls-proxy-staging on 0.0.0.0:9443 (+ pm2 save)
#   stop        stop + delete the PM2 process (+ pm2 save)
#   selftest    throwaway client certs from this server: no cert, foreign CA, wrong CN, not allowlisted, valid,
#               path outside the bridge, bad bridge signature, and the public-IP source (not allowlisted)
#   revoke <fp> remove a fingerprint from the allowlist (takes effect on the next request)
#   status      process, listener, CA/server/client certificate expiry, allowlist
# Needs /tmp/recov15/mtls/eocMtlsProxy.cjs. Usage: bash /tmp/recov15/mtls/stg_mtls.sh <cmd>
set -euo pipefail
D=/tmp/recov15/mtls
S=$HOME/stg_login
M=$S/mtls
APP=eoc-mtls-proxy-staging
HOSTNAME_=iam-bridge-stg.tcds.internal
PUBLIC_IP=139.177.200.80
ACQ_IP=23.239.12.166
PORT=9443
CN=tcds-eoc-acquisition-staging
URI=urn:tcds:workload:eoc:staging:acquisition
umask 077
clean_pm2() { env -i HOME="$HOME" PATH="$PATH" USER="$USER" LANG=C.UTF-8 "$@"; }
fp() { openssl x509 -in "$1" -noout -fingerprint -sha256 | sed 's/^.*=//' | tr 'a-f' 'A-F'; }
serial() { echo "0x$(openssl rand -hex 16)"; }
issue_client() {  # <csr> <out.crt> <cn (already checked in the CSR)> <ca.crt> <ca.key> [days]
  printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth\nsubjectAltName=URI:%s\n' "$URI" > "$2.ext"
  openssl x509 -req -in "$1" -CA "$4" -CAkey "$5" -set_serial "$(serial)" -days "${6:-90}" -sha256 \
    -extfile "$2.ext" -out "$2" 2>/dev/null
  rm -f "$2.ext"
}

case "${1:-}" in
ca-init)
  [ -e "$M/ca.key" ] && { echo "$M/ca.key exists - CA already initialised"; exit 1; }
  mkdir -p "$M/issued"; chmod 700 "$M"
  openssl ecparam -name prime256v1 -genkey -noout -out "$M/ca.key"
  openssl req -x509 -new -key "$M/ca.key" -sha256 -days 730 -subj "/CN=TCDS EOC IAM Bridge Staging CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" -addext "keyUsage=critical,keyCertSign,cRLSign" -out "$M/ca.crt"
  openssl ecparam -name prime256v1 -genkey -noout -out "$M/server.key"
  openssl req -new -key "$M/server.key" -subj "/CN=$HOSTNAME_" -out "$M/server.csr"
  printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:%s,IP:%s\n' \
    "$HOSTNAME_" "$PUBLIC_IP" > "$M/server.ext"
  openssl x509 -req -in "$M/server.csr" -CA "$M/ca.crt" -CAkey "$M/ca.key" -set_serial "$(serial)" -days 365 -sha256 \
    -extfile "$M/server.ext" -out "$M/server.crt" 2>/dev/null
  rm -f "$M/server.csr" "$M/server.ext"
  : > "$M/allowed_clients.txt"
  cat > "$M/config.json" <<JSON
{"listenHost":"0.0.0.0","port":$PORT,"upstreamPort":8196,
 "serverKey":"$M/server.key","serverCert":"$M/server.crt","caCert":"$M/ca.crt","allowedClients":"$M/allowed_clients.txt",
 "allowIps":["$ACQ_IP","127.0.0.1"],"identity":{"cn":"$CN","uri":"$URI"}}
JSON
  chmod 600 "$M"/*.key "$M/config.json"; chmod 644 "$M/ca.crt" "$M/server.crt"
  openssl verify -CAfile "$M/ca.crt" "$M/server.crt"
  openssl x509 -in "$M/server.crt" -noout -subject -ext subjectAltName,extendedKeyUsage -enddate
  echo "CA fingerprint: $(fp "$M/ca.crt")"
  echo "CA INITIALISED in $M (keys never leave this server)"
  ;;
sign)
  CSR=${2:-}; [ -f "$CSR" ] || { echo "usage: $0 sign <file.csr>"; exit 1; }
  [ -f "$M/ca.key" ] || { echo "run ca-init first"; exit 1; }
  openssl req -in "$CSR" -noout -verify 2>&1 | grep -q 'verify OK' || { echo "CSR self-signature does not verify - stopping"; exit 1; }
  subj=$(openssl req -in "$CSR" -noout -subject -nameopt RFC2253 | sed 's/^subject=//')
  [ "$subj" = "CN=$CN" ] || { echo "CSR subject is '$subj', expected 'CN=$CN' - stopping"; exit 1; }
  openssl req -in "$CSR" -noout -text | grep -q 'ASN1 OID: prime256v1' || { echo "CSR key is not EC P-256 - stopping"; exit 1; }
  openssl req -in "$CSR" -noout -text | grep -q "URI:$URI" && echo "CSR requests SAN URI:$URI (ok)" \
    || echo "note: CSR has no SAN URI request - the certificate gets URI:$URI anyway (we set extensions, not the CSR)"
  OUT="$M/issued/eoc-acquisition-$(date -u +%Y%m%dT%H%M%SZ).crt"
  issue_client "$CSR" "$OUT" "$CN" "$M/ca.crt" "$M/ca.key" 90
  openssl verify -CAfile "$M/ca.crt" -purpose sslclient "$OUT"
  F=$(fp "$OUT"); echo "$F" >> "$M/allowed_clients.txt"; chmod 644 "$OUT"
  openssl x509 -in "$OUT" -noout -subject -ext subjectAltName,extendedKeyUsage -enddate
  echo "client fingerprint (allowlisted): $F"
  echo "SEND TO CODEX (public, not secret): $OUT  and  $M/ca.crt"
  ;;
start)
  [ -f "$M/config.json" ] || { echo "run ca-init first"; exit 1; }
  [ -f "$D/eocMtlsProxy.cjs" ] || { echo "missing $D/eocMtlsProxy.cjs"; exit 1; }
  ss -ltn | grep -q ":$PORT " && { echo "port $PORT already in use - stopping"; exit 1; }
  install -m 600 "$D/eocMtlsProxy.cjs" "$M/eocMtlsProxy.cjs"
  clean_pm2 EOC_MTLS_CONFIG="$M/config.json" pm2 start "$M/eocMtlsProxy.cjs" --name "$APP" --time >/dev/null
  for i in $(seq 1 10); do ss -ltn | grep -q "0.0.0.0:$PORT " && break; sleep 1; done
  ss -ltn | grep -q "0.0.0.0:$PORT " || { echo "!! not listening"; pm2 logs "$APP" --nostream --lines 20; exit 1; }
  clean_pm2 pm2 save >/dev/null
  echo "$APP listening on 0.0.0.0:$PORT (pm2 saved)"
  ;;
stop)
  clean_pm2 pm2 delete "$APP" >/dev/null || true; clean_pm2 pm2 save >/dev/null; echo "$APP stopped"
  ;;
revoke)
  F=$(echo "${2:-}" | tr 'a-f' 'A-F'); [ -n "$F" ] || { echo "usage: $0 revoke <fingerprint>"; exit 1; }
  grep -qxF "$F" "$M/allowed_clients.txt" || { echo "not in the allowlist"; exit 1; }
  grep -vxF "$F" "$M/allowed_clients.txt" > "$M/allowed.tmp" || true; mv "$M/allowed.tmp" "$M/allowed_clients.txt"
  echo "REVOKED $F (effective on the next request)"
  ;;
status)
  pm2 describe "$APP" 2>/dev/null | grep -E 'status|restarts|uptime' | head -3 || echo "$APP not running"
  ss -ltn | grep ":$PORT " || echo "nothing listening on $PORT"
  for c in "$M/ca.crt" "$M/server.crt" "$M"/issued/*.crt; do [ -f "$c" ] && echo "$(basename $c): $(openssl x509 -in $c -noout -enddate) $(fp $c | cut -c1-23)…"; done
  echo "allowlisted: $(grep -c . "$M/allowed_clients.txt" || true)"
  ;;
selftest)
  ss -ltn | grep -q "0.0.0.0:$PORT " || { echo "proxy not listening (run start)"; exit 1; }
  T=$(mktemp -d "$S/mtls_selftest.XXXX")
  cleanup() { [ -n "${TFP:-}" ] && { grep -vxF "$TFP" "$M/allowed_clients.txt" > "$M/allowed.tmp" || true; mv "$M/allowed.tmp" "$M/allowed_clients.txt"; }; rm -rf "$T"; }
  trap cleanup EXIT
  mk() {  # <name> <cn> <ca.crt> <ca.key>
    openssl ecparam -name prime256v1 -genkey -noout -out "$T/$1.key"
    openssl req -new -key "$T/$1.key" -subj "/CN=$2" -out "$T/$1.csr"
    issue_client "$T/$1.csr" "$T/$1.crt" "$2" "$3" "$4" 1
  }
  openssl ecparam -name prime256v1 -genkey -noout -out "$T/foreign_ca.key"
  openssl req -x509 -new -key "$T/foreign_ca.key" -days 1 -subj "/CN=Foreign CA" -addext "basicConstraints=critical,CA:TRUE" -out "$T/foreign_ca.crt"
  mk foreign "$CN" "$T/foreign_ca.crt" "$T/foreign_ca.key"
  mk wrongcn "tcds-eoc-selftest-wrong" "$M/ca.crt" "$M/ca.key"
  mk unlisted "$CN" "$M/ca.crt" "$M/ca.key"
  mk valid "$CN" "$M/ca.crt" "$M/ca.key"
  TFP=$(fp "$T/valid.crt"); echo "$TFP" >> "$M/allowed_clients.txt"
  cat > "$T/client.cjs" <<'NODE'
// Signs like Anthony's authorityClient.mjs; connects over mTLS and verifies the server name against our CA.
const https=require("https"),fs=require("fs"),crypto=require("crypto");
const [host,name,path,mode]=process.argv.slice(2),T=process.env.T,M=process.env.M;
const key=JSON.parse(fs.readFileSync(process.env.CFG,"utf8")).api.EOC_IAM_SERVICE_TOKEN;
const ts=String(Math.floor(Date.now()/1000)),nonce=crypto.randomUUID(),sha=s=>crypto.createHash("sha256").update(s).digest("hex");
const sig=crypto.createHmac("sha256",mode==="badsig"?"x".repeat(48):key).update(["GET",path,ts,nonce,sha("")].join("\n")).digest("hex");
const o={host,port:9443,path,method:"GET",servername:"iam-bridge-stg.tcds.internal",ca:fs.readFileSync(M+"/ca.crt"),
 headers:{"x-eoc-workload-timestamp":ts,"x-eoc-workload-nonce":nonce,"x-eoc-workload-signature":sig,accept:"application/json"}};
if(name!=="none"){o.cert=fs.readFileSync(`${T}/${name}.crt`);o.key=fs.readFileSync(`${T}/${name}.key`);}
const r=https.request(o,res=>{let d="";res.on("data",c=>d+=c);res.on("end",()=>console.log(res.statusCode+" "+d.slice(0,100)))});
r.setTimeout(8000,()=>r.destroy(new Error("TIMEOUT")));
r.on("error",e=>console.log("REFUSED "+(e.code||e.message)));r.end();
NODE
  cli() { T="$T" M="$M" CFG="$S/config.json" node "$T/client.cjs" "$@"; }
  ck() { printf '%-6s%-70s%s\n' "$( [[ "$2" =~ $3 ]] && echo PASS || echo FAIL)" "$1" "$2"; }
  R=/internal/v1/iam/eoc/ready
  {
  echo "===== M. mTLS proxy (from this server; throwaway certificates, removed afterwards)"
  ck "M1 no client certificate (expect REFUSED)" "$(cli 127.0.0.1 none $R)" "^REFUSED"
  ck "M2 certificate from a foreign CA, right identity (expect REFUSED)" "$(cli 127.0.0.1 foreign $R)" "^REFUSED"
  ck "M3 our CA, wrong CN (expect 403 CLIENT_NOT_AUTHORIZED)" "$(cli 127.0.0.1 wrongcn $R)" "^403 .*CLIENT_NOT_AUTHORIZED"
  ck "M4 right identity, not allowlisted (expect 403)" "$(cli 127.0.0.1 unlisted $R)" "^403 .*CLIENT_NOT_AUTHORIZED"
  ck "M5 allowlisted, signed ready (expect 200 ready)" "$(cli 127.0.0.1 valid $R)" '^200 .*"ready":true'
  ck "M6 allowlisted, path outside the bridge (expect 404)" "$(cli 127.0.0.1 valid /internal/v1/iam/session-status)" "^404 .*NOT_FOUND"
  ck "M7 allowlisted, bad bridge signature (expect 401 UNAUTHORIZED)" "$(cli 127.0.0.1 valid $R badsig)" "^401 .*UNAUTHORIZED"
  ck "M8 source = public IP $PUBLIC_IP, not allowlisted (expect REFUSED)" "$(cli $PUBLIC_IP valid $R)" "^REFUSED"
  sed -i "/^$TFP\$/d" "$M/allowed_clients.txt"; TFP=
  ck "M9 same certificate after revoke (expect 403)" "$(cli 127.0.0.1 valid $R)" "^403 .*CLIENT_NOT_AUTHORIZED"
  } | tee /dev/stderr | awk '/^PASS /{p++} /^FAIL /{f++} END{printf "== %d PASS, %d FAIL\n", p, f}' 1>&2
  echo "SELFTEST DONE (test certificates deleted, allowlist restored)"
  ;;
*) echo "usage: $0 ca-init|sign <csr>|start|stop|selftest|revoke <fp>|status"; exit 2;;
esac
