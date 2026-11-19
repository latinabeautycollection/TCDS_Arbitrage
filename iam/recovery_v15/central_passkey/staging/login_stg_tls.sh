#!/usr/bin/env bash
# STAGING. Public HTTPS for https://login-stg.tcdsolutionsgroup.com on the Warehouse server (DNS A -> 139.177.200.80).
# Based on the dev team's nginx-login-staging.conf.example, plus /enroll/ -> the enrollment listener (8198).
#   check     read only: DNS points here, certbot + nginx present, nginx -t, issuer (8401) and enrollment (8198) listening
#   cert      CONFIRM=ISSUE-LOGIN-STG-CERT: Let's Encrypt certificate (certbot certonly --nginx; existing certbot account,
#             no config is edited by certbot) - sudo
#   site      CONFIRM=ENABLE-LOGIN-STG: write + enable the vhost, nginx -t gate, reload, public probes - sudo
#   rollback  CONFIRM=DISABLE-LOGIN-STG: disable the vhost and reload (certificate kept) - sudo
set -euo pipefail
H=login-stg.tcdsolutionsgroup.com; IP=139.177.200.80
AV=/etc/nginx/sites-available/$H; EN=/etc/nginx/sites-enabled/$H
probe() { local want=$1; shift; local got; got=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@" || true)
  [ "$got" = "$want" ] && echo "PASS $want ${*: -1}" || { echo "FAIL ${*: -1}: $got (want $want)"; FAILS=$((FAILS+1)); }; }
case "${1:-}" in
check)
  echo "DNS: $(getent ahostsv4 $H | awk 'NR==1{print $1}') (want $IP); public: $(dig +short A $H @1.1.1.1 2>/dev/null | head -1)"
  command -v certbot >/dev/null && echo "certbot: $(certbot --version 2>&1)" || echo "certbot: MISSING"
  sudo nginx -t 2>&1 | tail -1
  [ -e "$EN" ] && echo "vhost: enabled" || echo "vhost: not enabled yet"
  sudo test -d /etc/letsencrypt/live/$H && echo "certificate: present" || echo "certificate: not issued yet"
  for p in 8401 8198; do ss -ltn | grep -q "127.0.0.1:$p " && echo "port $p: listening" || echo "port $p: NOT listening"; done ;;
cert)
  [ "${CONFIRM:-}" = "ISSUE-LOGIN-STG-CERT" ] || { echo "set CONFIRM=ISSUE-LOGIN-STG-CERT"; exit 1; }
  [ "$(dig +short A $H @1.1.1.1 | head -1)" = "$IP" ] || { echo "public DNS for $H is not $IP - stopping"; exit 1; }
  sudo certbot certonly --nginx -d "$H" --non-interactive --keep-until-expiring
  sudo test -s /etc/letsencrypt/live/$H/fullchain.pem && echo "CERTIFICATE ISSUED: $(sudo openssl x509 -in /etc/letsencrypt/live/$H/fullchain.pem -noout -enddate)" ;;
site)
  [ "${CONFIRM:-}" = "ENABLE-LOGIN-STG" ] || { echo "set CONFIRM=ENABLE-LOGIN-STG"; exit 1; }
  sudo test -s /etc/letsencrypt/live/$H/fullchain.pem || { echo "run cert first"; exit 1; }
  [ -e "$AV" ] && sudo cp -p "$AV" "$AV.bak-$(date -u +%Y%m%dT%H%M%SZ)"
  sudo tee "$AV" >/dev/null <<NGINX
# login-stg: central OIDC issuer (127.0.0.1:8401) + central passkey enrollment page (127.0.0.1:8198). STAGING.
limit_req_zone \$binary_remote_addr zone=tcds_oidc_auth:10m rate=5r/s;
server {
 listen 80; listen [::]:80;
 server_name $H;
 location / { return 301 https://$H\$request_uri; }
}
server {
 listen 443 ssl http2; listen [::]:443 ssl http2;
 server_name $H;
 ssl_certificate /etc/letsencrypt/live/$H/fullchain.pem;
 ssl_certificate_key /etc/letsencrypt/live/$H/privkey.pem;
 ssl_protocols TLSv1.2 TLSv1.3;
 server_tokens off;
 add_header Strict-Transport-Security 'max-age=31536000' always;
 add_header X-Content-Type-Options nosniff always;
 add_header Referrer-Policy same-origin always;
 proxy_hide_header Referrer-Policy;
 client_max_body_size 16k;
 location /internal/ { return 404; }
 location ^~ /enroll/ {
   limit_req zone=tcds_oidc_auth burst=15 nodelay;
   client_max_body_size 64k;
   proxy_set_header Host \$host;
   proxy_set_header X-Forwarded-Proto https;
   proxy_set_header X-Real-IP \$remote_addr;
   proxy_set_header X-Forwarded-For \$remote_addr;
   proxy_pass http://127.0.0.1:8198;
   proxy_read_timeout 15s;
 }
 location / {
   limit_req zone=tcds_oidc_auth burst=15 nodelay;
   proxy_set_header Host \$host;
   proxy_set_header X-Forwarded-Proto https;
   proxy_set_header X-Forwarded-For \$remote_addr;
   proxy_pass http://127.0.0.1:8401;
   proxy_read_timeout 15s;
   proxy_hide_header Server;
   proxy_hide_header Referrer-Policy;
 }
}
NGINX
  sudo ln -sf "$AV" "$EN"
  if ! sudo nginx -t; then echo "nginx -t FAILED - disabling the new vhost"; sudo rm -f "$EN"; exit 1; fi
  sudo systemctl reload nginx; sleep 2; FAILS=0
  probe 301 "http://$H/"
  probe 200 "https://$H/.well-known/openid-configuration"
  probe 200 "https://$H/jwks"
  probe 503 -X POST "https://$H/token"
  probe 200 "https://$H/enroll/"
  probe 404 "https://$H/internal/v1/iam/oidc/passkey/begin"
  probe 200 "https://warehouse-app.tcdsolutionsgroup.com/"
  [ $FAILS = 0 ] && echo "LOGIN-STG ENABLED" || echo "$FAILS probe(s) failed - review (disable with CONFIRM=DISABLE-LOGIN-STG $0 rollback)" ;;
rollback)
  [ "${CONFIRM:-}" = "DISABLE-LOGIN-STG" ] || { echo "set CONFIRM=DISABLE-LOGIN-STG"; exit 1; }
  sudo rm -f "$EN"; sudo nginx -t && sudo systemctl reload nginx && echo "login-stg vhost disabled (certificate kept)" ;;
*) sed -n '2,10p' "$0"; exit 2 ;;
esac
