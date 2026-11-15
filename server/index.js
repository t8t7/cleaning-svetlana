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
  managePrices,
  publicPrices,
  readPrices,
  validatePricesPayload,
  writePricesAtomic,
} from './prices.js';
import {
  publicCalculator,
  readCalculator,
  validateCalculatorPayload,
  writeCalculatorAtomic,
} from './calculator.js';
import {
  publicServiceCards,
  readServiceCards,
  validateServiceCardsPayload,
  writeServiceCardsAtomic,
} from './serviceCards.js';
import {
  addWork,
  deleteWork,
  ensureDemoWorks,
  ensureWorksDirs,
  publicWork,
  rateWork,
  readWorks,
  updateWorkCaption,
} from './works.js';
import {
  ensureAccess,
  publicAccessState,
  rotateMasterToken,
  tokenAccepted,
} from './access.js';
import {
  getDevice,
  listDevices,
  removeDevice,
  sanitizeDeviceId,
  touchDevice,
  updateDevice,
} from './devices.js';
import {
  adminSessionCookie,
  clearAdminSessionCookie,
  createAdminSessionToken,
  ensureAdminSessionSecret,
  panelPath,
  parseCookies,
  readAdminSession,
} from './adminAuth.js';
import {
  adminPublicOrigin,
  clearOAuthStateCookie,
  createOAuthTransaction,
  emailAllowed,
  exchangeGoogleCode,
  googleAuthorizeUrl,
  googleRedirectUri,
  oauthStateCookie,
  OAUTH_COOKIE,
  parseAdminEmails,
  readOAuthTransaction,
  verifyGoogleIdToken,
} from './googleAdmin.js';
import {
  confirmTotp,
  enrollmentQr,
  loadOrCreateTotp,
  totpStatus,
  verifyTotpCode,
} from './adminTotp.js';
import {
  clearOwnerMessage,
  publicOwnerMessage,
  readOwnerMessage,
  setOwnerMessage,
} from './ownerMessage.js';
import {
  appendAnalyticsEvent,
  buildAnalyticsWorkbook,
  normalizeEventInput,
  parsePeriod,
  readAnalyticsEvents,
  summarizeAnalytics,
} from './analytics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const dataDir = path.join(root, 'data');
const analyticsDir = path.join(dataDir, 'analytics');
const leadsFile = path.join(dataDir, 'leads.jsonl');
const availabilityFile = path.join(dataDir, 'availability.json');
const pricesFile = path.join(dataDir, 'prices.json');
const calculatorFile = path.join(dataDir, 'calculator.json');
const serviceCardsFile = path.join(dataDir, 'service-cards.json');
const worksFile = path.join(dataDir, 'works.json');
const accessFile = path.join(dataDir, 'access.json');
const devicesFile = path.join(dataDir, 'devices.json');
const ownerMessageFile = path.join(dataDir, 'owner-message.json');
const adminHtmlFile = path.join(__dirname, 'admin.html');
const uploadsRoot = path.join(dataDir, 'uploads');
const releasesDir = path.join(root, 'releases');
const apkFile = path.join(releasesDir, 'svetlana-schedule.apk');
const appVersionFile = path.join(releasesDir, 'app-version.json');
const port = Number(process.env.PORT || 3000);
const masterTokenEnv = String(process.env.MASTER_TOKEN || '').trim();
const apkDownloadPin = String(process.env.APK_DOWNLOAD_PIN || '').trim();
const adminPassword = String(process.env.ADMIN_PASSWORD || '').trim();
const googleClientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
const googleClientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
const adminEmails = parseAdminEmails(process.env.ADMIN_GOOGLE_EMAILS);
const adminPublicOriginEnv = String(process.env.ADMIN_PUBLIC_ORIGIN || 'https://test-fas.ru').trim();
const adminPath = panelPath(process.env.ADMIN_PATH);
const adminSessionSecretFile = path.join(dataDir, 'admin-session.secret');
const adminTotpFile = path.join(dataDir, 'admin-totp.json');
let adminSessionSecret = '';

