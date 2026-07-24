#!/usr/bin/env sh
set -eu
IMAGE="tcds-domain6-warehouse-pwa:v3.0.0"
CONTAINER="tcds-domain6-shell-smoke"

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker build --pull -t "$IMAGE" .
docker run -d --name "$CONTAINER" -p 18080:80 "$IMAGE" >/dev/null
trap 'docker rm -f "$CONTAINER" >/dev/null 2>&1 || true' EXIT

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if wget -qO- http://127.0.0.1:18080/health | grep -q ok; then
    wget -qO- http://127.0.0.1:18080/ | grep -qi '<div id="root">'
    printf '%s\n' 'PASS: Docker build, nginx health, and SPA shell verified.'
    exit 0
  fi
  sleep 2
done

printf '%s\n' 'FAIL: container did not become healthy.' >&2
exit 1
