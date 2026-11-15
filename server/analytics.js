import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs-hardened';
import opentype from 'opentype.js';
import sharp from 'sharp';

const ANALYTICS_DIR = path.dirname(fileURLToPath(import.meta.url));
const DONUT_FONT_REGULAR = path.join(ANALYTICS_DIR, 'assets', 'fonts', 'DejaVuSans.ttf');
const DONUT_FONT_BOLD = path.join(ANALYTICS_DIR, 'assets', 'fonts', 'DejaVuSans-Bold.ttf');

let donutFontsCache = null;

function loadDonutFonts() {
  if (donutFontsCache) return donutFontsCache;
  donutFontsCache = {
    regular: opentype.loadSync(DONUT_FONT_REGULAR),
    bold: opentype.loadSync(DONUT_FONT_BOLD),
  };
  return donutFontsCache;
}

/** Convert text to SVG path so sharp/Alpine never needs system Cyrillic fonts. */
function textPath(text, { x, y, size = 14, bold = false, anchor = 'start', fill = '#134e4a' }) {
  const fonts = loadDonutFonts();
  const font = bold ? fonts.bold : fonts.regular;
  const width = font.getAdvanceWidth(text, size);
  let startX = x;
  if (anchor === 'middle') startX = x - width / 2;
  if (anchor === 'end') startX = x - width;
  const pathData = font.getPath(text, startX, y, size).toPathData(2);
  return `<path d="${pathData}" fill="${fill}"/>`;
}

export const EVENT_TYPES = new Set([
  'page_view',
  'schedule_dwell',
  'price_dwell',
  'reviews_dwell',
  'photo_open',
  'call_click',
]);

export const DEVICES = new Set(['phone', 'tablet', 'desktop']);
export const SOURCES = new Set(['avito', 'yandex', 'google', 'vk', 'direct', 'other']);

const MIN_DWELL_MS = 3000;
const MAX_DWELL_MS = 10 * 60 * 1000;

const EVENT_LABELS = {
  page_view: 'Открыл сайт',
  schedule_dwell: 'Завис на графике',
  price_dwell: 'Завис на ценах',
  reviews_dwell: 'Завис на отзывах',
  photo_open: 'Открыл фото',
  call_click: 'Нажал Позвонить',
};

const DWELL_SECTIONS = {
  schedule_dwell: 'schedule',
  price_dwell: 'prices',
  reviews_dwell: 'reviews',
};

const DEVICE_LABELS = {
  phone: 'Телефон',
  tablet: 'Планшет',
  desktop: 'Компьютер',
};

const SOURCE_LABELS = {
  avito: 'Авито',
  yandex: 'Яндекс',
  google: 'Google',
  vk: 'VK',
  direct: 'Прямой заход',
  other: 'Другое',
};

const WEEKDAY_RU = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const WEEKDAY_FULL = [
  'Воскресенье',
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
];
/** Monday-first order of JS weekday indexes (0=Sun). */
const WEEKDAY_MON_FIRST = [1, 2, 3, 4, 5, 6, 0];
const HEAT_HOURS = Array.from({ length: 15 }, (_, i) => i + 8); // 08..22

function peakWindow(hoursArr) {
  const total = hoursArr.reduce((a, b) => a + b, 0);
  if (!total) {
    return { visits: 0, calls: 0, peakHour: null, fromHour: null, toHour: null, windowLabel: '—' };
  }
  let peakHour = 0;
  for (let h = 1; h < hoursArr.length; h += 1) {
    if (hoursArr[h] > hoursArr[peakHour]) peakHour = h;
  }
  let from = peakHour;
  let to = peakHour;
  let covered = hoursArr[peakHour];
  const target = total * 0.7;
  while (covered < target && (from > 0 || to < hoursArr.length - 1)) {
    const left = from > 0 ? hoursArr[from - 1] : -1;
    const right = to < hoursArr.length - 1 ? hoursArr[to + 1] : -1;
    if (right >= left) {
      to += 1;
      covered += hoursArr[to];
    } else {
      from -= 1;
      covered += hoursArr[from];
    }
  }
  const pad = (h) => `${String(h).padStart(2, '0')}:00`;
  return {
    visits: total,
    peakHour,
    fromHour: from,
    toHour: to,
    windowLabel: from === to ? pad(from) : `${pad(from)}–${pad(to + 1)}`,
  };
}

