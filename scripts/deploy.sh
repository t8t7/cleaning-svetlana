#!/usr/bin/env bash
# Run on VPS as `anubis` from /var/www/cleaning-svetlana (or any APP_DIR).
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/cleaning-svetlana}"
REPO_URL="${REPO_URL:-https://github.com/t8t7/cleaning-svetlana.git}"
BRANCH="${BRANCH:-main}"

cd "$APP_DIR"

if [ ! -d .git ]; then
  if [ -n "$(ls -A . 2>/dev/null | grep -v '^\.env$' || true)" ]; then
    echo "ERROR: $APP_DIR is not empty and has no .git — aborting"
    exit 1
  fi
  git clone --branch "$BRANCH" "$REPO_URL" .
else
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git reset --hard "origin/$BRANCH"
fi

if [ ! -f .env ]; then
  echo "ERROR: missing $APP_DIR/.env"
  echo "Create it: cp .env.example .env && nano .env"
  exit 1
fi

docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d --remove-orphans
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
curl -fsS "http://127.0.0.1:3000/health"
echo
echo "Deploy finished."
