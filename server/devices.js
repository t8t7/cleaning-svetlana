import fs from 'node:fs/promises';
import path from 'node:path';

function emptyStore() {
  return { items: [] };
}

export async function readDevices(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.items)) return emptyStore();
    return { items: parsed.items };
  } catch {
    return emptyStore();
  }
}

async function writeDevicesAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, filePath);
}

export function sanitizeDeviceId(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9._:-]/g, '')
    .slice(0, 80);
}

export function sanitizeDeviceLabel(value) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 80);
}

export function sanitizeDeviceText(value, max = 80) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

export function publicDevice(item) {
  return {
    id: item.id,
    name: item.name || '',
    model: item.model || '',
    platform: item.platform || '',
    appVersion: item.appVersion || '',
    label: item.label || '',
    blocked: Boolean(item.blocked),
    firstSeenAt: item.firstSeenAt || null,
    lastSeenAt: item.lastSeenAt || null,
    lastIp: item.lastIp || '',
  };
}

export async function touchDevice(filePath, payload) {
  const id = sanitizeDeviceId(payload?.id);
  if (!id) return { ok: false, error: 'Нет ID устройства', status: 400 };

  const data = await readDevices(filePath);
  const now = new Date().toISOString();
  let item = data.items.find((entry) => entry.id === id);
  if (!item) {
    item = {
      id,
      name: sanitizeDeviceText(payload?.name, 80),
      model: sanitizeDeviceText(payload?.model, 80),
      platform: sanitizeDeviceText(payload?.platform, 40),
      appVersion: sanitizeDeviceText(payload?.appVersion, 40),
      label: '',
      blocked: false,
      firstSeenAt: now,
      lastSeenAt: now,
      lastIp: sanitizeDeviceText(payload?.ip, 64),
    };
    data.items.unshift(item);
  } else {
    item.name = sanitizeDeviceText(payload?.name, 80) || item.name || '';
    item.model = sanitizeDeviceText(payload?.model, 80) || item.model || '';
    item.platform = sanitizeDeviceText(payload?.platform, 40) || item.platform || '';
    item.appVersion = sanitizeDeviceText(payload?.appVersion, 40) || item.appVersion || '';
    item.lastSeenAt = now;
    item.lastIp = sanitizeDeviceText(payload?.ip, 64) || item.lastIp || '';
  }

  data.items.sort((a, b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')));
  await writeDevicesAtomic(filePath, data);
  return { ok: true, item: publicDevice(item) };
}

export async function getDevice(filePath, id) {
  const data = await readDevices(filePath);
  const item = data.items.find((entry) => entry.id === sanitizeDeviceId(id));
  return item ? publicDevice(item) : null;
}

export async function listDevices(filePath) {
  const data = await readDevices(filePath);
  return data.items.map(publicDevice);
}

export async function updateDevice(filePath, id, patch) {
  const data = await readDevices(filePath);
  const item = data.items.find((entry) => entry.id === sanitizeDeviceId(id));
  if (!item) return { ok: false, error: 'Устройство не найдено', status: 404 };

  if (Object.prototype.hasOwnProperty.call(patch, 'label')) {
    item.label = sanitizeDeviceLabel(patch.label);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'blocked')) {
    item.blocked = Boolean(patch.blocked);
  }

  await writeDevicesAtomic(filePath, data);
  return { ok: true, item: publicDevice(item) };
}

export async function removeDevice(filePath, id) {
  const data = await readDevices(filePath);
  const before = data.items.length;
  data.items = data.items.filter((entry) => entry.id !== sanitizeDeviceId(id));
  if (data.items.length === before) {
    return { ok: false, error: 'Устройство не найдено', status: 404 };
  }
  await writeDevicesAtomic(filePath, data);
  return { ok: true };
}
