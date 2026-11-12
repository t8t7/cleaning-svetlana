import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';
import type { AppVersionInfo } from './types';

function apiBase(serverUrl: string): string {
  return serverUrl.trim().replace(/\/$/, '');
}

export function getLocalAppVersion(): { versionName: string; versionCode: number } {
  const expoConfig = Constants.expoConfig;
  const versionName = String(expoConfig?.version || '0.0.0');
  const versionCode = Number(expoConfig?.android?.versionCode || 0);
  return {
    versionName,
    versionCode: Number.isFinite(versionCode) ? versionCode : 0,
  };
}

export async function fetchAppVersion(serverUrl: string): Promise<AppVersionInfo> {
  const res = await fetch(`${apiBase(serverUrl)}/api/app-version`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Не удалось проверить обновление (${res.status})`);
  }
  const data = await res.json();
  return {
    versionName: String(data.versionName || ''),
    versionCode: Number(data.versionCode || 0),
    apkReady: Boolean(data.apkReady),
    downloadPath: String(data.downloadPath || '/api/app-apk'),
  };
}

export function hasNewerAppVersion(remote: AppVersionInfo, localCode = getLocalAppVersion().versionCode): boolean {
  return Boolean(remote.apkReady && Number.isFinite(remote.versionCode) && remote.versionCode > localCode);
}

export async function downloadAndInstallApk(serverUrl: string, token: string, downloadPath = '/api/app-apk'): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('Обновление APK доступно только на Android');
  }
  if (!token.trim()) {
    throw new Error('Сначала сохраните MASTER_TOKEN в настройках');
  }

  const path = downloadPath.startsWith('/') ? downloadPath : `/${downloadPath}`;
  const target = `${FileSystem.cacheDirectory || ''}svetlana-schedule-update.apk`;
  const result = await FileSystem.downloadAsync(`${apiBase(serverUrl)}${path}`, target, {
    headers: {
      Accept: 'application/vnd.android.package-archive',
      Authorization: `Bearer ${token.trim()}`,
    },
  });

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Не удалось скачать APK (${result.status})`);
  }

  const contentUri = await FileSystem.getContentUriAsync(result.uri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    flags: 1,
    type: 'application/vnd.android.package-archive',
  });
}
