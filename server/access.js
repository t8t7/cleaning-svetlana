import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

function emptyAccess(seedToken = '') {
  return {
    masterToken: String(seedToken || '').trim(),
    previousToken: '',
    previousValidUntil: null,
    tokenVersion: 1,
    updatedAt: null,
  };
}

export async function readAccess(filePath, seedToken = '') {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      masterToken: String(parsed.masterToken || seedToken || '').trim(),
      previousToken: String(parsed.previousToken || '').trim(),
      previousValidUntil: parsed.previousValidUntil || null,
      tokenVersion: Number(parsed.tokenVersion) || 1,
      updatedAt: parsed.updatedAt || null,
    };
  } catch {
    return emptyAccess(seedToken);
  }
}

async function writeAccessAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, filePath);
}

export async function ensureAccess(filePath, seedToken = '') {
  const current = await readAccess(filePath, seedToken);
  if (current.masterToken) return current;
  const seed = String(seedToken || '').trim();
  if (!seed) return current;
  const next = {
    ...emptyAccess(seed),
    tokenVersion: 1,
    updatedAt: new Date().toISOString(),
  };
  await writeAccessAtomic(filePath, next);
  return next;
}

export function tokenAccepted(access, provided) {
  const token = String(provided || '').trim();
  if (!token || !access?.masterToken) return false;
  if (token === access.masterToken) return true;
  if (!access.previousToken || token !== access.previousToken) return false;
  if (!access.previousValidUntil) return false;
  return Date.parse(access.previousValidUntil) > Date.now();
}

export async function rotateMasterToken(filePath, seedToken = '', graceHours = 24) {
  const current = await ensureAccess(filePath, seedToken);
  const nextToken = crypto.randomBytes(32).toString('hex');
  const graceMs = Math.max(1, Number(graceHours) || 24) * 60 * 60 * 1000;
  const next = {
    masterToken: nextToken,
    previousToken: current.masterToken || '',
    previousValidUntil: current.masterToken
      ? new Date(Date.now() + graceMs).toISOString()
      : null,
    tokenVersion: (Number(current.tokenVersion) || 1) + 1,
    updatedAt: new Date().toISOString(),
  };
  await writeAccessAtomic(filePath, next);
  return next;
}

export function publicAccessState(access) {
  return {
    tokenVersion: Number(access?.tokenVersion) || 1,
    updatedAt: access?.updatedAt || null,
    previousValidUntil: access?.previousValidUntil || null,
    hasPreviousGrace: Boolean(
      access?.previousToken &&
        access?.previousValidUntil &&
        Date.parse(access.previousValidUntil) > Date.now()
    ),
  };
}
