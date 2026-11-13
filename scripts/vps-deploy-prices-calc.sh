#!/bin/sh
set -eu
cd /var/www/cleaning-svetlana
mkdir -p server
cp -f /tmp/patch/index.js server/index.js
cp -f /tmp/patch/prices.js server/prices.js
cp -f /tmp/patch/calculator.js server/calculator.js
cp -f /tmp/patch/serviceCards.js server/serviceCards.js

docker compose -f docker-compose.yml -f docker-compose.prod.yml build web
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate web

i=1
while [ "$i" -le 40 ]; do
  if curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1; then
    echo READY
    break
  fi
  i=$((i + 1))
  sleep 3
done

curl -fsS http://127.0.0.1:3000/api/calculator | head -c 400
echo
curl -fsS http://127.0.0.1:3000/api/prices | head -c 200
echo
echo PRICES_CALC_OK
