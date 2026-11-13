import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const SIZES = ['studio', 'one', 'two', 'three'];
const LEGACY_LABELS = {
  maintain: 'Поддерживающая',
  general: 'Генеральная',
  afterRepair: 'После ремонта',
};

const EMPTY_RATES = () => ({ studio: 0, one: 0, two: 0, three: 0 });

export const DEFAULT_CALCULATOR = {
  meta: { updatedAt: null },
  items: [
    {
      id: 'maintain',
      name: 'Поддерживающая',
      sort: 10,
      enabled: true,
      rates: { studio: 2500, one: 3200, two: 4200, three: 5500 },
    },
    {
      id: 'general',
      name: 'Генеральная',
      sort: 20,
      enabled: true,
      rates: { studio: 4500, one: 5900, two: 7900, three: 9900 },
    },
    {
      id: 'afterRepair',
      name: 'После ремонта',
      sort: 30,
      enabled: true,
      rates: { studio: 5500, one: 7200, two: 9800, three: 12800 },
    },
  ],
};

function sanitizeId(value) {
  const raw = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return raw || `calc-${randomUUID().slice(0, 8)}`;
}

function normalizeAmount(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) {
    return { ok: false, error: `Некорректная сумма для ${label}` };
  }
  return { ok: true, value: Math.round(n) };
}

function normalizeRates(raw, labelPrefix) {
  const rates = {};
  for (const size of SIZES) {
    const checked = normalizeAmount(raw?.[size], `${labelPrefix}.${size}`);
    if (!checked.ok) return checked;
    rates[size] = checked.value;
  }
  return { ok: true, rates };
}

function itemsFromLegacyRates(ratesObj) {
  const items = [];
  let sort = 10;
  for (const [id, row] of Object.entries(ratesObj || {})) {
    const checked = normalizeRates(row, id);
    if (!checked.ok) continue;
    items.push({
      id: sanitizeId(id),
      name: LEGACY_LABELS[id] || id,
      sort,
      enabled: true,
      rates: checked.rates,
    });
    sort += 10;
  }
  return items;
}

function ratesMapFromItems(items) {
  const rates = {};
  for (const item of items) {
    if (item.enabled === false) continue;
    rates[item.id] = { ...item.rates };
  }
  return rates;
}

export function validateCalculatorPayload(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Некорректное тело запроса' };
  }

  let rawItems = Array.isArray(body.items) ? body.items : null;

  // Backward compatible: old APK/site sent { rates: { maintain, general, afterRepair } }
  if (!rawItems) {
    const source = body.rates && typeof body.rates === 'object' ? body.rates : body;
    const hasLegacy =
      source &&
      typeof source === 'object' &&
      (source.maintain || source.general || source.afterRepair);
    if (!hasLegacy) {
      return { ok: false, error: 'Нужен массив items или блок rates' };
    }
    rawItems = itemsFromLegacyRates(source);
  }

  if (rawItems.length < 1) {
    return { ok: false, error: 'В калькуляторе нужна хотя бы одна услуга' };
  }
  if (rawItems.length > 30) {
    return { ok: false, error: 'Слишком много услуг в калькуляторе (макс. 30)' };
  }

  const seen = new Set();
  const items = [];
  for (let i = 0; i < rawItems.length; i += 1) {
    const raw = rawItems[i];
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: `Некорректная услуга калькулятора #${i + 1}` };
    }
    const name = String(raw.name || '')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .trim()
      .slice(0, 80);
    if (!name) {
      return { ok: false, error: `Пустое название у услуги калькулятора #${i + 1}` };
    }
    const id = sanitizeId(raw.id || name);
    if (seen.has(id)) {
      return { ok: false, error: `Повторяется id калькулятора: ${id}` };
    }
    seen.add(id);

    const ratesSource = raw.rates && typeof raw.rates === 'object' ? raw.rates : raw;
    const checked = normalizeRates(ratesSource, name);
    if (!checked.ok) return checked;

    items.push({
      id,
      name,
      sort: Number.isFinite(Number(raw.sort)) ? Number(raw.sort) : (i + 1) * 10,
      enabled: raw.enabled !== false,
      rates: checked.rates,
    });
  }

  items.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'ru'));

  return {
    ok: true,
    data: {
      meta: { updatedAt: new Date().toISOString() },
      items,
    },
  };
}

export async function readCalculator(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const check = validateCalculatorPayload(parsed);
    if (!check.ok) return structuredClone(DEFAULT_CALCULATOR);
    return {
      meta: { updatedAt: parsed.meta?.updatedAt || null },
      items: check.data.items,
    };
  } catch {
    return structuredClone(DEFAULT_CALCULATOR);
  }
}

export async function writeCalculatorAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, filePath);
}

export function publicCalculator(data) {
  const items = (data.items || [])
    .filter((item) => item.enabled !== false)
    .slice()
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'ru'));

  return {
    meta: data.meta,
    items,
    // Keep rates map for older clients / simple lookups.
    rates: ratesMapFromItems(items),
    serverTime: new Date().toISOString(),
  };
}