const app = express();
app.set('trust proxy', 1);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self'; object-src 'none'"
  );
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // HSTS is meaningful only behind HTTPS (Caddy). Harmless on plain HTTP for crawlers checking the header.
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  next();
});
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

const trackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов.' },
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

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || '')
    .replace(/^::ffff:/, '')
    .slice(0, 64);
}

function devicePayloadFromRequest(req) {
  return {
    id: sanitizeDeviceId(req.get('x-device-id')),
    name: sanitize(req.get('x-device-name'), 80),
    model: sanitize(req.get('x-device-model'), 80),
    brand: sanitize(req.get('x-device-brand'), 40),
    platform: sanitize(req.get('x-device-platform'), 40),
    appVersion: sanitize(req.get('x-app-version'), 40),
    ip: clientIp(req),
  };
}

async function loadAccess() {
  return ensureAccess(accessFile, masterTokenEnv);
}

async function isMasterRequest(req) {
  const access = await loadAccess();
  return tokenAccepted(access, extractBearer(req));
}

async function requireMasterToken(req, res, { requireDevice = false } = {}) {
  const access = await loadAccess();
  if (!access.masterToken) {
    res.status(503).json({ error: 'MASTER_TOKEN не настроен на сервере' });
    return false;
  }
  const token = extractBearer(req);
  if (!tokenAccepted(access, token)) {
    res.status(401).json({ error: 'Неверный токен' });
    return false;
  }

  const deviceInfo = devicePayloadFromRequest(req);
  if (!deviceInfo.id) {
    if (requireDevice) {
      res.status(400).json({ error: 'Нужен ID устройства. Обновите приложение.' });
      return false;
    }
    req.access = access;
    req.device = null;
    return true;
  }

  const existing = await getDevice(devicesFile, deviceInfo.id);
  if (existing?.blocked) {
    res.status(403).json({ error: 'Это устройство заблокировано', blocked: true });
    return false;
  }

  const touched = await touchDevice(devicesFile, deviceInfo);
  if (!touched.ok) {
    res.status(touched.status || 400).json({ error: touched.error || 'Ошибка устройства' });
    return false;
  }
  if (touched.item.blocked) {
    res.status(403).json({ error: 'Это устройство заблокировано', blocked: true });
    return false;
  }

  req.access = access;
  req.device = touched.item;
  return true;
}

function googleAdminConfigured() {
  return Boolean(adminPath && googleClientId && googleClientSecret && adminEmails.size && adminSessionSecret);
}

function cookieSecure(req) {
  const host = String(req.get('host') || '').toLowerCase();
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return false;
  return true;
}

function passwordLoginEnabled() {
  return Boolean(adminPath && adminSessionSecret && adminPassword && !googleAdminConfigured());
}

