import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** @typedef {'m2' | 'fixed'} PriceUnit */

/**
 * unit:
 * - m2 — цена за квадратный метр (на сайте: «за м²»)
 * - fixed — фиксированная услуга без м²
 *
 * durationMinutes — длительность в минутах (30, 60, 90…)
 * priceFrom — показывать «от» перед ценой
 */
export const DEFAULT_PRICES = {
  meta: {
    currency: 'RUB',
    note: 'Цены «от» — ориентир. Точную сумму согласуем до начала работ.',
    updatedAt: null,
  },
  items: [
    {
      id: 'general',
      name: 'Генеральная уборка',
      price: 200,
      priceFrom: true,
      unit: 'm2',
      durationMinutes: 300,
      sort: 10,
      enabled: true,
    },
    {
      id: 'kitchen',
      name: 'Уборка кухни',
      price: 1000,
      priceFrom: true,
      unit: 'fixed',
      durationMinutes: 60,
      sort: 20,
      enabled: true,
    },
    {
      id: 'bathroom',
      name: 'Уборка ванной комнаты',
      price: 1500,
      priceFrom: true,
      unit: 'fixed',
      durationMinutes: 60,
      sort: 30,
      enabled: true,
    },
    {
      id: 'wc',
      name: 'Мытьё санузла',
      price: 1500,
      priceFrom: true,
      unit: 'fixed',
      durationMinutes: 60,
      sort: 40,
      enabled: true,
    },
    {
      id: 'fridge',
      name: 'Мытьё холодильника',
      price: 800,
      priceFrom: true,
      unit: 'fixed',
      durationMinutes: 30,
      sort: 50,
      enabled: true,
    },
    {
      id: 'oven',
      name: 'Мытьё духовки',
      price: 500,
      priceFrom: false,
      unit: 'fixed',
      durationMinutes: 30,
      sort: 60,
      enabled: true,
    },
    {
      id: 'windows',
      name: 'Мытьё окон',
      price: 600,
      priceFrom: true,
      unit: 'fixed',
      durationMinutes: 45,
      sort: 70,
      enabled: true,
    },
    {
      id: 'balcony',
      name: 'Мытьё балкона',
      price: 2000,
      priceFrom: true,
      unit: 'fixed',
      durationMinutes: 90,
      sort: 80,
      enabled: true,
    },
    {
      id: 'office',
      name: 'Уборка офиса',
      price: 150,
      priceFrom: true,
      unit: 'm2',
      durationMinutes: 180,
      sort: 90,
      enabled: true,
    },
    {
      id: 'event',
      name: 'Уборка после мероприятия',
      price: 200,
      priceFrom: true,
      unit: 'm2',
      durationMinutes: 180,
      sort: 100,
      enabled: true,
    },
    {
      id: 'industrial',
      name: 'Уборка производственного помещения',
      price: 200,
      priceFrom: true,
      unit: 'm2',
      durationMinutes: 300,
      sort: 110,
      enabled: true,
    },
  ],
};

export function formatDuration(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m <= 0) return '';
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (rest === 0) return `${h} ч`;
  return `${h} ч ${rest} мин`;
}

export function formatPriceAmount(price) {
  const amount = Math.round(Number(price) || 0);
  return `${amount.toLocaleString('ru-RU')} ₽`;
}

export function presentPriceItem(item) {
  const priceAmount = formatPriceAmount(item.price);
  const prefix = item.priceFrom !== false ? 'от ' : '';
  return {
    ...item,
    durationLabel: formatDuration(item.durationMinutes),
    priceLabel: `${prefix}${priceAmount}`,
    unitLabel: item.unit === 'm2' ? 'за м²' : '',
  };
}

function sanitizeId(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return raw || randomUUID().slice(0, 8);
}

function normalizeItem(raw, index) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: `Некорректная позиция #${index + 1}` };
  }

  const name = String(raw.name || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 120);
  if (!name) {
    return { ok: false, error: `Пустое название у позиции #${index + 1}` };
  }

  const price = Number(raw.price);
  if (!Number.isFinite(price) || price < 0 || price > 1_000_000) {
    return { ok: false, error: `Некорректная цена у «${name}»` };
  }

  const unit = raw.unit === 'm2' ? 'm2' : raw.unit === 'fixed' ? 'fixed' : null;
  if (!unit) {
    return { ok: false, error: `unit должен быть m2 или fixed у «${name}»` };
  }

  const durationMinutes = Number(raw.durationMinutes);
  if (!Number.isFinite(durationMinutes) || durationMinutes < 0 || durationMinutes > 24 * 60) {
    return { ok: false, error: `Некорректная длительность у «${name}»` };
  }

  const sort = Number.isFinite(Number(raw.sort)) ? Number(raw.sort) : (index + 1) * 10;
  const enabled = raw.enabled !== false;
  const priceFrom = raw.priceFrom !== false;

  return {
    ok: true,
    item: {
      id: sanitizeId(raw.id || name),
      name,
      price: Math.round(price),
      priceFrom,
      unit,
      durationMinutes: Math.round(durationMinutes),
      sort,
      enabled,
    },
  };
}

export function validatePricesPayload(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Некорректное тело запроса' };
  }
  if (!Array.isArray(body.items)) {
    return { ok: false, error: 'Нужен массив items' };
  }
  if (body.items.length > 80) {
    return { ok: false, error: 'Слишком много позиций (макс. 80)' };
  }

  const seen = new Set();
  const items = [];
  for (let i = 0; i < body.items.length; i += 1) {
    const checked = normalizeItem(body.items[i], i);
    if (!checked.ok) return checked;
    if (seen.has(checked.item.id)) {
      return { ok: false, error: `Повторяется id: ${checked.item.id}` };
    }
    seen.add(checked.item.id);
    items.push(checked.item);
  }

  items.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'ru'));

  const note =
    body.meta && typeof body.meta === 'object'
      ? String(body.meta.note || DEFAULT_PRICES.meta.note).slice(0, 200)
      : DEFAULT_PRICES.meta.note;

  return {
    ok: true,
    data: {
      meta: {
        currency: 'RUB',
        note,
        updatedAt: new Date().toISOString(),
      },
      items,
    },
  };
}

export async function readPrices(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const check = validatePricesPayload(parsed);
    if (!check.ok) {
      return structuredClone(DEFAULT_PRICES);
    }
    return {
      meta: {
        ...DEFAULT_PRICES.meta,
        ...parsed.meta,
        currency: 'RUB',
        updatedAt: parsed.meta?.updatedAt || null,
      },
      items: check.data.items,
    };
  } catch {
    return structuredClone(DEFAULT_PRICES);
  }
}

export async function writePricesAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(tmp, payload, 'utf8');
  await fs.rename(tmp, filePath);
}

export function publicPrices(data) {
  const items = (data.items || [])
    .filter((item) => item.enabled !== false)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'ru'))
    .map(presentPriceItem);

  return {
    meta: data.meta,
    items,
    serverTime: new Date().toISOString(),
  };
}

/** Full list for APK editor (includes disabled rows). */
export function managePrices(data) {
  const items = (data.items || [])
    .slice()
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'ru'))
    .map(presentPriceItem);

  return {
    meta: data.meta,
    items,
    serverTime: new Date().toISOString(),
  };
}
