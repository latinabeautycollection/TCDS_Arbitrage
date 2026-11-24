#!/usr/bin/env bash
# PRODUCTION public HTTPS for https://login.tcdsolutionsgroup.com (DNS A -> 139.177.200.80, set by Anthony 2026-11-23).
# Same shape as login-stg, without the OIDC issuer: only /approve/ and /enroll/ (the central passkey pages on the login
# API's loopback listener 127.0.0.1:8098); / goes to the warehouse app; /internal/ and everything else 404.
#   check     read-only: DNS, certbot, nginx -t, vhost/certificate state, port 8098
#   cert      CONFIRM=ISSUE-LOGIN-CERT: Let's Encrypt certificate (certbot certonly --nginx, no config edited) - sudo
#   site      CONFIRM=ENABLE-LOGIN: write + enable the vhost, nginx -t gate (else nothing enabled), reload, probes - sudo
#   probe     read-only public probes (before the login API deploy /approve/ answers 502; after it, 200)
#   rollback  CONFIRM=DISABLE-LOGIN: disable the vhost and reload (certificate kept) - sudo
set -euo pipefail
H=login.tcdsolutionsgroup.com; IP=139.177.200.80; PORT=8098
AV=/etc/nginx/sites-available/$H; EN=/etc/nginx/sites-enabled/$H
FAILS=0
probe() { local want=$1; shift; local got; got=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@" || true)
  if [[ " $want " == *" $got "* ]]; then echo "PASS $got ${*: -1}"; else echo "FAIL ${*: -1}: $got (want $want)"; FAILS=$((FAILS+1)); fi; }
vhost() { cat <<NGINX
# login (PRODUCTION): central passkey pages only (127.0.0.1:$PORT) - approve recovery emails, enroll approver passkeys.
limit_req_zone \$binary_remote_addr zone=tcds_login_prod:10m rate=5r/s;
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
 add_header X-Frame-Options DENY always;
 proxy_hide_header Referrer-Policy;
 client_max_body_size 16k;
 location /internal/ { return 404; }
 location ^~ /approve/ {
   limit_req zone=tcds_login_prod burst=15 nodelay;
   proxy_set_header Host \$host;
   proxy_set_header X-Forwarded-Proto https;
   proxy_set_header X-Real-IP \$remote_addr;
   proxy_set_header X-Forwarded-For \$remote_addr;
   proxy_pass http://127.0.0.1:$PORT;
   proxy_read_timeout 15s;
   proxy_hide_header Server;
   proxy_hide_header Referrer-Policy;
 }
 location ^~ /enroll/ {
   limit_req zone=tcds_login_prod burst=15 nodelay;
   client_max_body_size 64k;
   proxy_set_header Host \$host;
   proxy_set_header X-Forwarded-Proto https;
   proxy_set_header X-Real-IP \$remote_addr;
   proxy_set_header X-Forwarded-For \$remote_addr;
   proxy_pass http://127.0.0.1:$PORT;
   proxy_read_timeout 15s;
   proxy_hide_header Server;
   proxy_hide_header Referrer-Policy;
 }
 location = / { return 302 https://warehouse-app.tcdsolutionsgroup.com/; }
 location / { return 404; }
}
NGINX
}
probes() {
  probe "301" "http://$H/approve/recovery/"
  probe "200 502" "https://$H/approve/recovery/"
  probe "200 502" "https://$H/enroll/"
  probe "404" "https://$H/internal/v1/central/ready"
  probe "404" "https://$H/api/v1/auth/ready"
  probe "302" "https://$H/"
  echo "   HSTS: $(curl -sI --max-time 10 "https://$H/approve/recovery/" | grep -ci '^strict-transport-security') | cert: $(echo | openssl s_client -connect $H:443 -servername $H 2>/dev/null | openssl x509 -noout -subject -enddate 2>/dev/null | tr '\n' ' ')"
  port_up=$( (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null && echo yes || echo no)
  echo "   page listener :$PORT up: $port_up  (no = login API not deployed yet, so /approve/ and /enroll/ answer 502 - expected for now)"
  [ $FAILS = 0 ] && echo "PROBES OK" || echo "PROBES: $FAILS failed"; }

case "${1:-}" in
check)
  echo "DNS: $(getent ahostsv4 $H | awk 'NR==1{print $1}') (want $IP); public 1.1.1.1: $(dig +short A $H @1.1.1.1 2>/dev/null | head -1)"
  command -v certbot >/dev/null && echo "certbot: $(certbot --version 2>&1)" || echo "certbot: MISSING"
  sudo nginx -t 2>&1 | tail -1
  [ -e "$EN" ] && echo "vhost: enabled" || echo "vhost: not enabled yet"
  sudo test -d /etc/letsencrypt/live/$H && echo "certificate: present" || echo "certificate: not issued yet"
  sudo grep -rl "zone=tcds_login_prod" /etc/nginx/sites-enabled/ 2>/dev/null | grep -v "$H" && echo "!! zone name already used elsewhere" || echo "zone name tcds_login_prod: free"
  (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null && echo "port $PORT: listening" || echo "port $PORT: not listening (login API not deployed yet - fine)" ;;
cert)
  [ "${CONFIRM:-}" = "ISSUE-LOGIN-CERT" ] || { echo "set CONFIRM=ISSUE-LOGIN-CERT"; exit 1; }
  [ "$(dig +short A $H @1.1.1.1 | head -1)" = "$IP" ] || { echo "public DNS for $H is not $IP - stopping"; exit 1; }
  sudo certbot certonly --nginx -d "$H" --non-interactive --keep-until-expiring
  sudo test -s /etc/letsencrypt/live/$H/fullchain.pem && echo "CERTIFICATE ISSUED: $(sudo openssl x509 -in /etc/letsencrypt/live/$H/fullchain.pem -noout -enddate)" ;;
site)
  [ "${CONFIRM:-}" = "ENABLE-LOGIN" ] || { echo "set CONFIRM=ENABLE-LOGIN"; exit 1; }
  sudo test -s /etc/letsencrypt/live/$H/fullchain.pem || { echo "run cert first"; exit 1; }
  [ -e "$AV" ] && sudo cp -p "$AV" "$AV.bak-$(date -u +%Y%m%dT%H%M%SZ)"
  vhost | sudo tee "$AV.tmp" >/dev/null; sudo mv "$AV.tmp" "$AV"; sudo chmod 644 "$AV"
  sudo ln -sfn "$AV" "$EN"
  if ! sudo nginx -t 2>&1 | tail -2; then :; fi
  if sudo nginx -t >/dev/null 2>&1; then sudo systemctl reload nginx; echo "vhost enabled + nginx reloaded"; sleep 2; probes
  else sudo rm -f "$EN"; echo "nginx -t FAILED - vhost disabled again, nothing reloaded"; exit 1; fi ;;
probe) probes ;;
rollback)
  [ "${CONFIRM:-}" = "DISABLE-LOGIN" ] || { echo "set CONFIRM=DISABLE-LOGIN"; exit 1; }
  sudo rm -f "$EN"; sudo nginx -t && sudo systemctl reload nginx && echo "vhost disabled (certificate kept)" ;;
*) sed -n '2,11p' "$0"; exit 2 ;;
esac
