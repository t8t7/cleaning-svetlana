#!/bin/sh
set -eu
cd /var/www/cleaning-svetlana
mkdir -p src/components src/data
cp -f /tmp/patch/Pricing.astro src/components/Pricing.astro
cp -f /tmp/patch/site.js src/data/site.js

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

curl -fsS http://127.0.0.1:3000/ | tr '"' '\n' | grep -E 'data-calc-type|calc-mwey|Ку|Тип уборки' | head -n 20 || true
curl -fsS http://127.0.0.1:3000/api/calculator | head -c 300
echo
echo PRICING_UI_OK
