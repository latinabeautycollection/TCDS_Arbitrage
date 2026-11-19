#!/usr/bin/env bash
# run.sh <issuer app dir>: throwaway secrets, IAM stub, the REAL issuer server.mjs on 127.0.0.1:18401, then flow.mjs.
set -uo pipefail
H=$(cd "$(dirname "$0")" && pwd); APP=$1
NM=${NM:-$H/node_modules}   # the issuer bundle's own node_modules (npm ci in the unpacked bundle)
[ -e "$APP/node_modules" ] || ln -s "$NM" "$APP/node_modules"
cd "$H"
[ -f secrets/env.json ] || node -e '
const c=require("crypto"),fs=require("fs");const {privateKey}=c.generateKeyPairSync("rsa",{modulusLength:3072});
fs.writeFileSync("secrets/jwks.json",JSON.stringify({keys:[{...privateKey.export({format:"jwk"}),kid:c.randomUUID(),use:"sig",alg:"RS256"}]}),{mode:0o600});
const r=()=>c.randomBytes(48).toString("base64url");
fs.writeFileSync("secrets/env.json",JSON.stringify({OIDC_CLIENT_ID:"tcds-eoc-stg-flowtest00000000",OIDC_CLIENT_SECRET:r(),
 OIDC_REDIRECT_URI:"https://eoc-stg.tcdsolutionsgroup.com/api/eoc/auth/callback",OIDC_COOKIE_KEYS:r()+","+r(),OIDC_PASSKEY_SIGNING_KEY:r(),
 IAM_WORKLOAD_KEY:r(),IAM_EOC_BRIDGE_KEY:r()}),{mode:0o600})'
chmod 600 secrets/jwks.json
docker exec oidcflowpg psql -U postgres -qc "TRUNCATE eoc_oidc.artifacts, eoc_oidc.passkey_interactions, eoc_oidc.issuer_security_events" >/dev/null
pkill -f "$H/iam_stub.mjs" 2>/dev/null; pkill -f 'issuer-flow-under-test' 2>/dev/null; sleep 0.5
node "$H/iam_stub.mjs" > stub.log 2>&1 &
ENVS=$(node -e 'const e=require("./secrets/env.json");for(const[k,v]of Object.entries(e))console.log(k+"="+v)')
( cd "$APP" && env -i PATH="$PATH" HOME="$HOME" $ENVS OIDC_ISSUER=https://login-stg.tcdsolutionsgroup.com/ OIDC_JWKS_FILE="$H/secrets/jwks.json" \
  OIDC_DATABASE_URL=postgres://postgres:flowtest@localhost:55640/postgres OIDC_DB_CA_FILE="$H/certs/ca.pem" \
  IAM_PASSKEY_API_URL=https://localhost:9555 IAM_CA_FILE="$H/certs/ca.pem" IAM_CLIENT_CERT="$H/certs/client.pem" IAM_CLIENT_KEY="$H/certs/client.key" \
  OIDC_RUNTIME_ENABLED=true OIDC_LOGIN_ENABLED=true OIDC_PORT=18401 node src/server.mjs issuer-flow-under-test > "$H/issuer.log" 2>&1 & )
for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:18401/internal/health/live -H 'Host: login-stg.tcdsolutionsgroup.com' && break; sleep 0.3; done
EOC_POLICY=${EOC_POLICY:?set EOC_POLICY to the EOC BFF server/policy.mjs} node "$H/${DRIVER:-flow.mjs}"; rc=$?
echo "--- issuer rejections:"; grep -h 'ISSUER_REQUEST_REJECTED' "$H/issuer.log" | sort | uniq -c
pkill -f 'issuer-flow-under-test'; pkill -f "$H/iam_stub.mjs"
exit $rc
