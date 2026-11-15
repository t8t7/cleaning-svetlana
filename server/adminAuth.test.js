import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAdminSessionToken,
  panelPath,
  verifyAdminSessionToken,
} from './adminAuth.js';
import {
  adminPublicOrigin,
  createOAuthTransaction,
  emailAllowed,
  googleAuthorizeUrl,
  googleRedirectUri,
  parseAdminEmails,
  readOAuthTransaction,
} from './googleAdmin.js';

test('admin session carries the Google email and rejects a tampered token', () => {
  const secret = 'session-secret-session-secret-session';
  const token = createAdminSessionToken(secret, { email: 'Owner@Gmail.com' });
  assert.equal(verifyAdminSessionToken(token, secret).email, 'owner@gmail.com');
  assert.equal(verifyAdminSessionToken(token, 'other-secret-other-secret-other'), null);
  const [body] = token.split('.');
  assert.equal(verifyAdminSessionToken(`${body}.aaaa`, secret), null);
  assert.equal(verifyAdminSessionToken('nope', secret), null);
});

test('allowlist matches only listed Google accounts', () => {
  const allow = parseAdminEmails(' Owner@Gmail.com, second@example.com \n');
  assert.equal(allow.size, 2);
  assert.equal(emailAllowed('owner@gmail.com', allow), true);
  assert.equal(emailAllowed('stranger@gmail.com', allow), false);
  assert.equal(parseAdminEmails('not-an-email').size, 0);
});

test('oauth state cookie round-trips and the authorize URL does not leak the verifier', () => {
  const secret = 'session-secret-session-secret-session';
  const tx = createOAuthTransaction(secret);
  const read = readOAuthTransaction(tx.token, secret);
  assert.equal(read.state, tx.state);
  assert.equal(read.verifier, tx.verifier);
  assert.equal(readOAuthTransaction(tx.token, 'wrong-secret-wrong-secret-wrong'), null);

  const url = new URL(googleAuthorizeUrl({
    clientId: 'client-id',
    redirectUri: googleRedirectUri('https://test-fas.ru', '/sv-h7k4m2'),
    state: tx.state,
    verifier: tx.verifier,
  }));
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('state'), tx.state);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://test-fas.ru/sv-h7k4m2/api/google/callback');
  assert.equal(url.searchParams.get('code_verifier'), null);
  assert.ok(!url.toString().includes(tx.verifier));
});

test('panel path rejects scanned names and accepts an unlisted segment', () => {
  assert.equal(panelPath('/admin'), '');
  assert.equal(panelPath('wp-admin'), '');
  assert.equal(panelPath('/admin-panel'), '');
  assert.equal(panelPath('/login'), '');
  assert.equal(panelPath('/sv'), '');
  assert.equal(panelPath('/sv-h7k4m2'), '/sv-h7k4m2');
  assert.throws(() => googleRedirectUri('https://test-fas.ru', '/admin'));
});

test('public origin stays pinned off localhost so Host cannot choose the redirect', () => {
  const local = {
    get: () => 'localhost:3000',
    protocol: 'http',
  };
  const spoofed = {
    get: () => 'evil.example',
    protocol: 'https',
  };
  assert.equal(adminPublicOrigin(local, 'https://test-fas.ru'), 'http://localhost:3000');
  assert.equal(adminPublicOrigin(spoofed, 'https://test-fas.ru'), 'https://test-fas.ru');
});
