import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Modal,
  Platform,
  Pressable,
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
  syncDevice,
  updateWorkCaption,
  uploadWork,
} from './src/api';
import { getDeviceId, getDeviceProfile } from './src/device';
import {
  downloadAndInstallApk,
  fetchAppVersion,
  getLocalAppVersion,
  hasNewerAppVersion,
} from './src/appUpdate';
import { PricesPanel } from './src/PricesPanel';
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

type Tab = 'schedule' | 'prices' | 'frames' | 'settings';
type ToastKind = 'ok' | 'err';

const localAppVersion = getLocalAppVersion();
const TOAST_MS = 4200;
/** While app is open — ask server often; timers freeze in background/doze. */
const UPDATE_POLL_MS = 20_000;
/** Don't spam the version endpoint on rapid focus events. */
const UPDATE_MIN_GAP_MS = 8_000;
/** System bars already inset the window; only a small header gap + toast lift. */
const TOP_PAD = Platform.OS === 'android' ? 6 : 12;
const TOAST_BOTTOM = Platform.OS === 'android' ? 16 : 12;

export default function App() {
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const lastUpdateCheckAt = useRef(0);
  const [tab, setTab] = useState<Tab>('schedule');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [draftSettings, setDraftSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [weekPlan, setWeekPlan] = useState<DayPlan[]>([]);
  const [meta, setMeta] = useState<AvailabilityPayload['meta'] | null>(null);
  const [liveTitle, setLiveTitle] = useState('Загрузка…');
  const [selectedKey, setSelectedKey] = useState<string>('mon');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [toast, setToast] = useState<{ text: string; kind: ToastKind } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [works, setWorks] = useState<WorkItem[]>([]);
  const [worksLoading, setWorksLoading] = useState(false);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [editWork, setEditWork] = useState<WorkItem | null>(null);
  const [editCaption, setEditCaption] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [deviceBlocked, setDeviceBlocked] = useState(false);
  const [deviceLabel, setDeviceLabel] = useState('');
  const [deviceInfoLine, setDeviceInfoLine] = useState('');
  const [remoteVersion, setRemoteVersion] = useState<AppVersionInfo | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateInstalling, setUpdateInstalling] = useState(false);

  const showToast = useCallback((text: string, kind: ToastKind = 'ok', ms = TOAST_MS) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, kind });
    toastTimer.current = setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, ms);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const selectedDay = useMemo(
    () => weekPlan.find((d) => d.key === selectedKey) || weekPlan[0],
    [weekPlan, selectedKey]
  );

  const applyPayload = useCallback((data: AvailabilityPayload) => {
    setWeekPlan(data.weekPlan);
    setMeta(data.meta);
    setLiveTitle(data.live?.title || 'Сейчас свободна');
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

  const checkForAppUpdate = useCallback(
    async (serverUrl = settings.serverUrl, opts?: { quiet?: boolean; force?: boolean }) => {
      if (!serverUrl.trim()) return;
      const now = Date.now();
      if (!opts?.force && now - lastUpdateCheckAt.current < UPDATE_MIN_GAP_MS) return;
      lastUpdateCheckAt.current = now;
      if (!opts?.quiet) setUpdateChecking(true);
      try {
        const remote = await fetchAppVersion(serverUrl);
        setRemoteVersion(remote);
      } catch {
        /* keep last known state; offline should not scare the master */
      } finally {
        if (!opts?.quiet) setUpdateChecking(false);
      }
    },
    [settings.serverUrl]
  );

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
      try {
        const id = await getDeviceId();
        const profile = getDeviceProfile();
        setDeviceInfoLine(`${profile.name} · ${id.slice(0, 12)}…`);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const runDeviceSync = useCallback(async () => {
    if (!settings.serverUrl.trim() || !settings.masterToken.trim()) return;
    try {
      const result = await syncDevice(settings.serverUrl, settings.masterToken);
      setDeviceBlocked(false);
      setDeviceLabel(result.device?.label || '');
      if (result.masterToken && result.masterToken !== settings.masterToken) {
        const next = { ...settings, masterToken: result.masterToken };
        setSettings(next);
        setDraftSettings((prev) => ({ ...prev, masterToken: result.masterToken }));
        await saveSettings(next);
        showToast('Токен обновлён с сервера');
      }
    } catch (error) {
      const blocked = Boolean((error as { blocked?: boolean })?.blocked);
      if (blocked) {
        setDeviceBlocked(true);
        showToast('Это устройство заблокировано', 'err');
      }
    }
  }, [settings, showToast]);

  useEffect(() => {
    if (!settings.serverUrl.trim() || !settings.masterToken.trim()) return;
    runDeviceSync();
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') runDeviceSync();
    }, 20000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') runDeviceSync();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [runDeviceSync, settings.masterToken, settings.serverUrl]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    checkForAppUpdate(undefined, { force: true, quiet: true });
    const pollId = setInterval(() => {
      // setInterval is paused while the phone sleeps; when JS wakes, poll again.
      if (AppState.currentState === 'active') {
        checkForAppUpdate(undefined, { quiet: true });
      }
    }, UPDATE_POLL_MS);
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      // Unlock / return from background: always re-check (force bypasses min-gap).
      if (next === 'active' && prev !== 'active') {
        checkForAppUpdate(undefined, { force: true, quiet: true });
        refresh();
      }
    });
    return () => {
      clearInterval(pollId);
      sub.remove();
    };
  }, [checkForAppUpdate, refresh]);

  useEffect(() => {
    // Switching tabs also re-asks the server (covers OEM lock screens that never leave "active").
    checkForAppUpdate(undefined, { quiet: true });
    if (tab === 'frames') refreshWorks();
  }, [tab, refreshWorks, checkForAppUpdate]);

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
      const dayLabel = selectedDay
        ? `${selectedDay.label}, ${selectedDay.shortDate}`
        : 'выбранный день';
      showToast(`Сайт подтвердил: изменения по часам сохранены (${dayLabel})`);
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Ошибка сохранения';
      setMessage(text);
      showToast(text, 'err');
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
      await pingServer(draftSettings.serverUrl.trim().replace(/\/$/, ''));
      showToast('Связь с сайтом есть');
      setMessage('');
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Нет связи с сайтом';
      setMessage(text);
      showToast(text, 'err');
    }
  };

  const onPickAndUpload = async () => {
    if (!settings.masterToken) {
      showToast('Сначала укажите токен в настройках', 'err');
      setTab('settings');
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast('Нужен доступ к галерее', 'err');
      return;
    }

    // No Android crop/rotate screen — pick photo and upload straight to the site.
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: false,
      exif: false,
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
      await refreshWorks();
      showToast('Сайт подтвердил: фото загружено');
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Ошибка загрузки фото';
      setMessage(text);
      showToast(text, 'err');
    } finally {
      setUploading(false);
    }
  };

  const onEditWork = (item: WorkItem) => {
    setEditWork(item);
    setEditCaption(item.caption || '');
  };

  const onSaveEditWork = async () => {
    if (!editWork) return;
    const next = editCaption.trim();
    if (!next) {
      showToast('Введите название фото', 'err');
      return;
    }
    if (!settings.masterToken.trim()) {
      showToast('Сначала укажите токен в настройках', 'err');
      setTab('settings');
      return;
    }

    setEditSaving(true);
    try {
      await updateWorkCaption(
        settings.serverUrl,
        settings.masterToken,
        editWork.id,
        next
      );
      setEditWork(null);
      await refreshWorks();
      showToast('Сайт подтвердил: название обновлено');
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Ошибка сохранения названия';
      setMessage(text);
      showToast(text, 'err');
    } finally {
      setEditSaving(false);
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
            await refreshWorks();
            showToast('Сайт подтвердил: фото удалено');
          } catch (error) {
            const text = error instanceof Error ? error.message : 'Ошибка удаления';
            setMessage(text);
            showToast(text, 'err');
          }
        },
      },
    ]);
  };

  return (
    <View style={[styles.safe, { paddingTop: TOP_PAD }]}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.brand}>Светлана</Text>
        <Text style={styles.subtitle}>График, цены и фото</Text>
        {deviceBlocked ? (
          <Text style={styles.blockedBanner}>
            Это устройство заблокировано в админке. Управление сайтом недоступно.
          </Text>
        ) : null}
      </View>

      <View style={styles.tabs}>
        <Pressable
          style={[styles.tab, tab === 'schedule' && styles.tabActive]}
          onPress={() => setTab('schedule')}
        >
          <Text style={[styles.tabText, tab === 'schedule' && styles.tabTextActive]}>График</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, tab === 'prices' && styles.tabActive]}
          onPress={() => setTab('prices')}
        >
          <Text style={[styles.tabText, tab === 'prices' && styles.tabTextActive]}>Цены</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, tab === 'frames' && styles.tabActive]}
          onPress={() => setTab('frames')}
        >
          <Text style={[styles.tabText, tab === 'frames' && styles.tabTextActive]}>Фото</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, tab === 'settings' && styles.tabActive]}
          onPress={() => setTab('settings')}
        >
          <View style={styles.tabLabelRow}>
            <Text style={[styles.tabText, tab === 'settings' && styles.tabTextActive]}>Настр.</Text>
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
          </View>

          {loading ? (
            <ActivityIndicator color="#0f766e" style={{ marginTop: 24 }} />
          ) : (
            <>
              <Text style={styles.sectionLabel}>Неделя</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.weekRow}>
                {weekPlan.map((day) => {
                  const active = day.key === selectedDay?.key;
                  const stateStyle =
                    day.status === 'busy'
                      ? styles.dayStateBusy
                      : day.status === 'partial'
                        ? styles.dayStatePartial
                        : styles.dayStateFree;
                  return (
                    <Pressable
                      key={day.key}
                      style={[styles.dayChip, active && styles.dayChipActive]}
                      onPress={() => setSelectedKey(day.key)}
                    >
                      <Text style={styles.dayName}>{day.label}</Text>
                      <Text style={styles.dayDate}>{day.shortDate}</Text>
                      <Text style={[styles.dayState, stateStyle]} numberOfLines={1}>
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

              <Pressable
                style={[styles.primaryBtn, (!dirty || saving) && styles.btnDisabled, { marginTop: 8 }]}
                onPress={onSave}
                disabled={!dirty || saving}
              >
                <Text style={styles.primaryText}>
                  {saving ? 'Сохранение…' : 'Сохранить на сайт'}
                </Text>
              </Pressable>
            </>
          )}

          {message && !toast ? <Text style={styles.message}>{message}</Text> : null}
        </ScrollView>
      ) : null}

      {tab === 'prices' ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <PricesPanel
            serverUrl={settings.serverUrl}
            masterToken={settings.masterToken}
            onToast={showToast}
            onNeedSettings={() => setTab('settings')}
          />
        </ScrollView>
      ) : null}

      {tab === 'frames' ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.sectionLabel}>Фото работ</Text>
          <Text style={styles.hint}>
            Выберите фото с телефона — оно сразу уйдёт на сайт в блок «Фото работ». Подпись
            необязательна.
          </Text>

          <TextInput
            style={styles.input}
            value={caption}
            onChangeText={setCaption}
            placeholder="Подпись: кухня, окна, после ремонта…"
            maxLength={120}
          />

          <Pressable
            style={[styles.primaryBtn, uploading && styles.btnDisabled, { marginBottom: 12 }]}
            onPress={onPickAndUpload}
            disabled={uploading}
          >
            <Text style={styles.primaryText}>
              {uploading ? 'Загрузка на сайт…' : 'Выбрать фото и загрузить на сайт'}
            </Text>
          </Pressable>

          {worksLoading ? <ActivityIndicator color="#0f766e" style={{ marginTop: 12 }} /> : null}

          <View style={styles.worksList}>
            {works.map((item) => (
              <View key={item.id} style={styles.workCard}>
                <Image
                  source={{ uri: absoluteUrl(settings.serverUrl, item.url) }}
                  style={styles.workImage}
                />
                <View style={styles.workBody}>
                  <Text style={styles.workCaption}>{item.caption}</Text>
                  <View style={styles.workActions}>
                    <Pressable style={styles.editBtn} onPress={() => onEditWork(item)}>
                      <Text style={styles.editText}>Редактировать</Text>
                    </Pressable>
                    <Pressable style={styles.deleteBtn} onPress={() => onDeleteWork(item)}>
                      <Text style={styles.deleteText}>Удалить</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
            {!worksLoading && works.length === 0 ? (
              <Text style={styles.hint}>Пока нет загруженных фото — нажмите кнопку выше.</Text>
            ) : null}
          </View>

          {message && !toast ? <Text style={styles.message}>{message}</Text> : null}
        </ScrollView>
      ) : null}

      {tab === 'settings' ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.sectionLabel}>Настройки</Text>
          <Text style={styles.sectionLabel}>Адрес сайта / API</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            value={draftSettings.serverUrl}
            onChangeText={(serverUrl) => setDraftSettings((s) => ({ ...s, serverUrl }))}
            placeholder="https://test-fas.ru"
          />

          <Text style={styles.sectionLabel}>Токен мастера</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            value={draftSettings.masterToken}
            onChangeText={(masterToken) => setDraftSettings((s) => ({ ...s, masterToken }))}
            placeholder="Токен мастера"
          />

          <View style={styles.actions}>
            <Pressable style={styles.secondaryBtn} onPress={onPing}>
              <Text style={styles.secondaryText}>Проверить связь</Text>
            </Pressable>
            <Pressable style={styles.primaryBtn} onPress={onSaveSettings}>
              <Text style={styles.primaryText}>Сохранить</Text>
            </Pressable>
          </View>

          <Text style={styles.sectionLabel}>Это устройство</Text>
          <Text style={styles.hint}>
            {deviceInfoLine || 'Определяется…'}
            {deviceLabel ? ` · метка: ${deviceLabel}` : ''}
            {deviceBlocked ? ' · ЗАБЛОКИРОВАНО' : ''}
          </Text>

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

          {message && !toast ? <Text style={styles.message}>{message}</Text> : null}
        </ScrollView>
      ) : null}

      <Modal
        visible={Boolean(editWork)}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!editSaving) setEditWork(null);
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Название фото</Text>
            <TextInput
              style={styles.input}
              value={editCaption}
              onChangeText={setEditCaption}
              placeholder="Например: кухня после уборки"
              maxLength={120}
              autoFocus
              editable={!editSaving}
            />
            <View style={styles.workActions}>
              <Pressable
                style={[styles.editBtn, editSaving && styles.btnDisabled]}
                onPress={() => setEditWork(null)}
                disabled={editSaving}
              >
                <Text style={styles.editText}>Отмена</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryBtn, styles.modalSaveBtn, editSaving && styles.btnDisabled]}
                onPress={onSaveEditWork}
                disabled={editSaving}
              >
                <Text style={styles.primaryText}>{editSaving ? 'Сохранение…' : 'Сохранить'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {toast ? (
        <View
          pointerEvents="none"
          style={[
            styles.toast,
            toast.kind === 'err' ? styles.toastErr : styles.toastOk,
            { bottom: TOAST_BOTTOM },
          ]}
        >
          <Text style={styles.toastText}>{toast.text}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f0fdfa' },
  header: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
  brand: { fontSize: 28, fontWeight: '800', color: '#115e59' },
  subtitle: { color: '#64748b', marginTop: 2 },
  blockedBanner: {
    marginTop: 10,
    backgroundColor: '#9f1239',
    color: '#fff',
    fontWeight: '700',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    overflow: 'hidden',
  },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    elevation: 6,
    shadowColor: '#0f172a',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  toastOk: { backgroundColor: '#0f766e' },
  toastErr: { backgroundColor: '#9a3412' },
  toastText: { color: '#fff', fontWeight: '700', textAlign: 'center', fontSize: 14 },
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
  tabText: { color: '#64748b', fontWeight: '600', fontSize: 12 },
  tabTextActive: { color: '#0f766e' },
  tabBadge: {
    width: 8,
    height: 8,
    borderRadius: 99,
    backgroundColor: '#ea580c',
  },
  content: { padding: 16, paddingBottom: 28 },
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
  liveCard: { borderRadius: 18, paddingVertical: 16, paddingHorizontal: 16, marginBottom: 16 },
  liveFree: { backgroundColor: '#0f766e' },
  liveBusy: { backgroundColor: '#9a3412' },
  liveTitle: { color: '#fff', fontSize: 22, fontWeight: '800' },
  sectionLabel: { fontWeight: '700', color: '#115e59', marginBottom: 8, marginTop: 4 },
  hint: { color: '#64748b', marginBottom: 8, fontSize: 13 },
  weekRow: { marginBottom: 12 },
  dayChip: {
    width: 88,
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
  dayState: { fontSize: 12, fontWeight: '800', marginTop: 6 },
  dayStateFree: { color: '#0f766e' },
  dayStateBusy: { color: '#ea580c' },
  dayStatePartial: { color: '#ca8a04' },
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
  workCaption: { fontWeight: '700', color: '#115e59', marginBottom: 10 },
  workActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  editBtn: {
    backgroundColor: '#ecfdf5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  editText: { color: '#0f766e', fontWeight: '700' },
  deleteBtn: {
    backgroundColor: '#fff7ed',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  deleteText: { color: '#9a3412', fontWeight: '700' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#d1e7e3',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#115e59',
    marginBottom: 12,
  },
  modalSaveBtn: {
    flexGrow: 1,
    marginBottom: 0,
    paddingHorizontal: 14,
  },
});
