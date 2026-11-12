import fs from 'node:fs/promises';
import path from 'node:path';

const TYPES = ['maintain', 'general', 'afterRepair'];
const SIZES = ['studio', 'one', 'two', 'three'];

export const DEFAULT_CALCULATOR = {
  meta: { updatedAt: null },
  rates: {
    maintain: { studio: 2500, one: 3200, two: 4200, three: 5500 },
    general: { studio: 4500, one: 5900, two: 7900, three: 9900 },
    afterRepair: { studio: 5500, one: 7200, two: 9800, three: 12800 },
  },
};

function normalizeAmount(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) {
    return { ok: false, error: `Некорректная сумма для ${label}` };
  }
  return { ok: true, value: Math.round(n) };
}

export function validateCalculatorPayload(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Некорректное тело запроса' };
  }

  const source = body.rates && typeof body.rates === 'object' ? body.rates : body;
  const rates = {};

  for (const type of TYPES) {
    const row = source[type];
    if (!row || typeof row !== 'object') {
      return { ok: false, error: `Нужен блок rates.${type}` };
    }
    rates[type] = {};
    for (const size of SIZES) {
      const checked = normalizeAmount(row[size], `${type}.${size}`);
      if (!checked.ok) return checked;
      rates[type][size] = checked.value;
    }
  }

  return {
    ok: true,
    data: {
      meta: { updatedAt: new Date().toISOString() },
      rates,
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
      rates: check.data.rates,
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
  return {
    meta: data.meta,
    rates: data.rates,
    serverTime: new Date().toISOString(),
  };
}