function requireAdmin(req, res) {
  if (!adminPath || !adminSessionSecret) {
    res.status(503).json({ error: 'Панель не настроена на сервере' });
    return false;
  }
  const session = readAdminSession(req, adminSessionSecret);
  if (!session) {
    res.status(401).json({ error: 'Нужен вход в панель' });
    return false;
  }
  if (session.method === 'password') {
    if (!passwordLoginEnabled()) {
      res.status(401).json({ error: 'Нужен вход в панель' });
      return false;
    }
    req.adminEmail = '';
    return true;
  }
  if (!googleAdminConfigured() || !emailAllowed(session.email, adminEmails)) {
    res.status(401).json({ error: 'Нужен вход в панель' });
    return false;
  }
  req.adminEmail = session.email;
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

async function readAppVersion() {
  const raw = await fs.readFile(appVersionFile, 'utf8');
  const parsed = JSON.parse(raw);
  const versionCode = Number(parsed.versionCode);
  const versionName = String(parsed.versionName || '').trim();
  if (!Number.isFinite(versionCode) || versionCode < 1 || !versionName) {
    throw new Error('Invalid app-version.json');
  }
  return {
    versionName,
    versionCode: Math.floor(versionCode),
    apkFileName: String(parsed.apkFileName || 'svetlana-schedule.apk').trim() || 'svetlana-schedule.apk',
  };
}

function sendApkFile(res, { asJsonError = true } = {}) {
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="svetlana-schedule.apk"');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, no-store');
  // Prefer sendFile (kernel sendfile) over buffering the whole APK in Node.
  return res.sendFile(apkFile, (err) => {
    if (err && !res.headersSent) {
      console.error('apk_download_error', err);
      if (asJsonError) {
        res.status(500).json({ error: 'Не удалось отдать APK' });
      } else {
        res.status(500).type('html').send(renderApkDownloadPage({ error: 'Не удалось отдать APK.' }));
      }
    }
  });
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
const pricingStreamClients = new Set();
const worksStreamClients = new Set();
const sseConnectionsByIp = new Map();
const SSE_MAX_TOTAL = 200;
const SSE_MAX_PER_IP = 8;

function sendSseEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sseTotalConnections() {
  return (
    availabilityStreamClients.size + pricingStreamClients.size + worksStreamClients.size
  );
}

/** Acquire an SSE slot or send 429/503. Returns cleanup fn on success. */
function acquireSseConnection(req, res, clients) {
  const ip = clientIp(req) || 'unknown';
  if (sseTotalConnections() >= SSE_MAX_TOTAL) {
    res.status(503).json({ error: 'Слишком много подключений. Попробуйте позже.' });
    return null;
  }
  const current = sseConnectionsByIp.get(ip) || 0;
  if (current >= SSE_MAX_PER_IP) {
    res.status(429).json({ error: 'Слишком много подключений с вашего адреса.' });
    return null;
  }

  sseConnectionsByIp.set(ip, current + 1);
  clients.add(res);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    clients.delete(res);
    const left = (sseConnectionsByIp.get(ip) || 1) - 1;
    if (left <= 0) sseConnectionsByIp.delete(ip);
    else sseConnectionsByIp.set(ip, left);
  };
}

function broadcastToClients(clients, event, payload) {
  for (const client of clients) {
    try {
      sendSseEvent(client, event, payload);
    } catch {
      clients.delete(client);
      try {
        client.end();
      } catch {
        /* ignore */
      }
    }
  }
}

function broadcastAvailability(payload) {
  broadcastToClients(availabilityStreamClients, 'availability', payload);
}

function broadcastPricingEvent(event, payload) {
  broadcastToClients(pricingStreamClients, event, payload);
}

async function broadcastWorks() {
  const data = await readWorks(worksFile);
  broadcastToClients(worksStreamClients, 'works', {
    items: data.items.map(publicWork),
    serverTime: new Date().toISOString(),
  });
}

/** Keep shared ids in sync between price list and service cards (e.g. general, windows). */
async function syncPricesFromServices(serviceData) {
  const prices = await readPrices(pricesFile);
  let changed = false;
  const byId = new Map((serviceData.items || []).map((item) => [item.id, item]));

  const items = (prices.items || []).map((row) => {
    const svc = byId.get(row.id);
    if (!svc) return row;
    if (svc.unit === 'request') return row;
    const next = {
      ...row,
      price: Math.round(Number(svc.price) || 0),
      priceFrom: svc.priceFrom !== false,
      unit: svc.unit === 'm2' ? 'm2' : 'fixed',
      durationMinutes:
        svc.durationMinutes == null ? row.durationMinutes : Math.round(Number(svc.durationMinutes) || 0),
    };
    if (
      next.price !== row.price ||
      next.priceFrom !== row.priceFrom ||
      next.unit !== row.unit ||
      next.durationMinutes !== row.durationMinutes
    ) {
      changed = true;
    }
    return next;
  });

  if (!changed) return null;
  const payload = {
    meta: {
      ...prices.meta,
      updatedAt: new Date().toISOString(),
    },
    items,
  };
  await writePricesAtomic(pricesFile, payload);
  return payload;
}

