import * as FileSystem from 'expo-file-system/legacy';
import type {
  AvailabilityPayload,
  CalculatorPayload,
  CalculatorItem,
  DayPlan,
  PricesPayload,
  PriceItem,
  ServicesPayload,
  ServiceCardItem,
  WorkItem,
} from './types';

function apiBase(serverUrl: string): string {
  return serverUrl.trim().replace(/\/$/, '');
}

export function absoluteUrl(serverUrl: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${apiBase(serverUrl)}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

export async function fetchAvailability(serverUrl: string): Promise<AvailabilityPayload> {
  const res = await fetch(`${apiBase(serverUrl)}/api/availability`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Не удалось загрузить (${res.status})`);
  }
  return res.json();
}

export async function saveAvailability(
  serverUrl: string,
  token: string,
  weekPlan: DayPlan[],
  meta?: AvailabilityPayload['meta']
): Promise<AvailabilityPayload> {
  const res = await fetch(`${apiBase(serverUrl)}/api/availability`, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ weekPlan, meta }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Ошибка сохранения (${res.status})`);
  }
  return body;
}

export async function pingServer(serverUrl: string): Promise<string> {
  const res = await fetch(`${apiBase(serverUrl)}/health`);
  if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
  const data = await res.json();
  return data.status || 'ok';
}

export async function fetchWorks(serverUrl: string): Promise<WorkItem[]> {
  const res = await fetch(`${apiBase(serverUrl)}/api/works`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Не удалось загрузить кадры (${res.status})`);
  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}

export async function uploadWork(
  serverUrl: string,
  token: string,
  uri: string,
  caption: string,
  mimeType = 'image/jpeg'
): Promise<WorkItem> {
  const name = mimeType.includes('png')
    ? 'photo.png'
    : mimeType.includes('webp')
      ? 'photo.webp'
      : 'photo.jpg';

  // Gallery may return content:// — native multipart uploader needs a real file URI.
  let fileUri = uri;
  if (!fileUri.startsWith('file://')) {
    const dest = `${FileSystem.cacheDirectory || ''}upload-${Date.now()}-${name}`;
    await FileSystem.copyAsync({ from: fileUri, to: dest });
    fileUri = dest;
  }

  // Avoid RN FormData ("Unsupported FormDataPart implementation") — use native upload.
  const result = await FileSystem.uploadAsync(`${apiBase(serverUrl)}/api/works`, fileUri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: 'photo',
    mimeType,
    parameters: {
      caption: caption || 'Работа',
    },
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  let body: { error?: string; item?: WorkItem } = {};
  try {
    body = JSON.parse(result.body || '{}');
  } catch {
    body = {};
  }
  if (result.status < 200 || result.status >= 300) {
    throw new Error(body.error || `Ошибка загрузки (${result.status})`);
  }
  if (!body.item) {
    throw new Error('Сервер не вернул загруженное фото');
  }
  return body.item;
}

export async function deleteWork(serverUrl: string, token: string, id: string): Promise<void> {
  const res = await fetch(`${apiBase(serverUrl)}/api/works/${id}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Ошибка удаления (${res.status})`);
}

export async function updateWorkCaption(
  serverUrl: string,
  token: string,
  id: string,
  caption: string
): Promise<WorkItem> {
  const res = await fetch(`${apiBase(serverUrl)}/api/works/${id}`, {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ caption }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Ошибка сохранения названия (${res.status})`);
  if (!body.item) throw new Error('Сервер не вернул обновлённое фото');
  return body.item;
}

