import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  absoluteUrl,
  deleteWork,
  fetchAvailability,
  fetchWorks,
  pingServer,
  saveAvailability,
  uploadWork,
} from './src/api';
import {
  downloadAndInstallApk,
  fetchAppVersion,
  getLocalAppVersion,
  hasNewerAppVersion,
} from './src/appUpdate';
import {
  WORK_END,
  WORK_START,
  deriveStatus,
  formatHour,
  hourBusy,
  setDayFullyBusy,
  setDayFullyFree,
  toggleHour,
} from './src/schedule';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './src/storage';
import type { AppSettings, AppVersionInfo, AvailabilityPayload, DayPlan, WorkItem } from './src/types';

type Tab = 'schedule' | 'frames' | 'settings';

const localAppVersion = getLocalAppVersion();

export default function App() {
  const [tab, setTab] = useState<Tab>('schedule');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [draftSettings, setDraftSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [weekPlan, setWeekPlan] = useState<DayPlan[]>([]);
  const [meta, setMeta] = useState<AvailabilityPayload['meta'] | null>(null);
  const [liveTitle, setLiveTitle] = useState('Загрузка…');
  const [liveDetail, setLiveDetail] = useState('');
  const [selectedKey, setSelectedKey] = useState<string>('mon');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [dirty, setDirty] = useState(false);
  const [works, setWorks] = useState<WorkItem[]>([]);
  const [worksLoading, setWorksLoading] = useState(false);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [remoteVersion, setRemoteVersion] = useState<AppVersionInfo | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateInstalling, setUpdateInstalling] = useState(false);

  const selectedDay = useMemo(
    () => weekPlan.find((d) => d.key === selectedKey) || weekPlan[0],
    [weekPlan, selectedKey]
  );

  const applyPayload = useCallback((data: AvailabilityPayload) => {
    setWeekPlan(data.weekPlan);
    setMeta(data.meta);
    setLiveTitle(data.live?.title || 'Сейчас свободна');
    setLiveDetail(data.live?.detail || '');
    setSelectedKey(data.live?.today?.key || data.weekPlan[0]?.key || 'mon');
    setDirty(false);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const data = await fetchAvailability(settings.serverUrl);
      applyPayload(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [applyPayload, settings.serverUrl]);

  const refreshWorks = useCallback(async () => {
    setWorksLoading(true);
    try {
      const items = await fetchWorks(settings.serverUrl);
      setWorks(items);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка загрузки кадров');
    } finally {
      setWorksLoading(false);
    }
  }, [settings.serverUrl]);

  const updateAvailable = Boolean(remoteVersion && hasNewerAppVersion(remoteVersion));

  const checkForAppUpdate = useCallback(async (serverUrl = settings.serverUrl) => {
    if (!serverUrl.trim()) return;
    setUpdateChecking(true);
    try {
      const remote = await fetchAppVersion(serverUrl);
      setRemoteVersion(remote);
    } catch {
      /* keep last known state; offline should not scare the master */
    } finally {
      setUpdateChecking(false);
    }
  }, [settings.serverUrl]);

  const onInstallAppUpdate = useCallback(async () => {
    if (!updateAvailable || !remoteVersion) return;
    setUpdateInstalling(true);
    setMessage('');
    try {
      await downloadAndInstallApk(
        settings.serverUrl,
        settings.masterToken,
        remoteVersion.downloadPath
      );
      setMessage('Откройте установщик и подтвердите обновление');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка обновления');
    } finally {
      setUpdateInstalling(false);
    }
  }, [remoteVersion, settings.masterToken, settings.serverUrl, updateAvailable]);

  useEffect(() => {
    (async () => {
      const loaded = await loadSettings();
      setSettings(loaded);
      setDraftSettings(loaded);
    })();
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    checkForAppUpdate();
  }, [checkForAppUpdate]);

  useEffect(() => {
    if (tab === 'frames') refreshWorks();
  }, [tab, refreshWorks]);

  const updateDay = (next: DayPlan) => {
    setWeekPlan((prev) =>
      prev.map((d) => (d.key === next.key ? { ...next, status: deriveStatus(next.busyRanges) } : d))
    );
    setDirty(true);
  };

  const onToggleHour = (hour: number) => {
    if (!selectedDay) return;
    const busyRanges = toggleHour(selectedDay.busyRanges, hour);
    updateDay({ ...selectedDay, busyRanges });
  };

  const onSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const data = await saveAvailability(
        settings.serverUrl,
        settings.masterToken,
        weekPlan,
        meta || undefined
      );
      applyPayload(data);
      setMessage('Расписание обновлено на сайте');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const onSaveSettings = async () => {
    const next = {
      serverUrl: draftSettings.serverUrl.trim().replace(/\/$/, ''),
      masterToken: draftSettings.masterToken.trim(),
    };
    await saveSettings(next);
    setSettings(next);
    setDraftSettings(next);
    setMessage('Настройки сохранены');
    setTab('schedule');
    checkForAppUpdate(next.serverUrl);
  };

  const onPing = async () => {
    try {
      const status = await pingServer(draftSettings.serverUrl.trim().replace(/\/$/, ''));
      setMessage(`Связь OK: ${status}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Нет связи');
    }
  };

  const onPickAndUpload = async () => {
    if (!settings.masterToken) {
      setMessage('Сначала укажите токен в настройках');
      setTab('settings');
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage('Нужен доступ к галерее');
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: true,
    });
    if (picked.canceled || !picked.assets?.[0]) return;

    const asset = picked.assets[0];
    setUploading(true);
    setMessage('');
    try {
      await uploadWork(
        settings.serverUrl,
        settings.masterToken,
        asset.uri,
        caption.trim() || 'Работа',
        asset.mimeType || 'image/jpeg'
      );
      setCaption('');
      setMessage('Фото добавлено в «Чистые кадры»');
      await refreshWorks();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка загрузки');
    } finally {
      setUploading(false);
    }
  };

  const onDeleteWork = (item: WorkItem) => {
    Alert.alert('Удалить кадр?', item.caption || 'Фото будет удалено с сайта', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteWork(settings.serverUrl, settings.masterToken, item.id);
            setMessage('Кадр удалён');
            await refreshWorks();
          } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Ошибка удаления');
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.brand}>Светлана</Text>
        <Text style={styles.subtitle}>Расписание и чистые кадры</Text>
      </View>

      <View style={styles.tabs}>
        <Pressable
          style={[styles.tab, tab === 'schedule' && styles.tabActive]}
          onPress={() => setTab('schedule')}
        >
          <Text style={[styles.tabText, tab === 'schedule' && styles.tabTextActive]}>График</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, tab === 'frames' && styles.tabActive]}
          onPress={() => setTab('frames')}
        >
          <Text style={[styles.tabText, tab === 'frames' && styles.tabTextActive]}>Кадры</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, tab === 'settings' && styles.tabActive]}
          onPress={() => setTab('settings')}
        >
          <View style={styles.tabLabelRow}>
            <Text style={[styles.tabText, tab === 'settings' && styles.tabTextActive]}>Настройки</Text>
            {updateAvailable ? <View style={styles.tabBadge} /> : null}
          </View>
        </Pressable>
      </View>

      {tab === 'schedule' ? (
        <ScrollView contentContainerStyle={styles.content}>
          {updateAvailable ? (
            <View style={styles.updateBanner}>
              <Text style={styles.updateBannerTitle}>Доступно обновление</Text>
              <Text style={styles.updateBannerText}>
                На сайте новая версия {remoteVersion?.versionName}. Установите, чтобы получить свежие
                улучшения.
              </Text>
              <Pressable
                style={[styles.primaryBtn, updateInstalling && styles.btnDisabled]}
                onPress={onInstallAppUpdate}
                disabled={updateInstalling}
              >
                <Text style={styles.primaryText}>
                  {updateInstalling ? 'Скачивание…' : `Обновить до ${remoteVersion?.versionName}`}
                </Text>
              </Pressable>
            </View>
          ) : null}

          <View
            style={[
              styles.liveCard,
              liveTitle.includes('занят') || liveTitle.includes('Занят')
                ? styles.liveBusy
                : styles.liveFree,
            ]}
          >
            <Text style={styles.liveTitle}>{liveTitle}</Text>
            <Text style={styles.liveDetail}>{liveDetail}</Text>
            {meta?.updatedAt ? (
              <Text style={styles.liveMeta}>
                Обновлено: {new Date(meta.updatedAt).toLocaleString('ru-RU')}
              </Text>
            ) : null}
          </View>

          {loading ? (
            <ActivityIndicator color="#0f766e" style={{ marginTop: 24 }} />
          ) : (
            <>
              <Text style={styles.sectionLabel}>Неделя</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.weekRow}>
                {weekPlan.map((day) => {
                  const active = day.key === selectedDay?.key;
                  return (
                    <Pressable
                      key={day.key}
                      style={[styles.dayChip, active && styles.dayChipActive]}
                      onPress={() => setSelectedKey(day.key)}
                    >
                      <Text style={styles.dayName}>{day.label}</Text>
                      <Text style={styles.dayDate}>{day.shortDate}</Text>
                      <Text style={styles.dayState}>
                        {day.status === 'free'
                          ? 'Свободно'
                          : day.status === 'busy'
                            ? 'Занято'
                            : 'Частично'}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {selectedDay ? (
                <>
                  <View style={styles.quickRow}>
                    <Pressable
                      style={styles.quickBtn}
                      onPress={() => updateDay(setDayFullyFree(selectedDay))}
                    >
                      <Text style={styles.quickText}>Весь день свободен</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.quickBtn, styles.quickBusy]}
                      onPress={() => updateDay(setDayFullyBusy(selectedDay))}
                    >
                      <Text style={styles.quickText}>Весь день занят</Text>
                    </Pressable>
                  </View>

                  <Text style={styles.sectionLabel}>
                    {selectedDay.label}, {selectedDay.shortDate} — нажмите час
                  </Text>
                  <View style={styles.slots}>
                    {Array.from({ length: WORK_END - WORK_START }, (_, i) => {
                      const hour = WORK_START + i;
                      const busy = hourBusy(selectedDay.busyRanges, hour);
                      return (
                        <Pressable
                          key={hour}
                          style={[styles.slot, busy ? styles.slotBusy : styles.slotFree]}
                          onPress={() => onToggleHour(hour)}
                        >
                          <View style={[styles.dot, busy ? styles.dotBusy : styles.dotFree]} />
                          <Text style={styles.slotTime}>
                            {formatHour(hour)}–{formatHour(hour + 1)}
                          </Text>
                          <Text style={styles.slotStatus}>{busy ? 'Занято' : 'Свободно'}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}

              <View style={styles.actions}>
                <Pressable style={styles.secondaryBtn} onPress={refresh} disabled={loading || saving}>
                  <Text style={styles.secondaryText}>Обновить</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryBtn, (!dirty || saving) && styles.btnDisabled]}
                  onPress={onSave}
                  disabled={!dirty || saving}
                >
                  <Text style={styles.primaryText}>
                    {saving ? 'Сохранение…' : 'Сохранить на сайт'}
                  </Text>
                </Pressable>
              </View>
            </>
          )}

          {message ? <Text style={styles.message}>{message}</Text> : null}
        </ScrollView>
      ) : null}

      {tab === 'frames' ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.sectionLabel}>Чистые кадры</Text>
          <Text style={styles.hint}>
            Загрузите фото работ — клиенты увидят их на сайте и смогут поставить оценку.
          </Text>

          <TextInput
            style={styles.input}
            value={caption}
            onChangeText={setCaption}
            placeholder="Подпись: кухня, окна, после ремонта…"
            maxLength={120}
          />

          <Pressable
            style={[styles.primaryBtn, uploading && styles.btnDisabled]}
            onPress={onPickAndUpload}
            disabled={uploading}
          >
            <Text style={styles.primaryText}>
              {uploading ? 'Загрузка…' : 'Выбрать фото и загрузить'}
            </Text>
          </Pressable>

          <View style={[styles.actions, { marginTop: 12 }]}>
            <Pressable style={styles.secondaryBtn} onPress={refreshWorks} disabled={worksLoading}>
              <Text style={styles.secondaryText}>Обновить список</Text>
            </Pressable>
          </View>

          {worksLoading ? <ActivityIndicator color="#0f766e" style={{ marginTop: 20 }} /> : null}

          <View style={styles.worksList}>
            {works.map((item) => (
              <View key={item.id} style={styles.workCard}>
                <Image
                  source={{ uri: absoluteUrl(settings.serverUrl, item.url) }}
                  style={styles.workImage}
                />
                <View style={styles.workBody}>
                  <Text style={styles.workCaption}>{item.caption}</Text>
                  <Text style={styles.workMeta}>
                    ★ {Number(item.avgRating || 0).toFixed(1)} · {item.ratingCount || 0} оценок
                  </Text>
                  <Pressable style={styles.deleteBtn} onPress={() => onDeleteWork(item)}>
                    <Text style={styles.deleteText}>Удалить</Text>
                  </Pressable>
                </View>
              </View>
            ))}
            {!worksLoading && works.length === 0 ? (
              <Text style={styles.hint}>Пока нет загруженных кадров.</Text>
            ) : null}
          </View>

          {message ? <Text style={styles.message}>{message}</Text> : null}
        </ScrollView>
      ) : null}

      {tab === 'settings' ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.sectionLabel}>Адрес сайта / API</Text>
          <Text style={styles.hint}>
            Боевой сервер: https://test-fas.ru (для локальной отладки — http://IP_ПК:3080)
          </Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            value={draftSettings.serverUrl}
            onChangeText={(serverUrl) => setDraftSettings((s) => ({ ...s, serverUrl }))}
            placeholder="https://test-fas.ru"
          />

          <Text style={styles.sectionLabel}>Токен мастера</Text>
          <Text style={styles.hint}>Тот же MASTER_TOKEN, что в .env на VPS</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            value={draftSettings.masterToken}
            onChangeText={(masterToken) => setDraftSettings((s) => ({ ...s, masterToken }))}
            placeholder="MASTER_TOKEN с сервера"
          />

          <View style={styles.actions}>
            <Pressable style={styles.secondaryBtn} onPress={onPing}>
              <Text style={styles.secondaryText}>Проверить связь</Text>
            </Pressable>
            <Pressable style={styles.primaryBtn} onPress={onSaveSettings}>
              <Text style={styles.primaryText}>Сохранить</Text>
            </Pressable>
          </View>

          <Text style={styles.sectionLabel}>Версия приложения</Text>
          <Text style={styles.hint}>
            Сейчас установлена {localAppVersion.versionName} (код {localAppVersion.versionCode})
            {remoteVersion
              ? `. На сервере: ${remoteVersion.versionName} (код ${remoteVersion.versionCode})`
              : ''}
          </Text>
          <Pressable
            style={[
              styles.primaryBtn,
              (!updateAvailable || updateInstalling) && styles.updateBtnDisabled,
            ]}
            onPress={onInstallAppUpdate}
            disabled={!updateAvailable || updateInstalling}
          >
            <Text
              style={[
                styles.primaryText,
                (!updateAvailable || updateInstalling) && styles.updateBtnDisabledText,
              ]}
            >
              {updateInstalling
                ? 'Скачивание…'
                : updateAvailable
                  ? `Обновить до ${remoteVersion?.versionName}`
                  : updateChecking
                    ? 'Проверка обновлений…'
                    : 'Обновлений нет'}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.secondaryBtn, { marginTop: 10 }]}
            onPress={() => checkForAppUpdate()}
            disabled={updateChecking || updateInstalling}
          >
            <Text style={styles.secondaryText}>Проверить обновление</Text>
          </Pressable>

          {message ? <Text style={styles.message}>{message}</Text> : null}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f0fdfa' },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  brand: { fontSize: 28, fontWeight: '800', color: '#115e59' },
  subtitle: { color: '#64748b', marginTop: 2 },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 4,
    borderWidth: 1,
    borderColor: '#d1e7e3',
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: '#ecfdf5' },
  tabLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabText: { color: '#64748b', fontWeight: '600', fontSize: 13 },
  tabTextActive: { color: '#0f766e' },
  tabBadge: {
    width: 8,
    height: 8,
    borderRadius: 99,
    backgroundColor: '#ea580c',
  },
  content: { padding: 16, paddingBottom: 40 },
  updateBanner: {
    backgroundColor: '#fff7ed',
    borderColor: '#fdba74',
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
    gap: 8,
  },
  updateBannerTitle: { color: '#9a3412', fontWeight: '800', fontSize: 17 },
  updateBannerText: { color: '#9a3412', opacity: 0.9, marginBottom: 4 },
  updateBtnDisabled: { backgroundColor: '#cbd5e1', shadowOpacity: 0 },
  updateBtnDisabledText: { color: '#64748b' },
  liveCard: { borderRadius: 18, padding: 16, marginBottom: 16 },
  liveFree: { backgroundColor: '#0f766e' },
  liveBusy: { backgroundColor: '#9a3412' },
  liveTitle: { color: '#fff', fontSize: 22, fontWeight: '800' },
  liveDetail: { color: '#fff', opacity: 0.92, marginTop: 6 },
  liveMeta: { color: '#fff', opacity: 0.75, marginTop: 10, fontSize: 12 },
  sectionLabel: { fontWeight: '700', color: '#115e59', marginBottom: 8, marginTop: 4 },
  hint: { color: '#64748b', marginBottom: 8, fontSize: 13 },
  weekRow: { marginBottom: 12 },
  dayChip: {
    width: 78,
    marginRight: 8,
    borderRadius: 14,
    padding: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1e7e3',
  },
  dayChipActive: { borderColor: '#0f766e', backgroundColor: '#ecfdf5' },
  dayName: { fontWeight: '800', color: '#115e59' },
  dayDate: { color: '#64748b', fontSize: 12, marginTop: 2 },
  dayState: { fontSize: 11, fontWeight: '700', marginTop: 6, color: '#0f766e' },
  quickRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  quickBtn: {
    flex: 1,
    backgroundColor: '#22c55e',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  quickBusy: { backgroundColor: '#ea580c' },
  quickText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  slots: { gap: 8 },
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  slotFree: { backgroundColor: '#ecfdf5', borderColor: '#bbf7d0' },
  slotBusy: { backgroundColor: '#fff7ed', borderColor: '#fed7aa' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotFree: { backgroundColor: '#22c55e' },
  dotBusy: { backgroundColor: '#ea580c' },
  slotTime: { flex: 1, fontWeight: '600', color: '#1e293b' },
  slotStatus: { fontWeight: '700', color: '#334155' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 18 },
  primaryBtn: {
    backgroundColor: '#84cc16',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    flex: 1,
  },
  primaryText: { color: '#115e59', fontWeight: '800' },
  secondaryBtn: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#d1e7e3',
  },
  secondaryText: { color: '#0f766e', fontWeight: '700' },
  btnDisabled: { opacity: 0.5 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1e7e3',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 14,
  },
  message: { marginTop: 14, color: '#115e59', fontWeight: '600' },
  worksList: { marginTop: 18, gap: 12 },
  workCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#d1e7e3',
  },
  workImage: { width: '100%', height: 180, backgroundColor: '#ecfdf5' },
  workBody: { padding: 12 },
  workCaption: { fontWeight: '700', color: '#115e59', marginBottom: 4 },
  workMeta: { color: '#64748b', marginBottom: 10 },
  deleteBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff7ed',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  deleteText: { color: '#9a3412', fontWeight: '700' },
});