async function syncServicesFromPrices(priceData) {
  const services = await readServiceCards(serviceCardsFile);
  let changed = false;
  const byId = new Map((priceData.items || []).map((item) => [item.id, item]));

  const items = (services.items || []).map((row) => {
    const price = byId.get(row.id);
    if (!price || price.enabled === false) return row;
    if (row.unit === 'request') return row;
    const nextUnit = price.unit === 'm2' ? 'm2' : 'fixed';
    const next = {
      ...row,
      price: Math.round(Number(price.price) || 0),
      priceFrom: price.priceFrom !== false,
      unit: nextUnit,
      durationMinutes: Math.round(Number(price.durationMinutes) || 0),
    };
    if (
      next.price !== row.price ||
      next.priceFrom !== row.priceFrom ||
      next.unit !== row.unit ||
      next.durationMinutes !== row.durationMinutes
    ) {
      changed = true;
    }
    return next;
  });

  if (!changed) return null;
  const payload = {
    meta: { updatedAt: new Date().toISOString() },
    items,
  };
  await writeServiceCardsAtomic(serviceCardsFile, payload);
  return payload;
}

async function loadAvailabilityPayload() {
  const data = await readAvailability(availabilityFile);
  const live = getLiveStatus(data.weekPlan);
  return { ...data, live };
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/app-version', async (_req, res) => {
  try {
    const version = await readAppVersion();
    const ready = await apkFileReady();
    res.set('Cache-Control', 'no-store');
    return res.json({
      ...version,
      apkReady: ready,
      downloadPath: '/api/app-apk',
    });
  } catch (error) {
    console.error('app_version_read_error', error);
    return res.status(404).json({ error: 'Версия приложения не настроена' });
  }
});

