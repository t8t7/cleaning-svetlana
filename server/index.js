import express from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getLiveStatus,
  readAvailability,
  validateAvailabilityPayload,
  writeAvailabilityAtomic,
} from './availability.js';
import {
  publicPrices,
  readPrices,
  validatePricesPayload,
  writePricesAtomic,
} from './prices.js';
import {
  publicServiceCards,
  readServiceCards,
  validateServiceCardsPayload,
  writeServiceCardsAtomic,
} from './serviceCards.js';
import {
  addWork,
  deleteWork,
  ensureWorksDirs,
  publicWork,
  rateWork,
  readWorks,
} from './works.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const dataDir = path.join(root, 'data');
const leadsFile = path.join(dataDir, 'leads.jsonl');
const availabilityFile = path.join(dataDir, 'availability.json');
const pricesFile = path.join(dataDir, 'prices.json');
const serviceCardsFile = path.join(dataDir, 'service-cards.json');
const worksFile = path.join(dataDir, 'works.json');
const uploadsRoot = path.join(dataDir, 'uploads');
const releasesDir = path.join(root, 'releases');
const apkFile = path.join(releasesDir, 'svetlana-schedule.apk');
const port = Number(process.env.PORT || 3000);
const masterToken = String(process.env.MASTER_TOKEN || '').trim();
const apkDownloadPin = String(process.env.APK_DOWNLOAD_PIN || '').trim();

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '4kb' }));

const leadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много заявок. Попробуйте позже.' },
});

const availabilityWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много обновлений. Попробуйте позже.' },
});

const pricesWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много обновлений прайса. Попробуйте позже.' },
});

const worksWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много загрузок. Попробуйте позже.' },
});

const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много оценок. Попробуйте позже.' },
});

const apkDownloadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Слишком много попыток. Попробуйте позже.',
});

const upload = multer({
  dest: path.join(os.tmpdir(), 'svetlana-uploads'),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Допустимы только JPEG, PNG или WebP'), ok);
  },
});

function sanitize(value, max = 200) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

function isValidPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

