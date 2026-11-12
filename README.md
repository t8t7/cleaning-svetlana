# Светлана — уборка квартир с заботой

Продающий SEO-лендинг клининга в Йошкар-Оле. Стек: **Astro** (статика) + **Express** (раздача и API заявок) + **Caddy** + **Docker**.

## Требования

- Node.js 20+
- Docker Desktop (для контейнерного запуска)

## Локальный запуск

```bash
npm install
npm run build
npm start
```

Сайт: http://localhost:3000

Режим разработки фронтенда:

```bash
npm run dev
```

## Docker Desktop

```bash
docker compose up --build -d
```

Откройте http://localhost:3080 (Caddy → Express → Astro `dist`). Порты 3080/3443 — чтобы не конфликтовать с системным :80 и занятым :8080.

Остановка:

```bash
docker compose down
```

## API

- `GET /health` — статус сервиса
- `POST /api/lead` — заявка `{ name, phone, service?, comment? }` → запись в `data/leads.jsonl`
- `GET /api/availability` — публичное расписание (для сайта)
- `GET /api/availability/stream` — мгновенные обновления расписания для открытых вкладок (SSE)
- `PUT /api/availability` — обновление с телефона (`Authorization: Bearer <MASTER_TOKEN>`)
- `GET /api/app-version` — актуальная версия Android APK (`releases/app-version.json`)
- `GET /api/app-apk` — скачать APK для обновления из приложения (`Authorization: Bearer <MASTER_TOKEN>`)
- `GET /api/prices` — публичный прайс (для сайта); с `Authorization: Bearer <MASTER_TOKEN>` — полный список включая выключенные
- `PUT /api/prices` — полное обновление прайса с телефона (`Authorization: Bearer <MASTER_TOKEN>`)
  - позиция: `{ id, name, price, priceFrom, unit: "m2"|"fixed", durationMinutes, sort, enabled }`
- `GET /api/calculator` — ориентиры калькулятора (студия/1/2/3 × тип уборки)
- `PUT /api/calculator` — обновление калькулятора с телефона (`Authorization: Bearer <MASTER_TOKEN>`)
- `GET /api/services` — цена/время карточек блока «Услуги» (названия на сайте статичны)
- `PUT /api/services` — обновление цены/времени услуг (`Authorization: Bearer <MASTER_TOKEN>`)
  - карточка: `{ id: "general"|"after-repair"|"maintain"|"windows", price, priceFrom, unit: "m2"|"fixed"|"request", durationMinutes, durationMinutesMax, durationApprox, durationText }`
- `GET /api/works` — галерея «Чистые кадры»
- `POST /api/works` — загрузка фото (токен, multipart `photo` + `caption`)
  - на сервере: WebP + превью 720×540 (4:3) для сетки и полное до 1600px для просмотра
- `DELETE /api/works/:id` — удаление фото (токен)
- `POST /api/works/:id/rate` — оценка 1–5 от клиента

Токен задаётся в `.env` / `MASTER_TOKEN` (см. `.env.example`).

## Android-приложение (расписание)

Папка [`mobile/`](mobile/) — Expo APK для мастера. Инструкция сборки: [`mobile/README.md`](mobile/README.md).

Скрытая раздача APK с сайта (для тестов, без USB):

- Страница: `/app-download` (не в меню, `noindex`)
- PIN: `APK_DOWNLOAD_PIN` в `.env`
- Файл на сервере: `releases/svetlana-schedule.apk` (том Docker `./releases` → `/app/releases`)

## Контент и SEO

- Телефон-заглушка: `+7 (000) 000-00-00`
- OG-превью: `public/og-image.jpg` (1200×630)
- `robots.txt`, `sitemap.xml`, JSON-LD `HomeAndConstructionBusiness` (LocalBusiness) / Service / FAQ
