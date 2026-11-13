import crypto from 'node:crypto';

const COOKIE_NAME = 'sv_admin_session';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromB64url(value) {
  const padded = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf8');
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(value);
  }
  return out;
}

export function createAdminSessionToken(secret) {
  const payload = {
    exp: Date.now() + MAX_AGE_MS,
    nonce: crypto.randomBytes(8).toString('hex'),
  };
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyAdminSessionToken(token, secret) {
  if (!token || !secret) return false;
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return false;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const payload = JSON.parse(fromB64url(body));
    return Number(payload.exp) > Date.now();
  } catch {
    return false;
  }
}

export function adminSessionCookie(token, { secure = true } = {}) {
  const maxAge = Math.floor(MAX_AGE_MS / 1000);
  const securePart = secure ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/admin; HttpOnly; SameSite=Strict${securePart}; Max-Age=${maxAge}`;
}

export function clearAdminSessionCookie({ secure = true } = {}) {
  const securePart = secure ? '; Secure' : '';
  return `${COOKIE_NAME}=; Path=/admin; HttpOnly; SameSite=Strict${securePart}; Max-Age=0`;
}

export function readAdminSession(req, secret) {
  const cookies = parseCookies(req.headers.cookie);
  return verifyAdminSessionToken(cookies[COOKIE_NAME], secret);
}

export { COOKIE_NAME, MAX_AGE_MS };
