import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { getLocalAppVersion } from './appUpdate';

const DEVICE_ID_KEY = 'svetlana.schedule.deviceId.v1';

function randomId() {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing && existing.trim()) return existing.trim();
  } catch {
    /* create new */
  }
  const created = `apk-${Platform.OS}-${randomId()}`;
  await AsyncStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

export function getDeviceProfile() {
  const constants = Platform.constants as {
    Brand?: string;
    Manufacturer?: string;
    Model?: string;
  };
  const brand = String(constants?.Brand || constants?.Manufacturer || '').trim();
  const model = String(constants?.Model || '').trim();
  const deviceName = String(Constants.deviceName || '').trim();
  const name = deviceName || [brand, model].filter(Boolean).join(' ') || `${Platform.OS} device`;
  const local = getLocalAppVersion();
  return {
    name,
    model: model || brand || Platform.OS,
    platform: `${Platform.OS} ${String(Platform.Version)}`,
    appVersion: `${local.versionName} (${local.versionCode})`,
  };
}

export async function buildDeviceHeaders(): Promise<Record<string, string>> {
  const id = await getDeviceId();
  const profile = getDeviceProfile();
  return {
    'X-Device-Id': id,
    'X-Device-Name': profile.name,
    'X-Device-Model': profile.model,
    'X-Device-Platform': profile.platform,
    'X-App-Version': profile.appVersion,
  };
}
