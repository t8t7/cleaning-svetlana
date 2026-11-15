import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { panelPath } from './adminAuth.js';

const OAUTH_COOKIE = 'sv_admin_oauth';
const OAUTH_MAX_AGE_MS = 10 * 60 * 1000;
const oauthClient = new OAuth2Client();

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

function sign(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('base64url');
}

export function parseAdminEmails(raw) {
  const out = new Set();
  for (const part of String(raw || '').split(/[,;\s]+/)) {
    const email = part.trim().toLowerCase();
    if (!email || !email.includes('@') || email.length > 254) continue;
    out.add(email);
  }
  return out;
}

export function emailAllowed(email, allow) {
  if (!allow || typeof allow.has !== 'function') return false;
  return allow.has(String(email || '').trim().toLowerCase());
}

export function createOAuthTransaction(secret) {
  const state = crypto.randomBytes(16).toString('hex');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const payload = { state, verifier, exp: Date.now() + OAUTH_MAX_AGE_MS };
  const body = b64url(JSON.stringify(payload));
  return { state, verifier, token: `${body}.${sign(secret, body)}` };
}

export function readOAuthTransaction(token, secret) {
  if (!token || !secret) return null;
  const [body, sig] = String(token).split('.');
  if (!body || !sig || String(token).split('.').length !== 2) return null;
  const expected = sign(secret, body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(fromB64url(body));
    if (!(Number(payload.exp) > Date.now())) return null;
    const state = String(payload.state || '');
    const verifier = String(payload.verifier || '');
    if (!/^[a-f0-9]{32}$/.test(state) || verifier.length < 43) return null;
    return { state, verifier };
  } catch {
    return null;
  }
}

export function oauthStateCookie(token, { secure = true, path } = {}) {
  const cookiePath = panelPath(path);
  if (!cookiePath) throw new Error('invalid panel cookie path');
  const maxAge = Math.floor(OAUTH_MAX_AGE_MS / 1000);
  const securePart = secure ? '; Secure' : '';
  return `${OAUTH_COOKIE}=${encodeURIComponent(token)}; Path=${cookiePath}; HttpOnly; SameSite=Lax${securePart}; Max-Age=${maxAge}`;
}

export function clearOAuthStateCookie({ secure = true, path } = {}) {
  const cookiePath = panelPath(path);
  if (!cookiePath) throw new Error('invalid panel cookie path');
  const securePart = secure ? '; Secure' : '';
  return `${OAUTH_COOKIE}=; Path=${cookiePath}; HttpOnly; SameSite=Lax${securePart}; Max-Age=0`;
}

export function adminPublicOrigin(req, configuredOrigin) {
  const host = String(req.get('host') || '').toLowerCase();
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
    const proto = req.protocol === 'https' ? 'https' : 'http';
    return `${proto}://${host}`;
  }
  return String(configuredOrigin || 'https://test-fas.ru').trim().replace(/\/$/, '');
}

export function googleRedirectUri(origin, basePath) {
  const base = panelPath(basePath);
  if (!base) throw new Error('invalid panel path');
  return `${String(origin || '').replace(/\/$/, '')}${base}/api/google/callback`;
}

export function googleAuthorizeUrl({ clientId, redirectUri, state, verifier }) {
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode({ code, clientId, clientSecret, redirectUri, verifier }) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id_token) {
    const error = new Error('google_token_exchange_failed');
    error.detail = typeof data.error === 'string' ? data.error : `http_${response.status}`;
    throw error;
  }
  return data.id_token;
}

export async function verifyGoogleIdToken(idToken, clientId) {
  const ticket = await oauthClient.verifyIdToken({
    idToken,
    audience: clientId,
  });
  const payload = ticket.getPayload() || {};
  const iss = payload.iss;
  if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') return null;
  if (payload.email_verified !== true) return null;
  const email = String(payload.email || '').trim().toLowerCase();
  if (!email || !payload.sub) return null;
  return { email, sub: String(payload.sub) };
}

export { OAUTH_COOKIE };