export async function fetchPrices(serverUrl: string, token: string): Promise<PricesPayload> {
  const res = await fetch(`${apiBase(serverUrl)}/api/prices`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Не удалось загрузить прайс (${res.status})`);
  return body;
}

export async function savePrices(
  serverUrl: string,
  token: string,
  items: PriceItem[],
  note?: string
): Promise<PricesPayload> {
  if (!Array.isArray(items) || items.length < 1) {
    throw new Error('Нельзя сохранить пустой прайс');
  }
  const payloadItems = items.map((item, index) => ({
    id: item.id,
    name: item.name,
    price: Number(item.price) || 0,
    priceFrom: item.priceFrom !== false,
    unit: item.unit === 'm2' ? 'm2' : 'fixed',
    durationMinutes: Number(item.durationMinutes) || 0,
    sort: Number.isFinite(Number(item.sort)) ? Number(item.sort) : (index + 1) * 10,
    enabled: item.enabled !== false,
  }));
  const res = await fetch(`${apiBase(serverUrl)}/api/prices`, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      meta: note != null ? { note } : undefined,
      items: payloadItems,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Ошибка сохранения прайса (${res.status})`);

  // Re-read public site payload — toast only after the site serves the exact list.
  const verified = await fetch(`${apiBase(serverUrl)}/api/prices`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const verifiedBody = await verified.json().catch(() => ({}));
  if (!verified.ok) {
    throw new Error('Сайт не подтвердил прайс после сохранения');
  }

  const expected = payloadItems.filter((row) => row.enabled !== false);
  const actual = Array.isArray(verifiedBody.items) ? verifiedBody.items : [];
  const expectedIds = new Set(expected.map((row) => row.id));
  const actualIds = new Set(actual.map((row: PriceItem) => row.id));

  for (const item of expected) {
    const found = actual.find((row: PriceItem) => row.id === item.id);
    if (!found || Math.round(Number(found.price)) !== Math.round(item.price)) {
      throw new Error(`Сайт не подтвердил цену «${item.name || item.id}»`);
    }
  }
  for (const id of actualIds) {
    if (!expectedIds.has(id)) {
      throw new Error('На сайте осталась удалённая позиция прайса');
    }
  }
  if (actual.length !== expected.length) {
    throw new Error('Сайт отдал другой набор позиций прайса');
  }
  return body;
}

export async function fetchServices(serverUrl: string): Promise<ServicesPayload> {
  const res = await fetch(`${apiBase(serverUrl)}/api/services`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Не удалось загрузить услуги (${res.status})`);
  return body;
}

export async function saveServices(
  serverUrl: string,
  token: string,
  items: ServiceCardItem[]
): Promise<ServicesPayload> {
  const payloadItems = items.map((item) => ({
    id: item.id,
    price: Number(item.price) || 0,
    priceFrom: item.priceFrom !== false,
    unit: item.unit,
    durationMinutes: item.durationMinutes,
    durationMinutesMax: item.durationMinutesMax,
    durationApprox: item.durationApprox === true,
    durationText: item.durationText || '',
  }));
  const res = await fetch(`${apiBase(serverUrl)}/api/services`, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ items: payloadItems }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Ошибка сохранения услуг (${res.status})`);

  const verified = await fetch(`${apiBase(serverUrl)}/api/services`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const verifiedBody = await verified.json().catch(() => ({}));
  if (!verified.ok) {
    throw new Error('Сайт не подтвердил услуги после сохранения');
  }
  for (const item of payloadItems) {
    const found = (verifiedBody.items || []).find((row: ServiceCardItem) => row.id === item.id);
    const expectedPrice = item.unit === 'request' ? 0 : Math.round(Number(item.price) || 0);
    if (!found || Math.round(Number(found.price)) !== expectedPrice) {
      throw new Error(`Сайт не подтвердил услугу «${item.id}»`);
    }
  }

  // Shared rows (general/windows) must also land in the public price table.
  const pricesCheck = await fetch(`${apiBase(serverUrl)}/api/prices`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (pricesCheck.ok) {
    const pricesBody = await pricesCheck.json().catch(() => ({}));
    for (const item of payloadItems.filter((row) => row.unit !== 'request')) {
      const found = (pricesBody.items || []).find((row: PriceItem) => row.id === item.id);
      if (!found) continue;
      if (Math.round(Number(found.price)) !== Math.round(Number(item.price) || 0)) {
        throw new Error(`Прайс на сайте не подтвердил «${item.id}»`);
      }
    }
  }

  return body;
}

export async function fetchCalculator(serverUrl: string): Promise<CalculatorPayload> {
  const res = await fetch(`${apiBase(serverUrl)}/api/calculator`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Не удалось загрузить калькулятор (${res.status})`);
  return body;
}

export async function saveCalculator(
  serverUrl: string,
  token: string,
  items: CalculatorItem[]
): Promise<CalculatorPayload> {
  const payloadItems = items.map((item, index) => ({
    id: item.id,
    name: item.name,
    sort: Number.isFinite(Number(item.sort)) ? Number(item.sort) : (index + 1) * 10,
    enabled: item.enabled !== false,
    rates: {
      studio: Number(item.rates?.studio) || 0,
      one: Number(item.rates?.one) || 0,
      two: Number(item.rates?.two) || 0,
      three: Number(item.rates?.three) || 0,
    },
  }));
  const res = await fetch(`${apiBase(serverUrl)}/api/calculator`, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ items: payloadItems }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Ошибка сохранения калькулятора (${res.status})`);

  const verified = await fetch(`${apiBase(serverUrl)}/api/calculator`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const verifiedBody = await verified.json().catch(() => ({}));
  if (!verified.ok || !Array.isArray(verifiedBody.items)) {
    throw new Error('Сайт не подтвердил калькулятор после сохранения');
  }

  const expectedIds = new Set(payloadItems.filter((row) => row.enabled !== false).map((row) => row.id));
  const actualIds = new Set(verifiedBody.items.map((row: CalculatorItem) => row.id));
  for (const item of payloadItems.filter((row) => row.enabled !== false)) {
    const found = verifiedBody.items.find((row: CalculatorItem) => row.id === item.id);
    if (!found) throw new Error(`Сайт не подтвердил услугу калькулятора «${item.name}»`);
    for (const size of ['studio', 'one', 'two', 'three'] as const) {
      if (Math.round(Number(found.rates?.[size])) !== Math.round(Number(item.rates[size]))) {
        throw new Error('Сайт не подтвердил суммы калькулятора');
      }
    }
  }
  for (const id of actualIds) {
    if (!expectedIds.has(id)) {
      throw new Error('На сайте осталась удалённая услуга калькулятора');
    }
  }
  return body;
}