app.get('/api/app-apk', async (req, res) => {
  try {
    if (!(await requireMasterToken(req, res))) return;
    if (!(await apkFileReady())) {
      return res.status(404).json({ error: 'APK ещё не загружен на сервер' });
    }
    res.set('Cache-Control', 'no-store');
    return sendApkFile(res);
  } catch (error) {
    console.error('app_apk_download_error', error);
    return res.status(500).json({ error: 'Не удалось отдать APK' });
  }
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
  const release = acquireSseConnection(req, res, availabilityStreamClients);
  if (!release) return;

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  sendSseEvent(res, 'connected', { ok: true });

  try {
    const payload = await loadAvailabilityPayload();
    sendSseEvent(res, 'availability', payload);
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
    release();
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
});

app.put('/api/availability', availabilityWriteLimiter, async (req, res) => {
  try {
    if (!(await requireMasterToken(req, res))) return;

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

app.get('/api/prices', async (req, res) => {
  try {
    const data = await readPrices(pricesFile);
    res.set('Cache-Control', 'no-store');
    return res.json((await isMasterRequest(req)) ? managePrices(data) : publicPrices(data));
  } catch (error) {
    console.error('prices_read_error', error);
    return res.status(500).json({ error: 'Не удалось прочитать прайс' });
  }
});

app.put('/api/prices', pricesWriteLimiter, async (req, res) => {
  try {
    if (!(await requireMasterToken(req, res))) return;

    const checked = validatePricesPayload(req.body);
    if (!checked.ok) {
      return res.status(400).json({ error: checked.error });
    }
    if (!checked.data.items.length) {
      return res.status(400).json({ error: 'Нельзя сохранить пустой прайс' });
    }

    // Keep previous copy so an accidental wipe can be recovered.
    try {
      await fs.copyFile(pricesFile, `${pricesFile}.bak`);
    } catch {
      /* first write / missing file */
    }

    await writePricesAtomic(pricesFile, checked.data);
    const syncedServices = await syncServicesFromPrices(checked.data);
    const publicPayload = publicPrices(checked.data);
    broadcastPricingEvent('prices', publicPayload);
    if (syncedServices) {
      broadcastPricingEvent('services', publicServiceCards(syncedServices));
    }
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, ...managePrices(checked.data) });
  } catch (error) {
    console.error('prices_write_error', error);
    return res.status(500).json({ error: 'Не удалось сохранить прайс' });
  }
});

app.get('/api/pricing/stream', async (req, res) => {
  const release = acquireSseConnection(req, res, pricingStreamClients);
  if (!release) return;

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  sendSseEvent(res, 'connected', { ok: true });

  try {
    const [prices, services, calculator] = await Promise.all([
      readPrices(pricesFile),
      readServiceCards(serviceCardsFile),
      readCalculator(calculatorFile),
    ]);
    sendSseEvent(res, 'prices', publicPrices(prices));
    sendSseEvent(res, 'services', publicServiceCards(services));
    sendSseEvent(res, 'calculator', publicCalculator(calculator));
  } catch (error) {
    console.error('pricing_stream_seed_error', error);
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
    release();
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
});

app.get('/api/calculator', async (_req, res) => {
  try {
    const data = await readCalculator(calculatorFile);
    res.set('Cache-Control', 'no-store');
    return res.json(publicCalculator(data));
  } catch (error) {
    console.error('calculator_read_error', error);
    return res.status(500).json({ error: 'Не удалось прочитать калькулятор' });
  }
});

app.put('/api/calculator', pricesWriteLimiter, async (req, res) => {
  try {
    if (!(await requireMasterToken(req, res))) return;

    const checked = validateCalculatorPayload(req.body);
    if (!checked.ok) {
      return res.status(400).json({ error: checked.error });
    }

    await writeCalculatorAtomic(calculatorFile, checked.data);
    const publicPayload = publicCalculator(checked.data);
    broadcastPricingEvent('calculator', publicPayload);
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, ...publicPayload });
  } catch (error) {
    console.error('calculator_write_error', error);
    return res.status(500).json({ error: 'Не удалось сохранить калькулятор' });
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
    if (!(await requireMasterToken(req, res))) return;

    const checked = validateServiceCardsPayload(req.body);
    if (!checked.ok) {
      return res.status(400).json({ error: checked.error });
    }

    await writeServiceCardsAtomic(serviceCardsFile, checked.data);
    const syncedPrices = await syncPricesFromServices(checked.data);
    const publicPayload = publicServiceCards(checked.data);
    broadcastPricingEvent('services', publicPayload);
    if (syncedPrices) {
      broadcastPricingEvent('prices', publicPrices(syncedPrices));
    }
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, ...publicPayload });
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

app.post('/api/works', worksWriteLimiter, async (req, res) => {
  // Auth first: never let multer write temp files for strangers.
  if (!(await requireMasterToken(req, res))) return;

  upload.single('photo')(req, res, async (err) => {
    try {
      if (err) {
        const message = err.message?.includes('File too large')
          ? 'Файл больше 4 МБ'
          : err.message || 'Ошибка загрузки';
        return res.status(400).json({ error: message });
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
      await broadcastWorks();
      return res.status(201).json({ ok: true, item: result.item });
    } catch (error) {
      console.error('works_upload_error', error);
      await cleanupTemp(req.file);
      return res.status(500).json({ error: 'Не удалось сохранить фото' });
    }
  });
});

app.get('/api/works/stream', async (req, res) => {
  const release = acquireSseConnection(req, res, worksStreamClients);
  if (!release) return;

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  try {
    const data = await readWorks(worksFile);
    sendSseEvent(res, 'works', {
      items: data.items.map(publicWork),
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error('works_stream_bootstrap_error', error);
  }

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
      release();
    }
  }, 25000);

  const cleanup = () => {
    clearInterval(heartbeat);
    release();
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
});

app.delete('/api/works/:id', worksWriteLimiter, async (req, res) => {
  try {
    if (!(await requireMasterToken(req, res))) return;
    const uploadsDir = await ensureWorksDirs(dataDir);
    const result = await deleteWork(worksFile, uploadsDir, sanitize(req.params.id, 40));
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    await broadcastWorks();
    return res.json({ ok: true });
  } catch (error) {
    console.error('works_delete_error', error);
    return res.status(500).json({ error: 'Не удалось удалить фото' });
  }
});

app.patch('/api/works/:id', worksWriteLimiter, async (req, res) => {
  try {
    if (!(await requireMasterToken(req, res))) return;
    const result = await updateWorkCaption(
      worksFile,
      sanitize(req.params.id, 40),
      req.body?.caption
    );
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    await broadcastWorks();
    return res.json({ ok: true, item: result.item });
  } catch (error) {
    console.error('works_caption_error', error);
    return res.status(500).json({ error: 'Не удалось сохранить название' });
  }
});

app.post('/api/works/:id/rate', rateLimiter, async (req, res) => {
  try {
    const result = await rateWork(worksFile, sanitize(req.params.id, 40), req.body?.stars);
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    await broadcastWorks();
    return res.json({ ok: true, item: result.item });
  } catch (error) {
    console.error('works_rate_error', error);
    return res.status(500).json({ error: 'Не удалось сохранить оценку' });
  }
});

app.post('/api/device/sync', availabilityWriteLimiter, async (req, res) => {
  try {
    if (!(await requireMasterToken(req, res, { requireDevice: true }))) return;
    const access = req.access || (await loadAccess());
    const notice = publicOwnerMessage(await readOwnerMessage(ownerMessageFile));
    return res.json({
      ok: true,
      masterToken: access.masterToken,
      tokenVersion: access.tokenVersion,
      device: req.device,
      access: publicAccessState(access),
      notice,
    });
  } catch (error) {
    console.error('device_sync_error', error);
    return res.status(500).json({ error: 'Не удалось синхронизировать устройство' });
  }
});

const panel = express.Router();

panel.get('/', async (_req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  try {
    const html = (await fs.readFile(adminHtmlFile, 'utf8')).replaceAll('__PANEL__', adminPath);
    return res.type('html').send(html);
  } catch (error) {
    console.error('admin_html_error', error);
    return res.status(500).type('text').send('Admin UI missing');
  }
});

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler(_req, res) {
    res.status(429).type('text').send('Слишком много попыток входа. Попробуйте позже.');
  },
});

panel.get('/api/auth-config', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!passwordLoginEnabled()) return res.json({ ok: true, f: 0 });
  const totp = await totpStatus(adminTotpFile);
  return res.json({ ok: true, f: totp === 'active' ? 2 : 1 });
});

