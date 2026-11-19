#!/usr/bin/env bash
# STAGING ONLY. login-stg nginx vhost: one Referrer-Policy header, "same-origin".
# Why: the vhost added "Referrer-Policy: no-referrer" to every response ON TOP of the app's own header. With two headers
# the browser uses the last one (no-referrer), and under no-referrer it sends "Origin: null" on the issuer's same-origin
# passkey form POST, so the issuer refused every browser sign-in (ORIGIN_DENIED). same-origin still sends nothing to
# any other site (EOC included). The upstream's own Referrer-Policy is hidden so exactly one header reaches the browser.
#   check   read only: current vhost lines, the live headers on the sign-in path, which issuer bundle is live
#   apply   CONFIRM=REFERRER-SAME-ORIGIN (sudo): backup, edit, nginx -t gate (restores on failure), reload, check
#   revert  CONFIRM=REFERRER-REVERT (sudo): restore the latest backup, nginx -t, reload
set -euo pipefail
RP=login-stg.tcdsolutionsgroup.com
VHOST=/etc/nginx/sites-available/$RP
live() {
  echo "vhost:  $(sudo grep -nE 'Referrer-Policy' "$VHOST" | tr '\n' ' ')"
  echo "issuer bundle live: $(readlink -f /srv/arb-system/oidc_issuer/current | xargs basename)"
  echo "browser receives on /interaction/... (count, values):"
  curl -s -o /dev/null -D - "https://$RP/interaction/checkreferrer00" | grep -i '^referrer-policy' | sed 's/^/   /' || echo "   (none)"
  echo "browser receives on /enroll/:"
  curl -s -o /dev/null -D - "https://$RP/enroll/" | grep -i '^referrer-policy' | sed 's/^/   /' || echo "   (none)"
}
case "${1:-}" in
check) live ;;
apply)
  [ "${CONFIRM:-}" = "REFERRER-SAME-ORIGIN" ] || { echo "set CONFIRM=REFERRER-SAME-ORIGIN"; exit 1; }
  sudo grep -q 'add_header Referrer-Policy no-referrer always;' "$VHOST" || { echo "expected 'add_header Referrer-Policy no-referrer always;' not found - stopping"; live; exit 1; }
  B="$VHOST.bak-referrer-$(date -u +%Y%m%dT%H%M%SZ)"; sudo cp -p "$VHOST" "$B"
  sudo sed -i 's/^\([[:space:]]*\)add_header Referrer-Policy no-referrer always;/\1add_header Referrer-Policy same-origin always;\n\1proxy_hide_header Referrer-Policy;/' "$VHOST"
  # a location with its own proxy_hide_header does NOT inherit the server-level ones (nginx): add it where one exists
  sudo sed -i 's/^\([[:space:]]*\)proxy_hide_header Server;$/\1proxy_hide_header Server;\n\1proxy_hide_header Referrer-Policy;/' "$VHOST"
  if ! sudo nginx -t 2>&1 | tail -1 | grep -q successful; then echo "nginx -t FAILED - restoring"; sudo cp -p "$B" "$VHOST"; exit 1; fi
  sudo systemctl reload nginx; sleep 2; live
  n=$(curl -s -o /dev/null -D - "https://$RP/interaction/checkreferrer00" | grep -ci '^referrer-policy' || true)
  v=$(curl -s -o /dev/null -D - "https://$RP/interaction/checkreferrer00" | grep -i '^referrer-policy' | tr -d '\r' | awk '{print $2}')
  [ "$n" = 1 ] && [ "$v" = same-origin ] && echo "REFERRER POLICY FIXED (one header, same-origin; backup $B)" || echo "!! expected exactly one 'same-origin' header - check above; revert with CONFIRM=REFERRER-REVERT $0 revert" ;;
revert)
  [ "${CONFIRM:-}" = "REFERRER-REVERT" ] || { echo "set CONFIRM=REFERRER-REVERT"; exit 1; }
  B=$(ls -t "$VHOST".bak-referrer-* | head -1); sudo cp -p "$B" "$VHOST"
  sudo nginx -t 2>&1 | tail -1 | grep -q successful && sudo systemctl reload nginx && echo "reverted from $B"; live ;;
*) sed -n '2,10p' "$0"; exit 2 ;;
esac
