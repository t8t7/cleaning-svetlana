import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePhoneBrand } from './devices.js';

test('resolvePhoneBrand maps common models', () => {
  assert.equal(resolvePhoneBrand({ model: 'SM-A525F' }), 'Samsung');
  assert.equal(resolvePhoneBrand({ model: 'Infinix X6725D' }), 'Infinix');
  assert.equal(resolvePhoneBrand({ brand: 'samsung', model: 'SM-A525F' }), 'Samsung');
  assert.equal(resolvePhoneBrand({ model: 'Pixel 7' }), 'Google');
});
