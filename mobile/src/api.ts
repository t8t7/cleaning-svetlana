import type { AvailabilityPayload, DayPlan, WorkItem } from './types';

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
  const form = new FormData();
  const name = mimeType.includes('png') ? 'photo.png' : mimeType.includes('webp') ? 'photo.webp' : 'photo.jpg';
  form.append('photo', {
    uri,
    name,
    type: mimeType,
  } as unknown as Blob);
  form.append('caption', caption);

  const res = await fetch(`${apiBase(serverUrl)}/api/works`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Ошибка загрузки (${res.status})`);
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