function buildWhenPhrase(byHour) {
  const slice = HEAT_HOURS.map((h) => ({ h, count: byHour[h] || 0 }));
  const total = slice.reduce((a, b) => a + b.count, 0);
  if (!total) return 'Пока мало данных по часам.';
  const ranked = [...slice].sort((a, b) => b.count - a.count);
  const top = ranked.filter((x) => x.count > 0).slice(0, 3).map((x) => x.h);
  if (!top.length) return 'Пока мало данных по часам.';
  const minH = Math.min(...top);
  const maxH = Math.max(...top);
  if (minH === maxH) {
    return `Чаще всего заходят около ${String(minH).padStart(2, '0')}:00 (Москва).`;
  }
  return `Чаще всего заходят с ${String(minH).padStart(2, '0')}:00 до ${String(maxH + 1).padStart(2, '0')}:00 (Москва).`;
}

function heatColor(value, max) {
  if (!max || value <= 0) return 'FFECFDF5';
  const t = Math.min(1, value / max);
  // light teal -> strong teal
  const r = Math.round(236 - t * (236 - 15));
  const g = Math.round(253 - t * (253 - 118));
  const b = Math.round(245 - t * (245 - 110));
  const hex = (n) => n.toString(16).padStart(2, '0').toUpperCase();
  return `FF${hex(r)}${hex(g)}${hex(b)}`;
}

function sanitizeShort(value, max = 64) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

export function hashIp(ip) {
  const raw = sanitizeShort(ip || 'unknown', 128) || 'unknown';
  return crypto.createHash('sha256').update(`sv-analytics:${raw}`).digest('hex').slice(0, 16);
}

export function detectDeviceFromUa(userAgent = '', width = 0) {
  const ua = String(userAgent || '').toLowerCase();
  const w = Number(width) || 0;
  if (/ipad|tablet|kindle|silk|(android(?!.*mobile))/.test(ua) || (w >= 600 && w <= 1024 && /mobile|android/.test(ua))) {
    return 'tablet';
  }
  if (/mobi|iphone|ipod|android.*mobile|windows phone/.test(ua) || (w > 0 && w < 600)) {
    return 'phone';
  }
  return 'desktop';
}

export function detectSource({ referrer = '', utmSource = '', utmMedium = '' } = {}) {
  const utm = `${utmSource} ${utmMedium}`.toLowerCase();
  const ref = String(referrer || '').toLowerCase();
  if (/avito/.test(utm) || /avito\.ru/.test(ref)) return 'avito';
  if (/yandex|ya\.ru/.test(utm) || /yandex\.|ya\.ru/.test(ref)) return 'yandex';
  if (/google/.test(utm) || /google\./.test(ref)) return 'google';
  if (/\bvk\b|vkontakte/.test(utm) || /(?:^|\/\/|\.)vk\.(?:com|ru|me)\b/.test(ref)) return 'vk';
  if (!ref.trim()) return 'direct';
  return 'other';
}

export function normalizeEventInput(body = {}, { ip = '', userAgent = '' } = {}) {
  const type = sanitizeShort(body.type || body.event, 32);
  if (!EVENT_TYPES.has(type)) {
    return { ok: false, error: 'Неизвестное событие' };
  }

  let device = sanitizeShort(body.device, 16).toLowerCase();
  if (!DEVICES.has(device)) {
    device = detectDeviceFromUa(userAgent, body.width);
  }

  let source = sanitizeShort(body.source, 16).toLowerCase();
  if (!SOURCES.has(source)) {
    source = detectSource({
      referrer: body.referrer,
      utmSource: body.utmSource || body.utm_source,
      utmMedium: body.utmMedium || body.utm_medium,
    });
  }

  let visitorId = sanitizeShort(body.visitorId || body.visitor_id, 64);
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(visitorId)) {
    visitorId = crypto.randomBytes(12).toString('hex');
  }

  const event = {
    at: new Date().toISOString(),
    type,
    device,
    source,
    visitorId,
    ipHash: hashIp(ip),
    path: sanitizeShort(body.path || '/', 120) || '/',
  };

  if (DWELL_SECTIONS[type]) {
    let ms = Number(body.ms ?? body.duration ?? 0);
    if (!Number.isFinite(ms)) ms = 0;
    ms = Math.round(ms);
    if (ms < MIN_DWELL_MS) {
      return { ok: false, error: 'Слишком коротко' };
    }
    event.ms = Math.min(MAX_DWELL_MS, ms);
  }

  return { ok: true, event };
}

function monthKeyFromIso(iso) {
  const parts = moscowParts(iso);
  return `${parts.year}-${parts.month}`;
}

function monthFile(dir, monthKey) {
  return path.join(dir, `${monthKey}.jsonl`);
}

