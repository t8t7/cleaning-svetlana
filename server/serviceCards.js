import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Карточки блока «Услуги» на сайте.
 * title/description на сайте статичны.
 * Через API/APK меняются только цена и длительность (по id).
 *
 * unit: m2 | fixed | request
 * durationText — если задан, показывается как есть («по объёму»)
 * durationMinutes / durationMinutesMax — иначе формат из минут
 * durationApprox — префикс «~»
 */
export const SERVICE_CARD_IDS = ['general', 'after-repair', 'maintain', 'windows'];

export const DEFAULT_SERVICE_CARDS = {
  meta: {
    updatedAt: null,
  },
  items: [
    {
      id: 'general',
      price: 200,
      priceFrom: true,
      unit: 'm2',
      durationMinutes: 300,
      durationMinutesMax: null,
      durationApprox: true,
      durationText: '',
    },
    {
      id: 'after-repair',
      price: 200,
      priceFrom: true,
      unit: 'm2',
      durationMinutes: null,
      durationMinutesMax: null,
      durationApprox: false,
      durationText: 'по объёму',
    },
    {
      id: 'maintain',
      price: 0,
      priceFrom: false,
      unit: 'request',
      durationMinutes: 120,
      durationMinutesMax: 240,
      durationApprox: false,
      durationText: '',
    },
    {
      id: 'windows',
      price: 600,
      priceFrom: true,
      unit: 'fixed',
      durationMinutes: 45,
      durationMinutesMax: null,
      durationApprox: true,
      durationText: '',
    },
  ],
};

export function formatDurationParts(item) {
  const custom = String(item.durationText || '').trim();
  if (custom) return custom;

  const min = Number(item.durationMinutes);
  const max = Number(item.durationMinutesMax);
  const approx = item.durationApprox === true ? '~' : '';

  const one = (minutes) => {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    if (m <= 0) return '';
    if (m < 60) return `${m} мин`;
    const h = Math.floor(m / 60);
    const rest = m % 60;
    if (rest === 0) return `${h} ч`;
    return `${h} ч ${rest} мин`;
  };

  if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
    if (min >= 60 && max >= 60 && min % 60 === 0 && max % 60 === 0) {
      return `${approx}${min / 60}–${max / 60} ч`;
    }
    return `${approx}${one(min)}–${one(max)}`;
  }

  if (Number.isFinite(min) && min > 0) {
    return `${approx}${one(min)}`;
  }

  return '';
}

export function formatServicePrice(item) {
  if (item.unit === 'request') return 'по запросу';
  const amount = Math.round(Number(item.price) || 0).toLocaleString('ru-RU');
  const prefix = item.priceFrom !== false ? 'от ' : '';
  const suffix = item.unit === 'm2' ? '/м²' : '';
  return `${prefix}${amount} ₽${suffix}`;
}

export function presentServiceCard(item) {
  return {
    ...item,
    priceLabel: formatServicePrice(item),
    durationLabel: formatDurationParts(item),
  };
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Некорректная карточка услуги' };
  }
  const id = String(raw.id || '').trim();
  if (!SERVICE_CARD_IDS.includes(id)) {
    return { ok: false, error: `Неизвестный id услуги: ${id}` };
  }

  const unit =
    raw.unit === 'm2' || raw.unit === 'fixed' || raw.unit === 'request' ? raw.unit : null;
  if (!unit) {
    return { ok: false, error: `unit должен быть m2, fixed или request (${id})` };
  }

  const price = Number(raw.price);
  if (unit !== 'request' && (!Number.isFinite(price) || price < 0 || price > 1_000_000)) {
    return { ok: false, error: `Некорректная цена у ${id}` };
  }

  let durationMinutes = raw.durationMinutes;
  let durationMinutesMax = raw.durationMinutesMax;
  if (durationMinutes === '' || durationMinutes === undefined) durationMinutes = null;
  if (durationMinutesMax === '' || durationMinutesMax === undefined) durationMinutesMax = null;

  if (durationMinutes !== null) {
    durationMinutes = Number(durationMinutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes < 0 || durationMinutes > 24 * 60) {
      return { ok: false, error: `Некорректная длительность у ${id}` };
    }
    durationMinutes = Math.round(durationMinutes);
  }

  if (durationMinutesMax !== null) {
    durationMinutesMax = Number(durationMinutesMax);
    if (
      !Number.isFinite(durationMinutesMax) ||
      durationMinutesMax < 0 ||
      durationMinutesMax > 24 * 60
    ) {
      return { ok: false, error: `Некорректный диапазон длительности у ${id}` };
    }
    durationMinutesMax = Math.round(durationMinutesMax);
  }

  const durationText = String(raw.durationText || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 40);

  return {
    ok: true,
    item: {
      id,
      price: unit === 'request' ? 0 : Math.round(price),
      priceFrom: raw.priceFrom !== false,
      unit,
      durationMinutes,
      durationMinutesMax,
      durationApprox: raw.durationApprox === true,
      durationText,
    },
  };
}

export function validateServiceCardsPayload(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Некорректное тело запроса' };
  }
  if (!Array.isArray(body.items) || body.items.length !== SERVICE_CARD_IDS.length) {
    return {
      ok: false,
      error: `Нужен items из ${SERVICE_CARD_IDS.length} карточек: ${SERVICE_CARD_IDS.join(', ')}`,
    };
  }

  const byId = new Map();
  for (const raw of body.items) {
    const checked = normalizeItem(raw);
    if (!checked.ok) return checked;
    if (byId.has(checked.item.id)) {
      return { ok: false, error: `Повтор id: ${checked.item.id}` };
    }
    byId.set(checked.item.id, checked.item);
  }

  for (const id of SERVICE_CARD_IDS) {
    if (!byId.has(id)) {
      return { ok: false, error: `Не хватает карточки: ${id}` };
    }
  }

  return {
    ok: true,
    data: {
      meta: { updatedAt: new Date().toISOString() },
      items: SERVICE_CARD_IDS.map((id) => byId.get(id)),
    },
  };
}

export async function readServiceCards(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const check = validateServiceCardsPayload(parsed);
    if (!check.ok) return structuredClone(DEFAULT_SERVICE_CARDS);
    return {
      meta: { updatedAt: parsed.meta?.updatedAt || null },
      items: check.data.items,
    };
  } catch {
    return structuredClone(DEFAULT_SERVICE_CARDS);
  }
}

export async function writeServiceCardsAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, filePath);
}

export function publicServiceCards(data) {
  return {
    meta: data.meta,
    items: (data.items || []).map(presentServiceCard),
    serverTime: new Date().toISOString(),
  };
}
