import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhone, validateContactPayload } from './contact.js';

test('normalizePhone accepts 8 XXX format', () => {
  const n = normalizePhone('8 904 563-81-70');
  assert.equal(n.ok, true);
  assert.equal(n.phoneTel, '+79045638170');
  assert.equal(n.phoneDisplay, '+7 (904) 563-81-70');
});

test('validateContactPayload rejects short numbers', () => {
  const bad = validateContactPayload({ phone: '123' });
  assert.equal(bad.ok, false);
});