function listMonthKeysBetween(fromIso, toIso) {
  const start = new Date(fromIso);
  const end = new Date(toIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
  const keys = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= last) {
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    keys.push(`${y}-${m}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  // Also include Moscow month keys in case of boundary drift
  const fromM = monthKeyFromIso(fromIso);
  const toM = monthKeyFromIso(toIso);
  if (!keys.includes(fromM)) keys.unshift(fromM);
  if (!keys.includes(toM)) keys.push(toM);
  return [...new Set(keys)];
}

export async function appendAnalyticsEvent(dir, event) {
  const month = monthKeyFromIso(event.at);
  const file = monthFile(dir, month);
  await fsPromises.mkdir(dir, { recursive: true });
  await fsPromises.appendFile(file, `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

async function readMonthFile(file) {
  try {
    const raw = await fsPromises.readFile(file, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

export function moscowParts(iso) {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekdayEn = get('weekday');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: Number(get('hour')),
    weekday: weekdayMap[weekdayEn] ?? date.getUTCDay(),
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

export function parsePeriod(query = {}) {
  const now = new Date();
  const preset = sanitizeShort(query.period || query.range, 24).toLowerCase();
  let from;
  let to = now;

  if (query.from && query.to) {
    from = new Date(query.from);
    to = new Date(query.to);
  } else if (preset === 'today') {
    from = startOfMoscowDay(now);
  } else if (preset === '7d' || preset === 'week') {
    from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (preset === '30d' || preset === 'month') {
    from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else if (preset === 'halfyear' || preset === '180d') {
    from = new Date(now.getTime() - 182 * 24 * 60 * 60 * 1000);
  } else if (preset === 'year') {
    from = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  } else {
    from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return { ok: false, error: 'Неверный период' };
  }

  // Cap range to 400 days to keep exports bounded
  if (to.getTime() - from.getTime() > 400 * 24 * 60 * 60 * 1000) {
    return { ok: false, error: 'Период слишком большой' };
  }

  return {
    ok: true,
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

function startOfMoscowDay(date) {
  const parts = moscowParts(date.toISOString());
  // Approximate: construct Moscow midnight as UTC+3
  return new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00+03:00`);
}

export async function readAnalyticsEvents(dir, fromIso, toIso) {
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  const keys = listMonthKeysBetween(fromIso, toIso);
  const all = [];
  for (const key of keys) {
    const rows = await readMonthFile(monthFile(dir, key));
    for (const row of rows) {
      const t = new Date(row.at).getTime();
      if (!Number.isFinite(t) || t < fromMs || t > toMs) continue;
      all.push(row);
    }
  }
  all.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return all;
}

function emptyCounter(keys) {
  const out = {};
  for (const key of keys) out[key] = 0;
  return out;
}

function emptyAttention() {
  return {
    schedule: { count: 0, totalMs: 0, totalSec: 0, avgSec: 0 },
    prices: { count: 0, totalMs: 0, totalSec: 0, avgSec: 0 },
    reviews: { count: 0, totalMs: 0, totalSec: 0, avgSec: 0 },
    top: null,
    topLabel: '',
  };
}

function finalizeAttentionBucket(bucket) {
  bucket.totalSec = Math.round(bucket.totalMs / 1000);
  bucket.avgSec = bucket.count ? Math.round(bucket.totalMs / bucket.count / 1000) : 0;
  return bucket;
}

export function summarizeAnalytics(events) {
  const devices = emptyCounter([...DEVICES]);
  const sources = emptyCounter([...SOURCES]);
  const byType = emptyCounter([...EVENT_TYPES]);
  const byHour = Array.from({ length: 24 }, () => 0);
  const byWeekday = Array.from({ length: 7 }, () => 0);
  const heatVisits = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const heatCalls = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const weekdayHourVisits = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const weekdayCalls = Array.from({ length: 7 }, () => 0);
  const byDayMap = new Map();
  const uniqueVisitors = new Set();
  const callers = new Set();
  const attention = emptyAttention();

  for (const event of events) {
    const type = EVENT_TYPES.has(event.type) ? event.type : null;
    const device = DEVICES.has(event.device) ? event.device : 'desktop';
    const source = SOURCES.has(event.source) ? event.source : 'other';
    if (type) byType[type] += 1;
    devices[device] += 1;
    sources[source] += 1;
    if (event.visitorId) uniqueVisitors.add(event.visitorId);

    const parts = moscowParts(event.at || new Date().toISOString());
    if (Number.isFinite(parts.hour) && parts.hour >= 0 && parts.hour < 24) {
      byHour[parts.hour] += 1;
    }
    if (Number.isFinite(parts.weekday) && parts.weekday >= 0 && parts.weekday < 7) {
      byWeekday[parts.weekday] += 1;
    }
    if (type === 'page_view' && Number.isFinite(parts.weekday) && Number.isFinite(parts.hour)) {
      heatVisits[parts.weekday][parts.hour] += 1;
      weekdayHourVisits[parts.weekday][parts.hour] += 1;
    }
    if (type === 'call_click' && Number.isFinite(parts.weekday) && Number.isFinite(parts.hour)) {
      heatCalls[parts.weekday][parts.hour] += 1;
      weekdayCalls[parts.weekday] += 1;
    }

    if (!byDayMap.has(parts.dateKey)) {
      byDayMap.set(parts.dateKey, {
        date: parts.dateKey,
        visits: 0,
        unique: new Set(),
        calls: 0,
        reviews: 0,
        schedule: 0,
        prices: 0,
        photos: 0,
        scheduleSec: 0,
        pricesSec: 0,
        reviewsSec: 0,
        avito: 0,
        yandex: 0,
        google: 0,
        vk: 0,
        direct: 0,
        other: 0,
        phone: 0,
        tablet: 0,
        desktop: 0,
        total: 0,
      });
    }
    const day = byDayMap.get(parts.dateKey);
    day.total += 1;
    if (device === 'phone') day.phone += 1;
    else if (device === 'tablet') day.tablet += 1;
    else day.desktop += 1;
    if (source === 'avito') day.avito += 1;
    else if (source === 'yandex') day.yandex += 1;
    else if (source === 'google') day.google += 1;
    else if (source === 'vk') day.vk += 1;
    else if (source === 'direct') day.direct += 1;
    else day.other += 1;
    if (type === 'page_view') {
      day.visits += 1;
      if (event.visitorId) day.unique.add(event.visitorId);
    }
    if (type === 'call_click') {
      day.calls += 1;
      if (event.visitorId) callers.add(event.visitorId);
    }
    if (type === 'photo_open') day.photos += 1;

    const dwellKey = type ? DWELL_SECTIONS[type] : null;
    if (dwellKey) {
      const ms = Math.max(0, Number(event.ms) || 0);
      if (ms >= MIN_DWELL_MS) {
        attention[dwellKey].count += 1;
        attention[dwellKey].totalMs += ms;
        if (dwellKey === 'schedule') {
          day.schedule += 1;
          day.scheduleSec += Math.round(ms / 1000);
        } else if (dwellKey === 'prices') {
          day.prices += 1;
          day.pricesSec += Math.round(ms / 1000);
        } else if (dwellKey === 'reviews') {
          day.reviews += 1;
          day.reviewsSec += Math.round(ms / 1000);
        }
      }
    }
  }

  finalizeAttentionBucket(attention.schedule);
  finalizeAttentionBucket(attention.prices);
  finalizeAttentionBucket(attention.reviews);
  const ranked = [
    { key: 'schedule', label: 'график', sec: attention.schedule.totalSec },
    { key: 'prices', label: 'цены', sec: attention.prices.totalSec },
    { key: 'reviews', label: 'отзывы', sec: attention.reviews.totalSec },
  ].sort((a, b) => b.sec - a.sec);
  attention.top = ranked[0].sec > 0 ? ranked[0].key : null;
  attention.topLabel = ranked[0].sec > 0 ? ranked[0].label : '';

  const visits = byType.page_view || 0;
  const calls = byType.call_click || 0;
  const conversion = visits > 0 ? Math.round((calls / visits) * 1000) / 10 : 0;
  const deviceTotal = Object.values(devices).reduce((a, b) => a + b, 0) || 1;

  const byDay = [...byDayMap.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => ({
      date: day.date,
      visits: day.visits,
      unique: day.unique.size,
      calls: day.calls,
      reviews: day.reviews,
      schedule: day.schedule,
      prices: day.prices,
      photos: day.photos,
      scheduleSec: day.scheduleSec,
      pricesSec: day.pricesSec,
      reviewsSec: day.reviewsSec,
      avito: day.avito,
      yandex: day.yandex,
      google: day.google,
      vk: day.vk,
      direct: day.direct,
      other: day.other,
      phone: day.phone,
      tablet: day.tablet,
      desktop: day.desktop,
      phoneShare: day.total ? Math.round((day.phone / day.total) * 1000) / 10 : 0,
      tabletShare: day.total ? Math.round((day.tablet / day.total) * 1000) / 10 : 0,
      desktopShare: day.total ? Math.round((day.desktop / day.total) * 1000) / 10 : 0,
    }));

  const recent = [...events]
    .reverse()
    .slice(0, 40)
    .map((event) => {
      const base = EVENT_LABELS[event.type] || event.type;
      const ms = Number(event.ms) || 0;
      const label = ms > 0 ? `${base} · ${Math.round(ms / 1000)} сек` : base;
      return {
        at: event.at,
        type: event.type,
        ms,
        label,
        device: event.device,
        deviceLabel: DEVICE_LABELS[event.device] || event.device,
        source: event.source,
        sourceLabel: SOURCE_LABELS[event.source] || event.source,
      };
    });

  const weekdayReport = WEEKDAY_MON_FIRST.map((weekday) => {
    const win = peakWindow(weekdayHourVisits[weekday]);
    return {
      weekday,
      day: WEEKDAY_RU[weekday],
      dayFull: WEEKDAY_FULL[weekday],
      visits: win.visits,
      calls: weekdayCalls[weekday] || 0,
      peakHour: win.peakHour,
      fromHour: win.fromHour,
      toHour: win.toHour,
      windowLabel: win.windowLabel,
    };
  });

  let heatMax = 0;
  for (const weekday of WEEKDAY_MON_FIRST) {
    for (const hour of HEAT_HOURS) {
      heatMax = Math.max(heatMax, heatVisits[weekday][hour] || 0);
    }
  }

  const heatmap = {
    hours: HEAT_HOURS,
    days: WEEKDAY_MON_FIRST.map((weekday) => ({
      weekday,
      label: WEEKDAY_RU[weekday],
      labelFull: WEEKDAY_FULL[weekday],
      cells: HEAT_HOURS.map((hour) => heatVisits[weekday][hour] || 0),
    })),
    max: heatMax,
  };

  return {
    visits,
    unique: uniqueVisitors.size,
    calls,
    conversion,
    attention,
    scheduleViews: attention.schedule.count,
    priceViews: attention.prices.count,
    reviewViews: attention.reviews.count,
    scheduleSec: attention.schedule.totalSec,
    priceSec: attention.prices.totalSec,
    reviewSec: attention.reviews.totalSec,
    scheduleAvgSec: attention.schedule.avgSec,
    priceAvgSec: attention.prices.avgSec,
    reviewAvgSec: attention.reviews.avgSec,
    photoOpens: byType.photo_open || 0,
    callers: callers.size,
    devices,
    deviceShare: {
      phone: Math.round((devices.phone / deviceTotal) * 1000) / 10,
      tablet: Math.round((devices.tablet / deviceTotal) * 1000) / 10,
      desktop: Math.round((devices.desktop / deviceTotal) * 1000) / 10,
    },
    sources,
    byHour,
    byWeekday: byWeekday.map((count, index) => ({
      day: WEEKDAY_RU[index],
      count,
    })),
    weekdayReport,
    heatmap,
    whenPhrase: buildWhenPhrase(byHour),
    byDay,
    byType,
    recent,
    labels: { events: EVENT_LABELS, devices: DEVICE_LABELS, sources: SOURCE_LABELS },
  };
}

const HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF0F766E' },
};
const DATE_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFCCFBF1' },
};
const LABEL_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFD1FAE5' },
};
const ZEBRA_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF0FDFA' },
};

function formatMoscowDateTime(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return String(iso);
  }
}

function formatMoscowDate(isoOrKey) {
  if (!isoOrKey) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrKey)) {
    const [y, m, d] = isoOrKey.split('-');
    return `${d}.${m}.${y}`;
  }
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(isoOrKey));
  } catch {
    return String(isoOrKey);
  }
}

function paintHeaderRow(row) {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF134E4A' } },
      left: { style: 'thin', color: { argb: 'FF134E4A' } },
      bottom: { style: 'thin', color: { argb: 'FF134E4A' } },
      right: { style: 'thin', color: { argb: 'FF134E4A' } },
    };
  });
}

function paintBodyRow(row, { dateCol = 0, zebra = false } = {}) {
  row.eachCell((cell, colNumber) => {
    cell.alignment = { vertical: 'middle', horizontal: colNumber === dateCol ? 'left' : 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF99F6E4' } },
      left: { style: 'thin', color: { argb: 'FF99F6E4' } },
      bottom: { style: 'thin', color: { argb: 'FF99F6E4' } },
      right: { style: 'thin', color: { argb: 'FF99F6E4' } },
    };
    if (colNumber === dateCol) {
      cell.fill = DATE_FILL;
      cell.font = { bold: true, color: { argb: 'FF134E4A' } };
    } else if (zebra) {
      cell.fill = ZEBRA_FILL;
    }
  });
}

export async function buildAnalyticsWorkbook(summary, events, { from, to } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Svetlana analytics';
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet('Сводка', {
    views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }],
  });
  const summaryHeaders = [
    'Период с',
    'Период по',
    'Визиты',
    'Уникальные',
    'Звонки',
    'Конверсия %',
    'Больше внимания',
    'График, раз',
    'График, сек',
    'График, ср. сек',
    'Цены, раз',
    'Цены, сек',
    'Цены, ср. сек',
    'Отзывы, раз',
    'Отзывы, сек',
    'Отзывы, ср. сек',
    'Открывали фото',
    'Авито',
    'Яндекс',
    'Google',
    'VK',
    'Прямой заход',
    'Другое',
    'Телефон %',
    'Планшет %',
    'Компьютер %',
  ];
  const summaryWidths = {
    'Период с': 20,
    'Период по': 20,
    Визиты: 12,
    Уникальные: 14,
    Звонки: 12,
    'Конверсия %': 14,
    'Больше внимания': 16,
    'График, раз': 13,
    'График, сек': 13,
    'График, ср. сек': 15,
    'Цены, раз': 12,
    'Цены, сек': 12,
    'Цены, ср. сек': 14,
    'Отзывы, раз': 13,
    'Отзывы, сек': 13,
    'Отзывы, ср. сек': 15,
    'Открывали фото': 18,
    Авито: 12,
    Яндекс: 12,
    Google: 12,
    VK: 10,
    'Прямой заход': 16,
    Другое: 12,
    'Телефон %': 13,
    'Планшет %': 13,
    'Компьютер %': 14,
  };
  summarySheet.addRow(summaryHeaders);
  summarySheet.columns = summaryHeaders.map((header) => ({
    header,
    width: summaryWidths[header] || Math.max(14, header.length + 2),
  }));
  paintHeaderRow(summarySheet.getRow(1));
  summarySheet.getRow(1).height = 24;
  const summaryValues = [
    formatMoscowDateTime(from),
    formatMoscowDateTime(to),
    summary.visits || 0,
    summary.unique || 0,
    summary.calls || 0,
    summary.conversion || 0,
    summary.attention?.topLabel || '',
    summary.scheduleViews || 0,
    summary.scheduleSec || 0,
    summary.scheduleAvgSec || 0,
    summary.priceViews || 0,
    summary.priceSec || 0,
    summary.priceAvgSec || 0,
    summary.reviewViews || 0,
    summary.reviewSec || 0,
    summary.reviewAvgSec || 0,
    summary.photoOpens || 0,
    summary.sources?.avito || 0,
    summary.sources?.yandex || 0,
    summary.sources?.google || 0,
    summary.sources?.vk || 0,
    summary.sources?.direct || 0,
    summary.sources?.other || 0,
    summary.deviceShare?.phone || 0,
    summary.deviceShare?.tablet || 0,
    summary.deviceShare?.desktop || 0,
  ];
  const summaryData = summarySheet.addRow(summaryValues);
  paintBodyRow(summaryData, { dateCol: 1 });
  summaryData.getCell(1).fill = DATE_FILL;
  summaryData.getCell(1).font = { bold: true, color: { argb: 'FF134E4A' } };
  summaryData.getCell(2).fill = DATE_FILL;
  summaryData.getCell(2).font = { bold: true, color: { argb: 'FF134E4A' } };
  summaryData.height = 20;

  const daysSheet = workbook.addWorksheet('По дням', {
    views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }],
  });
  const dayHeaders = [
    'Дата',
    'Визиты',
    'Уникальные',
    'Звонки',
    'График, раз',
    'График, сек',
    'Цены, раз',
    'Цены, сек',
    'Отзывы, раз',
    'Отзывы, сек',
    'Открывали фото',
    'Авито',
    'Яндекс',
    'Google',
    'VK',
    'Прямой заход',
    'Другое',
    'Телефон %',
    'Планшет %',
    'Компьютер %',
  ];
  const dayWidths = {
    Дата: 14,
    Визиты: 12,
    Уникальные: 14,
    Звонки: 12,
    'График, раз': 13,
    'График, сек': 13,
    'Цены, раз': 12,
    'Цены, сек': 12,
    'Отзывы, раз': 13,
    'Отзывы, сек': 13,
    'Открывали фото': 18,
    Авито: 12,
    Яндекс: 12,
    Google: 12,
    VK: 10,
    'Прямой заход': 16,
    Другое: 12,
    'Телефон %': 13,
    'Планшет %': 13,
    'Компьютер %': 14,
  };
  daysSheet.addRow(dayHeaders);
  daysSheet.columns = dayHeaders.map((header) => ({
    header,
    width: dayWidths[header] || Math.max(14, header.length + 2),
  }));
  paintHeaderRow(daysSheet.getRow(1));
  daysSheet.getRow(1).height = 24;
  (summary.byDay || []).forEach((day, index) => {
    const row = daysSheet.addRow([
      formatMoscowDate(day.date),
      day.visits || 0,
      day.unique || 0,
      day.calls || 0,
      day.schedule || 0,
      day.scheduleSec || 0,
      day.prices || 0,
      day.pricesSec || 0,
      day.reviews || 0,
      day.reviewsSec || 0,
      day.photos || 0,
      day.avito || 0,
      day.yandex || 0,
      day.google || 0,
      day.vk || 0,
      day.direct || 0,
      day.other || 0,
      day.phoneShare || 0,
      day.tabletShare || 0,
      day.desktopShare || 0,
    ]);
    paintBodyRow(row, { dateCol: 1, zebra: index % 2 === 1 });
  });

  const whenSheet = workbook.addWorksheet('Когда заходят', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  whenSheet.mergeCells('A1:E1');
  whenSheet.getCell('A1').value = summary.whenPhrase || 'Когда заходят на сайт';
  whenSheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF134E4A' } };
  whenSheet.getRow(1).height = 24;
  whenSheet.addRow([]);
  const whenHeaders = ['День недели', 'Визиты', 'Звонки', 'Час-пик', 'Окно (со скольки до скольки)'];
  whenSheet.addRow(whenHeaders);
  paintHeaderRow(whenSheet.getRow(3));
  whenSheet.columns = [
    { width: 16 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 28 },
  ];
  (summary.weekdayReport || []).forEach((row, index) => {
    const excelRow = whenSheet.addRow([
      row.dayFull,
      row.visits || 0,
      row.calls || 0,
      row.peakHour == null ? '—' : `${String(row.peakHour).padStart(2, '0')}:00`,
      row.windowLabel || '—',
    ]);
    paintBodyRow(excelRow, { dateCol: 1, zebra: index % 2 === 1 });
  });

  const heatSheet = workbook.addWorksheet('Теплокарта', {
    views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }],
  });
  heatSheet.getCell('A1').value = 'Когда заходят (чем темнее — тем больше). Москва.';
  heatSheet.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FF134E4A' } };
  heatSheet.mergeCells(1, 1, 1, (summary.heatmap?.hours?.length || 0) + 1);
  const heatHeader = ['День', ...(summary.heatmap?.hours || []).map((h) => String(h).padStart(2, '0'))];
  heatSheet.addRow([]);
  heatSheet.addRow(heatHeader);
  paintHeaderRow(heatSheet.getRow(3));
  heatSheet.getColumn(1).width = 14;
  (summary.heatmap?.hours || []).forEach((_, idx) => {
    heatSheet.getColumn(idx + 2).width = 5;
  });
  const heatMax = summary.heatmap?.max || 0;
  (summary.heatmap?.days || []).forEach((day) => {
    const excelRow = heatSheet.addRow([day.labelFull, ...day.cells]);
    excelRow.getCell(1).fill = DATE_FILL;
    excelRow.getCell(1).font = { bold: true, color: { argb: 'FF134E4A' } };
    day.cells.forEach((value, idx) => {
      const cell = excelRow.getCell(idx + 2);
      cell.value = value || '';
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: heatColor(value, heatMax) },
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.font = {
        bold: value > 0,
        color: { argb: value / Math.max(heatMax, 1) > 0.55 ? 'FFFFFFFF' : 'FF134E4A' },
      };
    });
  });

  const attentionSheet = workbook.addWorksheet('Внимание');
  attentionSheet.getCell('A1').value = 'Куда люди смотрят дольше';
  attentionSheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF134E4A' } };
  attentionSheet.addRow([]);
  attentionSheet.addRow(['Блок', 'Секунд', 'Раз', 'Доля %']);
  paintHeaderRow(attentionSheet.getRow(3));
  attentionSheet.columns = [{ width: 14 }, { width: 12 }, { width: 10 }, { width: 12 }];
  const attentionTotal =
    (summary.scheduleSec || 0) + (summary.priceSec || 0) + (summary.reviewSec || 0) || 1;
  const attentionRows = [
    ['График', summary.scheduleSec || 0, summary.scheduleViews || 0],
    ['Цены', summary.priceSec || 0, summary.priceViews || 0],
    ['Отзывы', summary.reviewSec || 0, summary.reviewViews || 0],
  ];
  attentionRows.forEach((item, index) => {
    const pct = Math.round((item[1] / attentionTotal) * 1000) / 10;
    const excelRow = attentionSheet.addRow([item[0], item[1], item[2], pct]);
    paintBodyRow(excelRow, { dateCol: 1, zebra: index % 2 === 1 });
  });
  attentionSheet.addRow([]);
  attentionSheet.addRow([
    'Итог',
    summary.attention?.topLabel
      ? `Больше всего внимания: ${summary.attention.topLabel}`
      : 'Пока мало данных',
  ]);

  try {
    const donutPng = await buildAttentionDonutPng(summary);
    const imageId = workbook.addImage({
      buffer: donutPng,
      extension: 'png',
    });
    attentionSheet.addImage(imageId, {
      tl: { col: 5, row: 1 },
      ext: { width: 320, height: 430 },
    });
  } catch (error) {
    console.error('attention_donut_error', error);
  }

  const eventsSheet = workbook.addWorksheet('События', {
    views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }],
  });
  const eventHeaders = ['Время', 'Событие', 'Секунд', 'Устройство', 'Источник', 'Путь'];
  eventsSheet.addRow(eventHeaders);
  eventsSheet.columns = [
    { header: 'Время', width: 18 },
    { header: 'Событие', width: 22 },
    { header: 'Секунд', width: 10 },
    { header: 'Устройство', width: 14 },
    { header: 'Источник', width: 16 },
    { header: 'Путь', width: 18 },
  ];
  paintHeaderRow(eventsSheet.getRow(1));
  events.forEach((event, index) => {
    const ms = Number(event.ms) || 0;
    const row = eventsSheet.addRow([
      formatMoscowDateTime(event.at),
      EVENT_LABELS[event.type] || event.type,
      ms > 0 ? Math.round(ms / 1000) : '',
      DEVICE_LABELS[event.device] || event.device,
      SOURCE_LABELS[event.source] || event.source,
      event.path || '/',
    ]);
    paintBodyRow(row, { dateCol: 1, zebra: index % 2 === 1 });
    row.getCell(2).fill = LABEL_FILL;
    row.getCell(2).font = { bold: true, color: { argb: 'FF134E4A' } };
    row.getCell(2).alignment = { vertical: 'middle', horizontal: 'left' };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function buildAttentionDonutPng(summary) {
  const parts = [
    { label: 'График', value: summary.scheduleSec || 0, color: '#0f766e' },
    { label: 'Цены', value: summary.priceSec || 0, color: '#f59e0b' },
    { label: 'Отзывы', value: summary.reviewSec || 0, color: '#38bdf8' },
  ];
  const total = parts.reduce((a, b) => a + b.value, 0) || 1;
  const cx = 160;
  const cy = 170;
  const r = 90;
  const stroke = 44;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const circles = parts
    .map((part) => {
      const len = (part.value / total) * circumference;
      const circle = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${part.color}" stroke-width="${stroke}" stroke-dasharray="${len} ${circumference - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})" />`;
      offset += len;
      return circle;
    })
    .join('');
  const legend = parts
    .map((part, index) => {
      const y = 340 + index * 28;
      const pct = Math.round((part.value / total) * 100);
      return `<rect x="40" y="${y}" width="16" height="16" rx="3" fill="${part.color}"/>${textPath(`${part.label}: ${part.value} сек (${pct}%)`, { x: 66, y: y + 13, size: 14, fill: '#134e4a' })}`;
    })
    .join('');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="430" viewBox="0 0 320 430">
  <rect width="320" height="430" fill="#ffffff"/>
  ${textPath('Куда смотрят дольше', { x: cx, y: 36, size: 18, bold: true, anchor: 'middle', fill: '#134e4a' })}
  ${circles}
  <circle cx="${cx}" cy="${cy}" r="${r - stroke / 2 - 6}" fill="#ffffff"/>
  ${textPath('внимание', { x: cx, y: cy - 2, size: 15, anchor: 'middle', fill: '#134e4a' })}
  ${textPath(`${total} сек`, { x: cx, y: cy + 20, size: 13, anchor: 'middle', fill: '#0f766e' })}
  ${legend}
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
