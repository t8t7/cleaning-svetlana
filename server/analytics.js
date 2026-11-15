import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';

export const EVENT_TYPES = new Set([
  'page_view',
  'schedule_open',
  'price_view',
  'photo_open',
  'call_click',
  'lead_submit',
]);

export const DEVICES = new Set(['phone', 'tablet', 'desktop']);
export const SOURCES = new Set(['avito', 'yandex', 'google', 'direct', 'other']);

const EVENT_LABELS = {
  page_view: 'Открыл сайт',
  schedule_open: 'Смотрел график',
  price_view: 'Смотрел цены',
  photo_open: 'Открыл фото',
  call_click: 'Нажал Позвонить',
  lead_submit: 'Заявка',
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
  direct: 'Прямой заход',
  other: 'Другое',
};

const WEEKDAY_RU = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

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

  return {
    ok: true,
    event: {
      at: new Date().toISOString(),
      type,
      device,
      source,
      visitorId,
      ipHash: hashIp(ip),
      path: sanitizeShort(body.path || '/', 120) || '/',
    },
  };
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
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

async function readMonthFile(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
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

export function summarizeAnalytics(events) {
  const devices = emptyCounter([...DEVICES]);
  const sources = emptyCounter([...SOURCES]);
  const byType = emptyCounter([...EVENT_TYPES]);
  const byHour = Array.from({ length: 24 }, () => 0);
  const byWeekday = Array.from({ length: 7 }, () => 0);
  const byDayMap = new Map();
  const uniqueVisitors = new Set();
  const callers = new Set();

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

    if (!byDayMap.has(parts.dateKey)) {
      byDayMap.set(parts.dateKey, {
        date: parts.dateKey,
        visits: 0,
        unique: new Set(),
        calls: 0,
        avito: 0,
        phone: 0,
        total: 0,
      });
    }
    const day = byDayMap.get(parts.dateKey);
    day.total += 1;
    if (device === 'phone') day.phone += 1;
    if (source === 'avito') day.avito += 1;
    if (type === 'page_view') {
      day.visits += 1;
      if (event.visitorId) day.unique.add(event.visitorId);
    }
    if (type === 'call_click') {
      day.calls += 1;
      if (event.visitorId) callers.add(event.visitorId);
    }
  }

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
      avito: day.avito,
      phoneShare: day.total ? Math.round((day.phone / day.total) * 1000) / 10 : 0,
    }));

  const recent = [...events]
    .reverse()
    .slice(0, 40)
    .map((event) => ({
      at: event.at,
      type: event.type,
      label: EVENT_LABELS[event.type] || event.type,
      device: event.device,
      deviceLabel: DEVICE_LABELS[event.device] || event.device,
      source: event.source,
      sourceLabel: SOURCE_LABELS[event.source] || event.source,
    }));

  return {
    visits,
    unique: uniqueVisitors.size,
    calls,
    conversion,
    leads: byType.lead_submit || 0,
    scheduleViews: byType.schedule_open || 0,
    priceViews: byType.price_view || 0,
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
    byDay,
    byType,
    recent,
    labels: { events: EVENT_LABELS, devices: DEVICE_LABELS, sources: SOURCE_LABELS },
  };
}

function styleHeader(row) {
  row.font = { bold: true };
  row.alignment = { vertical: 'middle' };
}

export async function buildAnalyticsWorkbook(summary, events, { from, to } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Svetlana analytics';
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet('Сводка', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  summarySheet.columns = [
    { header: 'Показатель', key: 'name', width: 36 },
    { header: 'Значение', key: 'value', width: 22 },
  ];
  styleHeader(summarySheet.getRow(1));

  const summaryRows = [
    ['Период с', from || ''],
    ['Период по', to || ''],
    ['Визиты (открытия сайта)', summary.visits],
    ['Уникальные посетители', summary.unique],
    ['Клики «Позвонить»', summary.calls],
    ['Конверсия в звонок, %', summary.conversion],
    ['Заявки', summary.leads],
    ['Смотрели график', summary.scheduleViews],
    ['Смотрели цены', summary.priceViews],
    ['Открывали фото', summary.photoOpens],
    ['Телефон, % событий', summary.deviceShare.phone],
    ['Планшет, % событий', summary.deviceShare.tablet],
    ['Компьютер, % событий', summary.deviceShare.desktop],
    ['Авито', summary.sources.avito],
    ['Яндекс', summary.sources.yandex],
    ['Google', summary.sources.google],
    ['Прямой заход', summary.sources.direct],
    ['Другое', summary.sources.other],
  ];
  for (const [name, value] of summaryRows) {
    summarySheet.addRow({ name, value });
  }

  const daysSheet = workbook.addWorksheet('По дням', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  daysSheet.columns = [
    { header: 'Дата', key: 'date', width: 14 },
    { header: 'Визиты', key: 'visits', width: 12 },
    { header: 'Уникальные', key: 'unique', width: 12 },
    { header: 'Звонки', key: 'calls', width: 12 },
    { header: 'С Авито', key: 'avito', width: 12 },
    { header: 'Телефон %', key: 'phoneShare', width: 12 },
  ];
  styleHeader(daysSheet.getRow(1));
  for (const day of summary.byDay || []) {
    daysSheet.addRow(day);
  }

  const eventsSheet = workbook.addWorksheet('События', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  eventsSheet.columns = [
    { header: 'Время', key: 'at', width: 22 },
    { header: 'Событие', key: 'label', width: 22 },
    { header: 'Код', key: 'type', width: 16 },
    { header: 'Устройство', key: 'deviceLabel', width: 14 },
    { header: 'Источник', key: 'sourceLabel', width: 16 },
    { header: 'Путь', key: 'path', width: 20 },
  ];
  styleHeader(eventsSheet.getRow(1));
  for (const event of events) {
    eventsSheet.addRow({
      at: event.at,
      label: EVENT_LABELS[event.type] || event.type,
      type: event.type,
      deviceLabel: DEVICE_LABELS[event.device] || event.device,
      sourceLabel: SOURCE_LABELS[event.source] || event.source,
      path: event.path || '/',
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