function extractBearer(req) {
  const header = String(req.get('authorization') || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function requireMasterToken(req, res) {
  if (!masterToken) {
    res.status(503).json({ error: 'MASTER_TOKEN не настроен на сервере' });
    return false;
  }
  const token = extractBearer(req);
  if (!token || token !== masterToken) {
    res.status(401).json({ error: 'Неверный токен' });
    return false;
  }
  return true;
}

function pinsMatch(provided, expected) {
  const a = Buffer.from(String(provided || ''), 'utf8');
  const b = Buffer.from(String(expected || ''), 'utf8');
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderApkDownloadPage({ error = '', disabled = false } = {}) {
  const errorHtml = error
    ? `<p class="error">${escapeHtml(error)}</p>`
    : '';
  const formHtml = disabled
    ? ''
    : `<form method="post" action="/app-download">
        <label for="pin">PIN</label>
        <input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="one-time-code" required autofocus />
        <button type="submit">Скачать APK</button>
      </form>`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Скачать приложение</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f0fdfa; color: #134e4a; }
    main { width: min(100% - 2rem, 22rem); background: #fff; border: 1px solid #99f6e4; border-radius: 12px; padding: 1.25rem; }
    h1 { font-size: 1.15rem; margin: 0 0 0.5rem; }
    p { margin: 0 0 1rem; line-height: 1.4; font-size: 0.95rem; }
    label { display: block; font-size: 0.85rem; margin-bottom: 0.35rem; }
    input { width: 100%; box-sizing: border-box; padding: 0.7rem 0.75rem; border: 1px solid #5eead4; border-radius: 8px; font-size: 1rem; }
    button { margin-top: 0.85rem; width: 100%; border: 0; border-radius: 8px; padding: 0.75rem; background: #0f766e; color: #fff; font-size: 1rem; cursor: pointer; }
    .error { color: #b91c1c; }
  </style>
</head>
<body>
  <main>
    <h1>Приложение мастера</h1>
    <p>Введите PIN, чтобы скачать APK для Android.</p>
    ${errorHtml}
    ${formHtml}
  </main>
</body>
</html>`;
}

async function apkFileReady() {
  try {
    const stat = await fs.stat(apkFile);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

async function cleanupTemp(file) {
  if (!file?.path) return;
  try {
    await fs.unlink(file.path);
  } catch {
    /* ignore */
  }
}

const availabilityStreamClients = new Set();

function sendAvailabilityEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcastAvailability(payload) {
  for (const client of availabilityStreamClients) {
    try {
      sendAvailabilityEvent(client, 'availability', payload);
    } catch {
      availabilityStreamClients.delete(client);
      try {
        client.end();
      } catch {
        /* ignore */
      }
    }
  }
}

async function loadAvailabilityPayload() {
  const data = await readAvailability(availabilityFile);
  const live = getLiveStatus(data.weekPlan);
  return { ...data, live };
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/availability', async (_req, res) => {
  try {
    const payload = await loadAvailabilityPayload();
    res.set('Cache-Control', 'no-store');
    return res.json(payload);
  } catch (error) {
    console.error('availability_read_error', error);
    return res.status(500).json({ error: 'Не удалось прочитать расписание' });
  }
});

app.get('/api/availability/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  availabilityStreamClients.add(res);
  sendAvailabilityEvent(res, 'connected', { ok: true });

  try {
    const payload = await loadAvailabilityPayload();
    sendAvailabilityEvent(res, 'availability', payload);
  } catch (error) {
    console.error('availability_stream_seed_error', error);
  }

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);

  const cleanup = () => {
    clearInterval(heartbeat);
    availabilityStreamClients.delete(res);
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
});

app.put('/api/availability', availabilityWriteLimiter, async (req, res) => {
  try {
    if (!requireMasterToken(req, res)) return;

    const checked = validateAvailabilityPayload(req.body);
    if (!checked.ok) {
      return res.status(400).json({ error: checked.error });
    }

    await writeAvailabilityAtomic(availabilityFile, checked.data);
    const live = getLiveStatus(checked.data.weekPlan);
    const payload = { ...checked.data, live };
    broadcastAvailability(payload);
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, ...payload });
  } catch (error) {
    console.error('availability_write_error', error);
    return res.status(500).json({ error: 'Не удалось сохранить расписание' });
  }
});

app.get('/api/prices', async (_req, res) => {
  try {
    const data = await readPrices(pricesFile);
    res.set('Cache-Control', 'no-store');
    return res.json(publicPrices(data));
  } catch (error) {
    console.error('prices_read_error', error);
    return res.status(500).json({ error: 'Не удалось прочитать прайс' });
  }
});

app.put('/api/prices', pricesWriteLimiter, async (req, res) => {
  try {
    if (!requireMasterToken(req, res)) return;

    const checked = validatePricesPayload(req.body);
    if (!checked.ok) {
      return res.status(400).json({ error: checked.error });
    }

    await writePricesAtomic(pricesFile, checked.data);
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, ...publicPrices(checked.data) });
  } catch (error) {
    console.error('prices_write_error', error);
    return res.status(500).json({ error: 'Не удалось сохранить прайс' });
  }
});

app.get('/api/services', async (_req, res) => {
  try {
    const data = await readServiceCards(serviceCardsFile);
    res.set('Cache-Control', 'no-store');
    return res.json(publicServiceCards(data));
  } catch (error) {
    console.error('service_cards_read_error', error);
    return res.status(500).json({ error: 'Не удалось прочитать услуги' });
  }
});

app.put('/api/services', pricesWriteLimiter, async (req, res) => {
  try {
    if (!requireMasterToken(req, res)) return;

    const checked = validateServiceCardsPayload(req.body);
    if (!checked.ok) {
      return res.status(400).json({ error: checked.error });
    }

    await writeServiceCardsAtomic(serviceCardsFile, checked.data);
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, ...publicServiceCards(checked.data) });
  } catch (error) {
    console.error('service_cards_write_error', error);
    return res.status(500).json({ error: 'Не удалось сохранить услуги' });
  }
});

app.get('/api/works', async (_req, res) => {
  try {
    const data = await readWorks(worksFile);
    res.set('Cache-Control', 'no-store');
    return res.json({ items: data.items.map(publicWork) });
  } catch (error) {
    console.error('works_read_error', error);
    return res.status(500).json({ error: 'Не удалось прочитать галерею' });
  }
});

app.post('/api/works', worksWriteLimiter, (req, res) => {
  upload.single('photo')(req, res, async (err) => {
    try {
      if (err) {
        const message = err.message?.includes('File too large')
          ? 'Файл больше 4 МБ'
          : err.message || 'Ошибка загрузки';
        return res.status(400).json({ error: message });
      }
      if (!requireMasterToken(req, res)) {
        await cleanupTemp(req.file);
        return;
      }
      if (!req.file) {
        return res.status(400).json({ error: 'Прикрепите фото' });
      }

      const uploadsDir = await ensureWorksDirs(dataDir);
      const result = await addWork(worksFile, uploadsDir, req.file, req.body?.caption);
      if (!result.ok) {
        await cleanupTemp(req.file);
        return res.status(400).json({ error: result.error });
      }
      return res.status(201).json({ ok: true, item: result.item });
    } catch (error) {
      console.error('works_upload_error', error);
      await cleanupTemp(req.file);
      return res.status(500).json({ error: 'Не удалось сохранить фото' });
    }
  });
});

app.delete('/api/works/:id', worksWriteLimiter, async (req, res) => {
  try {
    if (!requireMasterToken(req, res)) return;
    const uploadsDir = await ensureWorksDirs(dataDir);
    const result = await deleteWork(worksFile, uploadsDir, sanitize(req.params.id, 40));
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    return res.json({ ok: true });
  } catch (error) {
    console.error('works_delete_error', error);
    return res.status(500).json({ error: 'Не удалось удалить фото' });
  }
});

app.post('/api/works/:id/rate', rateLimiter, async (req, res) => {
  try {
    const result = await rateWork(worksFile, sanitize(req.params.id, 40), req.body?.stars);
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    return res.json({ ok: true, item: result.item });
  } catch (error) {
    console.error('works_rate_error', error);
    return res.status(500).json({ error: 'Не удалось сохранить оценку' });
  }
});

app.post('/api/lead', leadLimiter, async (req, res) => {
  try {
    const name = sanitize(req.body?.name, 80);
    const phone = sanitize(req.body?.phone, 30);
    const service = sanitize(req.body?.service, 80);
    const comment = sanitize(req.body?.comment, 500);

    if (name.length < 2) {
      return res.status(400).json({ error: 'Укажите имя' });
    }
    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'Укажите корректный телефон' });
    }

    await fs.mkdir(dataDir, { recursive: true });
    const record = {
      createdAt: new Date().toISOString(),
      name,
      phone,
      service,
      comment,
      ip: req.ip,
    };
    await fs.appendFile(leadsFile, `${JSON.stringify(record)}\n`, 'utf8');
    return res.status(201).json({ ok: true });
  } catch (error) {
    console.error('lead_error', error);
    return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

app.get('/app-download', (_req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  if (!apkDownloadPin) {
    return res
      .status(503)
      .type('html')
      .send(renderApkDownloadPage({ error: 'Скачивание временно недоступно (PIN не настроен).', disabled: true }));
  }
  return res.type('html').send(renderApkDownloadPage());
});

app.post('/app-download', apkDownloadLimiter, async (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');

  if (!apkDownloadPin) {
    return res
      .status(503)
      .type('html')
      .send(renderApkDownloadPage({ error: 'Скачивание временно недоступно (PIN не настроен).', disabled: true }));
  }

  const pin = sanitize(req.body?.pin, 64);
  if (!pinsMatch(pin, apkDownloadPin)) {
    return res.status(401).type('html').send(renderApkDownloadPage({ error: 'Неверный PIN' }));
  }

  if (!(await apkFileReady())) {
    return res
      .status(404)
      .type('html')
      .send(renderApkDownloadPage({ error: 'APK ещё не загружен на сервер.' }));
  }

  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  return res.download(apkFile, 'svetlana-schedule.apk', (err) => {
    if (err && !res.headersSent) {
      console.error('apk_download_error', err);
      res.status(500).type('html').send(renderApkDownloadPage({ error: 'Не удалось отдать APK.' }));
    }
  });
});

app.use(
  '/uploads',
  express.static(uploadsRoot, {
    maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
    fallthrough: false,
  })
);

app.use(
  express.static(distDir, {
    extensions: ['html'],
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  })
);

app.use((req, res) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.status(404).sendFile(path.join(distDir, '404.html'), (err) => {
      if (err) {
        res.status(404).type('text').send('Not found');
      }
    });
  }
  return res.status(404).json({ error: 'Not found' });
});

await ensureWorksDirs(dataDir).catch(() => {});

app.listen(port, () => {
  console.log(`Svetlana cleaning server listening on http://localhost:${port}`);
  if (!masterToken) {
    console.warn('MASTER_TOKEN is not set — protected write routes will return 503');
  }
  if (!apkDownloadPin) {
    console.warn('APK_DOWNLOAD_PIN is not set — /app-download will return 503');
  }
});
