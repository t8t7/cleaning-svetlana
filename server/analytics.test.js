import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  appendAnalyticsEvent,
  buildAnalyticsWorkbook,
  detectSource,
  normalizeEventInput,
  parsePeriod,
  readAnalyticsEvents,
  summarizeAnalytics,
} from './analytics.js';

test('detectSource understands avito search and vk', () => {
  assert.equal(detectSource({ referrer: 'https://www.avito.ru/x' }), 'avito');
  assert.equal(detectSource({ utmSource: 'yandex' }), 'yandex');
  assert.equal(detectSource({ referrer: 'https://vk.com/club1' }), 'vk');
  assert.equal(detectSource({ utmSource: 'vk' }), 'vk');
  assert.equal(detectSource({ referrer: '' }), 'direct');
});

test('normalizeEventInput rejects unknown type', () => {
  const bad = normalizeEventInput({ type: 'scroll' }, { ip: '1.2.3.4' });
  assert.equal(bad.ok, false);
});

test('append read summarize and excel', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-analytics-'));
  const a = normalizeEventInput(
    { type: 'page_view', visitorId: 'visitor123456', device: 'phone', source: 'avito' },
    { ip: '10.0.0.1', userAgent: 'Mozilla' }
  );
  const b = normalizeEventInput(
    { type: 'call_click', visitorId: 'visitor123456', device: 'phone', source: 'avito' },
    { ip: '10.0.0.1', userAgent: 'Mozilla' }
  );
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.match(a.event.ipHash, /^[a-f0-9]{16}$/);
  await appendAnalyticsEvent(dir, a.event);
  await appendAnalyticsEvent(dir, b.event);

  const period = parsePeriod({ period: '30d' });
  assert.equal(period.ok, true);
  const events = await readAnalyticsEvents(dir, period.from, period.to);
  assert.equal(events.length, 2);
  const summary = summarizeAnalytics(events);
  assert.equal(summary.visits, 1);
  assert.equal(summary.calls, 1);
  assert.equal(summary.unique, 1);
  assert.ok(summary.conversion > 0);

  const buffer = await buildAnalyticsWorkbook(summary, events, {
    from: period.from,
    to: period.to,
  });
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 1000);
});
