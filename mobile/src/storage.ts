import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppSettings } from './types';

const KEY = 'svetlana.schedule.settings.v1';

export const DEFAULT_SETTINGS: AppSettings = {
  serverUrl: 'http://192.168.1.10:3080',
  masterToken: '',
};

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      serverUrl: String(parsed.serverUrl || DEFAULT_SETTINGS.serverUrl).trim(),
      masterToken: String(parsed.masterToken || DEFAULT_SETTINGS.masterToken).trim(),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await AsyncStorage.setItem(
    KEY,
    JSON.stringify({
      serverUrl: settings.serverUrl.trim().replace(/\/$/, ''),
      masterToken: settings.masterToken.trim(),
    })
  );
}