panel.post('/api/login', adminLoginLimiter, async (req, res) => {
  if (!passwordLoginEnabled()) {
    return res.status(404).json({ error: 'Нет' });
  }
  const secret = String(req.body?.k ?? req.body?.password ?? '');
  if (!pinsMatch(secret, adminPassword)) {
    return res.status(401).json({ error: 'Нет' });
  }
  const state = await loadOrCreateTotp(adminTotpFile);
  const secure = cookieSecure(req);
  if (!state.confirmed) {
    const { qr } = await enrollmentQr(state.secret);
    const token = createAdminSessionToken(adminSessionSecret, { email: 'panel@local', method: 'totp-setup' });
    res.setHeader('Set-Cookie', adminSessionCookie(token, { secure, path: adminPath }));
    return res.json({ ok: true, q: qr });
  }
  const code = req.body?.n ?? req.body?.code;
  if (!verifyTotpCode(state.secret, code)) {
    return res.status(401).json({ error: 'Нет' });
  }
  const token = createAdminSessionToken(adminSessionSecret, { email: 'panel@local', method: 'password' });
  res.setHeader('Set-Cookie', adminSessionCookie(token, { secure, path: adminPath }));
  return res.json({ ok: true });
});

panel.post('/api/totp/confirm', adminLoginLimiter, async (req, res) => {
  const session = readAdminSession(req, adminSessionSecret);
  if (!session || session.method !== 'totp-setup') {
    return res.status(401).json({ error: 'Нет' });
  }
  const ok = await confirmTotp(adminTotpFile, req.body?.n ?? req.body?.code);
  if (!ok) {
    return res.status(401).json({ error: 'Нет' });
  }
  const token = createAdminSessionToken(adminSessionSecret, { email: 'panel@local', method: 'password' });
  res.setHeader('Set-Cookie', adminSessionCookie(token, { secure: cookieSecure(req), path: adminPath }));
  return res.json({ ok: true });
});

