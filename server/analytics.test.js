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

test('detectSource separates maps from search', () => {
  assert.equal(detectSource({ utmSource: '2gis' }), '2gis');
  assert.equal(detectSource({ referrer: 'https://2gis.ru/moscow/firm/1' }), '2gis');
  assert.equal(detectSource({ utmSource: 'google_maps' }), 'google_maps');
  assert.equal(detectSource({ utmSource: 'google', utmMedium: 'maps' }), 'google_maps');
  assert.equal(detectSource({ referrer: 'https://www.google.com/maps' }), 'google_maps');
  assert.equal(detectSource({ utmSource: 'yandex_maps' }), 'yandex_maps');
  assert.equal(detectSource({ referrer: 'https://yandex.ru/maps/org/1' }), 'yandex_maps');
  assert.equal(detectSource({ referrer: 'https://www.google.com/search?q=x' }), 'google');
  assert.equal(detectSource({ referrer: 'https://yandex.ru/search/?text=x' }), 'yandex');
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
  const c = normalizeEventInput(
    { type: 'price_dwell', visitorId: 'visitor123456', device: 'phone', source: 'avito', ms: 12000 },
    { ip: '10.0.0.1', userAgent: 'Mozilla' }
  );
  const short = normalizeEventInput(
    { type: 'schedule_dwell', visitorId: 'visitor123456', device: 'phone', source: 'avito', ms: 500 },
    { ip: '10.0.0.1', userAgent: 'Mozilla' }
  );
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(c.ok, true);
  assert.equal(short.ok, false);
  assert.equal(c.event.ms, 12000);
  assert.match(a.event.ipHash, /^[a-f0-9]{16}$/);
  await appendAnalyticsEvent(dir, a.event);
  await appendAnalyticsEvent(dir, b.event);
  await appendAnalyticsEvent(dir, c.event);

  const period = parsePeriod({ period: '30d' });
  assert.equal(period.ok, true);
  const events = await readAnalyticsEvents(dir, period.from, period.to);
  assert.equal(events.length, 3);
  const summary = summarizeAnalytics(events);
  assert.equal(summary.visits, 1);
  assert.equal(summary.calls, 1);
  assert.equal(summary.unique, 1);
  assert.equal(summary.priceSec, 12);
  assert.equal(summary.attention.top, 'prices');
  assert.ok(summary.conversion > 0);

  const buffer = await buildAnalyticsWorkbook(summary, events, {
    from: period.from,
    to: period.to,
  });
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 1000);
});
