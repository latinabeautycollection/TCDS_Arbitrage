#!/usr/bin/env bash
# STAGING ONLY. The issuer's sign-in gate (r3/r4 OIDC_LOGIN_ENABLED, fail closed). Staging was started with it OFF;
# the EOC pilot needs it ON so https://login-stg.tcdsolutionsgroup.com/auth answers. Only that one line changes.
#   status    read only: the gate flag (true/false only), readiness, what /auth answers
#   enable    CONFIRM=ENABLE-ISSUER-LOGIN:  backup issuer.env, OIDC_LOGIN_ENABLED=true, restart, check
#   disable   CONFIRM=DISABLE-ISSUER-LOGIN: back to false (fail closed again), restart, check
set -euo pipefail
SEC=/etc/tcds-issuer; ENVF=$SEC/issuer.env; NAME=oidc-issuer-staging; BASE=/srv/arb-system/oidc_issuer
H="Host: login-stg.tcdsolutionsgroup.com"; P="X-Forwarded-Proto: https"; U=http://127.0.0.1:8401
CH=$(printf 'a%.0s' $(seq 43))
clean_pm2() { env -i HOME="$HOME" PATH="$PATH" USER="$USER" LANG=C.UTF-8 pm2 "$@"; }
flag() { grep -E '^OIDC_LOGIN_ENABLED=' "$ENVF" | sed -E 's/=(true|false).*/=\1/'; }
show() {
  echo "issuer.env: $(flag)"
  echo "readiness:  $(curl -s -m 8 -H "$H" $U/internal/health/ready | grep -oE '"(ready|iamBridge|loginEnabled)":(true|false)' | tr '\n' ' ')"
  # an unknown client: disabled -> 503 LOGIN_DISABLED; enabled -> the provider's own refusal (400 invalid_client)
  echo "/auth with an unknown client: $(curl -s -m 5 -o /dev/null -w '%{http_code}' -H "$H" -H "$P" "$U/auth?client_id=not-a-client&response_type=code&scope=openid&code_challenge_method=S256&code_challenge=$CH&max_age=0&prompt=login&acr_values=urn:tcds:acr:phishing-resistant:uv")"
  echo "discovery:  $(curl -s -m 5 -o /dev/null -w '%{http_code}' -H "$H" -H "$P" $U/.well-known/openid-configuration)"
  echo "log:        $(grep -h 'login gate' "$BASE/issuer.out.log" 2>/dev/null | tail -1)"
}
set_flag() {
  [ "$(grep -c '^OIDC_LOGIN_ENABLED=\(true\|false\)$' "$ENVF")" = 1 ] || { echo "issuer.env needs exactly one OIDC_LOGIN_ENABLED=true|false line - stopping"; exit 1; }
  cp -p "$ENVF" "$ENVF.login-backup-$(date -u +%Y%m%dT%H%M%SZ)"
  sed -i "s/^OIDC_LOGIN_ENABLED=\(true\|false\)$/OIDC_LOGIN_ENABLED=$1/" "$ENVF"
  clean_pm2 restart "$NAME" >/dev/null
  for i in $(seq 1 20); do ss -ltn | grep -q '127.0.0.1:8401 ' && break; sleep 1; done; sleep 2
}
case "${1:-}" in
status) show ;;
enable)
  [ "${CONFIRM:-}" = "ENABLE-ISSUER-LOGIN" ] || { echo "set CONFIRM=ENABLE-ISSUER-LOGIN"; exit 1; }
  set_flag true; show
  curl -s -m 8 -H "$H" $U/internal/health/ready | grep -q '"loginEnabled":true' && echo "ISSUER SIGN-IN ENABLED" || { echo "!! not enabled - check: pm2 logs $NAME --nostream --lines 20"; exit 1; } ;;
disable)
  [ "${CONFIRM:-}" = "DISABLE-ISSUER-LOGIN" ] || { echo "set CONFIRM=DISABLE-ISSUER-LOGIN"; exit 1; }
  set_flag false; show
  curl -s -m 8 -H "$H" $U/internal/health/ready | grep -q '"loginEnabled":false' && echo "ISSUER SIGN-IN DISABLED (fail closed)" ;;
*) sed -n '2,6p' "$0"; exit 2 ;;
esac
