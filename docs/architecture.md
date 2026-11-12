# Architecture

- **Astro** builds a static landing page into `dist/`.
- **Express** (`server/index.js`) serves `dist/`, exposes `GET /health`, `POST /api/lead`, and PIN-gated `GET|POST /app-download` for the Android APK.
- Leads are appended to `data/leads.jsonl`.
- APK file is served from `releases/svetlana-schedule.apk` (Docker bind-mount `./releases`).
- **Caddy** reverse-proxies HTTP to the Node app in Docker Compose.
- Desktop Docker: `docker compose up --build -d` → http://localhost:3080 (ports 3080/3443; host `:80`/`:8080` often occupied)
