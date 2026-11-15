import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';

const ISSUER = 'Svetlana';
const LABEL = 'Panel';

function totpFor(base32) {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: LABEL,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(base32),
  });
}

export function generateTotpSecret() {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function verifyTotpCode(base32, code) {
  const digits = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(digits)) return false;
  const delta = totpFor(base32).validate({ token: digits, window: 1 });
  return delta !== null;
}

export function currentTotpCode(base32, timestamp = Date.now()) {
  return totpFor(base32).generate({ timestamp });
}

async function readState(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    const secret = String(parsed.secret || '').trim();
    if (!secret) return null;
    return { secret, confirmed: Boolean(parsed.confirmed) };
  } catch {
    return null;
  }
}

async function writeState(file, state) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.admin-totp.${crypto.randomBytes(4).toString('hex')}.tmp`);
  await fs.writeFile(tmp, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  await fs.rename(tmp, file);
}

export async function totpStatus(file) {
  const state = await readState(file);
  if (!state) return 'pending';
  return state.confirmed ? 'active' : 'pending';
}

export async function loadOrCreateTotp(file) {
  const existing = await readState(file);
  if (existing) return existing;
  const state = {
    secret: generateTotpSecret(),
    confirmed: false,
    createdAt: new Date().toISOString(),
  };
  await writeState(file, state);
  return { secret: state.secret, confirmed: false };
}

export async function enrollmentQr(secret) {
  const uri = totpFor(secret).toString();
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 280, errorCorrectionLevel: 'M' });
  return { qr };
}

export async function confirmTotp(file, code) {
  const state = await readState(file);
  if (!state || state.confirmed) return false;
  if (!verifyTotpCode(state.secret, code)) return false;
  await writeState(file, {
    secret: state.secret,
    confirmed: true,
    confirmedAt: new Date().toISOString(),
  });
  return true;
}
