import fs from 'node:fs/promises';
import path from 'node:path';

/** Default public phone until the master sets another from the app. */
export const DEFAULT_CONTACT = {
  phoneDisplay: '+7 (904) 563-81-70',
  phoneTel: '+79045638170',
  updatedAt: null,
};

/**
 * Normalize Russian-friendly phone input to E.164-ish +7… and display form.
 * Accepts: 8 904 563-81-70, +7 904…, 7904…, 904…
 */
export function normalizePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) {
    return { ok: false, error: 'Введите номер телефона' };
  }
  if (digits.length === 11 && digits.startsWith('8')) {
    digits = `7${digits.slice(1)}`;
  } else if (digits.length === 10) {
    digits = `7${digits}`;
  }
  if (digits.length < 11 || digits.length > 15) {
    return { ok: false, error: 'Номер должен быть 11 цифр (для РФ: 8 XXX XXX-XX-XX)' };
  }
  if (!digits.startsWith('7') || digits.length !== 11) {
    // Allow non-RU longer numbers as +digits, but require 11 for RU 7…
    if (digits.length < 11 || digits.length > 15) {
      return { ok: false, error: 'Некорректный номер' };
    }
  }

  const phoneTel = `+${digits}`;
  let phoneDisplay = phoneTel;
  if (digits.length === 11 && digits.startsWith('7')) {
    phoneDisplay = `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
  }

  return { ok: true, phoneDisplay, phoneTel, digits };
}

export function validateContactPayload(body = {}) {
  const source = body.phone ?? body.phoneDisplay ?? body.phoneTel ?? '';
  const normalized = normalizePhone(source);
  if (!normalized.ok) return normalized;
  return {
    ok: true,
    data: {
      phoneDisplay: normalized.phoneDisplay,
      phoneTel: normalized.phoneTel,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function publicContact(data = DEFAULT_CONTACT) {
  return {
    phoneDisplay: String(data.phoneDisplay || DEFAULT_CONTACT.phoneDisplay),
    phoneTel: String(data.phoneTel || DEFAULT_CONTACT.phoneTel),
    updatedAt: data.updatedAt || null,
  };
}

export async function readContact(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const check = validateContactPayload(parsed);
    if (!check.ok) return { ...DEFAULT_CONTACT };
    return {
      ...check.data,
      updatedAt: parsed.updatedAt || check.data.updatedAt,
    };
  } catch {
    return { ...DEFAULT_CONTACT };
  }
}

export async function writeContactAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(tmp, payload, 'utf8');
  await fs.rename(tmp, filePath);
}
