import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

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

export function createAdminSessionToken(secret, { email, method = 'google' }) {
  const payload = {
    exp: Date.now() + MAX_AGE_MS,
    nonce: crypto.randomBytes(8).toString('hex'),
    email: String(email || '').trim().toLowerCase(),
    method: method === 'password' || method === 'totp-setup' ? method : 'google',
  };
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyAdminSessionToken(token, secret) {
  if (!token || !secret) return null;
  const [body, sig] = String(token).split('.');
  if (!body || !sig || String(token).split('.').length !== 2) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(fromB64url(body));
    const email = String(payload.email || '').trim().toLowerCase();
    const method = payload.method === 'password' || payload.method === 'totp-setup' ? payload.method : 'google';
    if (!email || !email.includes('@')) return null;
    if (!(Number(payload.exp) > Date.now())) return null;
    return { email, method, exp: Number(payload.exp) };
  } catch {
    return null;
  }
}

export async function ensureAdminSessionSecret(file, envValue) {
  const fromEnv = String(envValue || '').trim();
  if (fromEnv.length >= 32) return fromEnv;
  try {
    const existing = (await fs.readFile(file, 'utf8')).trim();
    if (existing.length >= 32) return existing;
  } catch {
    /* create below */
  }
  const created = crypto.randomBytes(32).toString('hex');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${created}\n`, { mode: 0o600 });
  return created;
}

const RESERVED_PANEL_NAMES = new Set([
  'admin',
  'administrator',
  'login',
  'wp-admin',
  'dashboard',
  'panel',
  'backend',
  'manage',
  'manager',
  'cpanel',
  'api',
  'uploads',
  'health',
  'app-download',
  'cdn',
  'signin',
  'auth',
  'console',
  'system',
]);

export function panelPath(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const normalized = withSlash.replace(/\/+$/, '');
  const segment = normalized.slice(1);
  if (!segment || segment.includes('/') || normalized.includes('//')) return '';
  if (!/^[a-z0-9][a-z0-9-]{7,40}$/i.test(segment)) return '';
  const lower = segment.toLowerCase();
  if (lower.includes('admin') || RESERVED_PANEL_NAMES.has(lower)) return '';
  return `/${segment}`;
}

export function adminSessionCookie(token, { secure = true, path } = {}) {
  const cookiePath = panelPath(path);
  if (!cookiePath) throw new Error('invalid panel cookie path');
  const maxAge = Math.floor(MAX_AGE_MS / 1000);
  const securePart = secure ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=${cookiePath}; HttpOnly; SameSite=Strict${securePart}; Max-Age=${maxAge}`;
}

export function clearAdminSessionCookie({ secure = true, path } = {}) {
  const cookiePath = panelPath(path);
  if (!cookiePath) throw new Error('invalid panel cookie path');
  const securePart = secure ? '; Secure' : '';
  return `${COOKIE_NAME}=; Path=${cookiePath}; HttpOnly; SameSite=Strict${securePart}; Max-Age=0`;
}

export function readAdminSession(req, secret) {
  const cookies = parseCookies(req.headers.cookie);
  return verifyAdminSessionToken(cookies[COOKIE_NAME], secret);
}

export { COOKIE_NAME, MAX_AGE_MS };