panel.get('/api/google/start', adminLoginLimiter, (req, res) => {
  if (!googleAdminConfigured()) {
    return res.redirect(`${adminPath}?error=unconfigured`);
  }
  const tx = createOAuthTransaction(adminSessionSecret);
  const origin = adminPublicOrigin(req, adminPublicOriginEnv);
  const url = googleAuthorizeUrl({
    clientId: googleClientId,
    redirectUri: googleRedirectUri(origin, adminPath),
    state: tx.state,
    verifier: tx.verifier,
  });
  res.setHeader('Set-Cookie', oauthStateCookie(tx.token, { secure: cookieSecure(req), path: adminPath }));
  return res.redirect(url);
});

panel.get('/api/google/callback', adminLoginLimiter, async (req, res) => {
  const secure = cookieSecure(req);
  const fail = (code) => {
    res.setHeader('Set-Cookie', clearOAuthStateCookie({ secure, path: adminPath }));
    return res.redirect(`${adminPath}?error=${code}`);
  };
  if (!googleAdminConfigured()) return fail('unconfigured');
  if (req.query.error) return fail('denied');
  const code = String(req.query.code || '');
  const state = String(req.query.state || '');
  if (!code || code.length > 2048 || !state || state.length > 200) return fail('invalid');
  const tx = readOAuthTransaction(parseCookies(req.headers.cookie)[OAUTH_COOKIE], adminSessionSecret);
  if (!tx) return fail('invalid');
  const stateBuf = Buffer.from(state);
  const expectedBuf = Buffer.from(tx.state);
  if (stateBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(stateBuf, expectedBuf)) {
    return fail('invalid');
  }
  try {
    const origin = adminPublicOrigin(req, adminPublicOriginEnv);
    const idToken = await exchangeGoogleCode({
      code,
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      redirectUri: googleRedirectUri(origin, adminPath),
      verifier: tx.verifier,
    });
    const profile = await verifyGoogleIdToken(idToken, googleClientId);
    if (!profile) return fail('invalid');
    if (!emailAllowed(profile.email, adminEmails)) return fail('not_allowed');
    const token = createAdminSessionToken(adminSessionSecret, { email: profile.email });
    res.setHeader('Set-Cookie', [
      adminSessionCookie(token, { secure, path: adminPath }),
      clearOAuthStateCookie({ secure, path: adminPath }),
    ]);
    console.log('admin_login', profile.email);
    return res.redirect(adminPath);
  } catch (error) {
    console.error('admin_google_callback_error', error?.detail || error?.message || 'failed');
    return fail('invalid');
  }
});

panel.post('/api/logout', (req, res) => {
  const secure = cookieSecure(req);
  res.setHeader('Set-Cookie', [
    clearAdminSessionCookie({ secure, path: adminPath }),
    clearOAuthStateCookie({ secure, path: adminPath }),
  ]);
  return res.json({ ok: true });
});

panel.get('/api/overview', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const access = await loadAccess();
  const devices = await listDevices(devicesFile);
  const notice = publicOwnerMessage(await readOwnerMessage(ownerMessageFile));
  return res.json({
    ok: true,
    adminEmail: req.adminEmail,
    access: publicAccessState(access),
    devices,
    notice,
  });
});

panel.put('/api/notice', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const notice = await setOwnerMessage(ownerMessageFile, {
    text: req.body?.text,
    tone: req.body?.tone,
  });
  return res.json({ ok: true, notice: publicOwnerMessage(notice) });
});

