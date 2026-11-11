# Architecture

- **Astro** builds a static landing page into `dist/`.
- **Express** (`server/index.js`) serves `dist/`, exposes `GET /health` and `POST /api/lead`.
- Leads are appended to `data/leads.jsonl`.
- **Caddy** reverse-proxies HTTP to the Node app in Docker Compose.
- Desktop Docker: `docker compose up --build -d` → http://localhost:3080 (ports 3080/3443; host `:80`/`:8080` often occupied)
