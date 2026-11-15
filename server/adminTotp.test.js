import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  confirmTotp,
  currentTotpCode,
  generateTotpSecret,
  loadOrCreateTotp,
  verifyTotpCode,
} from './adminTotp.js';

test('totp accepts the current code and rejects a wrong one', () => {
  const secret = generateTotpSecret();
  const code = currentTotpCode(secret);
  assert.equal(verifyTotpCode(secret, code), true);
  assert.equal(verifyTotpCode(secret, '000000'), false);
  assert.equal(verifyTotpCode(secret, '12'), false);
});

test('enrollment confirms once and then keeps the same secret', async () => {
  const file = path.join(os.tmpdir(), `totp-${Date.now()}.json`);
  const created = await loadOrCreateTotp(file);
  const again = await loadOrCreateTotp(file);
  assert.equal(again.secret, created.secret);
  assert.equal(again.confirmed, false);
  const code = currentTotpCode(created.secret);
  assert.equal(await confirmTotp(file, '111111'), false);
  assert.equal(await confirmTotp(file, code), true);
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(saved.confirmed, true);
  assert.equal(await confirmTotp(file, code), false);
  await fs.unlink(file);
});