panel.delete('/api/notice', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const notice = await clearOwnerMessage(ownerMessageFile);
  return res.json({ ok: true, notice: publicOwnerMessage(notice) });
});

panel.post('/api/token/rotate', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const access = await rotateMasterToken(accessFile, masterTokenEnv, 24);
  return res.json({
    ok: true,
    masterToken: access.masterToken,
    access: publicAccessState(access),
  });
});

panel.patch('/api/devices/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'label')) {
    patch.label = req.body.label;
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'blocked')) {
    patch.blocked = req.body.blocked;
  }
  const result = await updateDevice(devicesFile, req.params.id, patch);
  if (!result.ok) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json({ ok: true, item: result.item });
});

panel.delete('/api/devices/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const result = await removeDevice(devicesFile, req.params.id);
  if (!result.ok) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json({ ok: true });
});

panel.get('/api/analytics', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const period = parsePeriod(req.query || {});
  if (!period.ok) return res.status(400).json({ error: period.error });
  try {
    const events = await readAnalyticsEvents(analyticsDir, period.from, period.to);
    const summary = summarizeAnalytics(events);
    return res.json({
      ok: true,
      from: period.from,
      to: period.to,
      summary,
    });
  } catch (error) {
    console.error('analytics_summary_error', error);
    return res.status(500).json({ error: 'Не удалось загрузить статистику' });
  }
});

panel.get('/api/analytics/export', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const period = parsePeriod(req.query || {});
  if (!period.ok) return res.status(400).json({ error: period.error });
  try {
    const events = await readAnalyticsEvents(analyticsDir, period.from, period.to);
    const summary = summarizeAnalytics(events);
    const buffer = await buildAnalyticsWorkbook(summary, events, {
      from: period.from,
      to: period.to,
    });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="analytics-${stamp}.xlsx"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(buffer);
  } catch (error) {
    console.error('analytics_export_error', error);
    return res.status(500).json({ error: 'Не удалось выгрузить Excel' });
  }
});

if (adminPath) app.use(adminPath, panel);

app.post('/api/track', trackLimiter, async (req, res) => {
  try {
    const normalized = normalizeEventInput(req.body || {}, {
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
    });
    if (!normalized.ok) {
      return res.status(400).json({ error: normalized.error });
    }
    await appendAnalyticsEvent(analyticsDir, normalized.event);
    return res.status(204).end();
  } catch (error) {
    console.error('track_error', error);
    return res.status(500).json({ error: 'Не удалось записать' });
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

  return sendApkFile(res, { asJsonError: false });
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
await ensureAccess(accessFile, masterTokenEnv)
  .then((access) => {
    if (access.masterToken) console.log('Master access token ready');
  })
  .catch((error) => {
    console.error('ensure_access_error', error);
  });
await ensureDemoWorks(worksFile, dataDir, distDir)
  .then((result) => {
    if (result?.changed) console.log('Demo gallery photos restored into works.json');
  })
  .catch((error) => {
    console.error('ensure_demo_works_error', error);
  });

adminSessionSecret = await ensureAdminSessionSecret(
  adminSessionSecretFile,
  process.env.ADMIN_SESSION_SECRET
);

app.listen(port, () => {
  console.log(`Svetlana cleaning server listening on http://localhost:${port}`);
  if (!masterTokenEnv) {
    console.warn('MASTER_TOKEN is not set — protected write routes will return 503 until access.json has a token');
  }
  if (!adminPath) {
    console.warn('ADMIN_PATH is missing or not allowed — panel is disabled');
  } else if (googleAdminConfigured()) {
    console.log(`Google panel login ready for ${adminEmails.size} account(s)`);
  } else if (adminPassword) {
    console.log('Panel login uses the existing password until Google is configured');
  } else {
    console.warn('Panel has no login — set ADMIN_PASSWORD or Google OAuth variables');
  }
  if (!apkDownloadPin) {
    console.warn('APK_DOWNLOAD_PIN is not set — /app-download will return 503');
  }
});
