import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppSettings } from './types';

const KEY = 'svetlana.schedule.settings.v3';

export const DEFAULT_SETTINGS: AppSettings = {
  serverUrl: 'https://test-fas.ru',
  masterToken: 'ff0f4d90ce67c5ac0759d9287d3aaed72243aaa9cebf3e9b',
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
