import fs from 'node:fs/promises';
import path from 'node:path';

const TONES = new Set(['info', 'warn', 'urgent']);
const MAX_TEXT = 280;

function emptyMessage() {
  return {
    text: '',
    tone: 'warn',
    updatedAt: null,
  };
}

export function sanitizeOwnerMessageText(value) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, MAX_TEXT);
}

export function sanitizeOwnerMessageTone(value) {
  const tone = String(value || 'warn').trim().toLowerCase();
  return TONES.has(tone) ? tone : 'warn';
}

export async function readOwnerMessage(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const text = sanitizeOwnerMessageText(parsed.text);
    return {
      text,
      tone: sanitizeOwnerMessageTone(parsed.tone),
      updatedAt: parsed.updatedAt || null,
      active: Boolean(text),
    };
  } catch {
    return { ...emptyMessage(), active: false };
  }
}

async function writeOwnerMessageAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, filePath);
}

export async function setOwnerMessage(filePath, { text, tone } = {}) {
  const nextText = sanitizeOwnerMessageText(text);
  const next = {
    text: nextText,
    tone: sanitizeOwnerMessageTone(tone),
    updatedAt: nextText ? new Date().toISOString() : null,
  };
  await writeOwnerMessageAtomic(filePath, next);
  return {
    ...next,
    active: Boolean(nextText),
  };
}

export async function clearOwnerMessage(filePath) {
  return setOwnerMessage(filePath, { text: '', tone: 'warn' });
}

export function publicOwnerMessage(message) {
  if (!message?.text) {
    return { active: false, text: '', tone: 'warn', updatedAt: null };
  }
  return {
    active: true,
    text: message.text,
    tone: sanitizeOwnerMessageTone(message.tone),
    updatedAt: message.updatedAt || null,
  };
}
