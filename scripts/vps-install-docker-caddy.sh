#!/usr/bin/env bash
# One-time bootstrap on Ubuntu VPS. Run as user `anubis` (needs sudo).
# Does NOT deploy the app. Does NOT touch unrelated services.
set -euo pipefail

echo "==> Installing Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
else
  echo "Docker already installed: $(docker --version)"
fi

echo "==> Allow anubis to use Docker without sudo"
sudo usermod -aG docker "$USER"

echo "==> Installing Caddy (system package)"
if ! command -v caddy >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y caddy
else
  echo "Caddy already installed: $(caddy version)"
fi

echo "==> Open firewall ports 22/80/443 if ufw is active"
if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow OpenSSH || true
  sudo ufw allow 80/tcp || true
  sudo ufw allow 443/tcp || true
  sudo ufw status || true
fi

echo
echo "DONE. Log out and log back in (or run: newgrp docker) so docker group applies."
echo "Next: deploy app, then install /etc/caddy/Caddyfile from deploy/Caddyfile"
