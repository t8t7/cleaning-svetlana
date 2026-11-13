import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { fetchCalculator, fetchPrices, saveCalculator, savePrices } from './api';
import type { CalcSizeKey, CalculatorItem, PriceItem, PriceUnit } from './types';

type PricesSubTab = 'list' | 'calc';
type ListFilter = 'all' | 'm2' | 'fixed';

const CALC_SIZES: { key: CalcSizeKey; label: string }[] = [
  { key: 'studio', label: 'Студия' },
  { key: 'one', label: '1-комн.' },
  { key: 'two', label: '2-комн.' },
  { key: 'three', label: '3+' },
];

const EMPTY_SIZE_RATES = () => ({ studio: 0, one: 0, two: 0, three: 0 });

const LEGACY_CALC_NAMES: Record<string, string> = {
  maintain: 'Поддерживающая',
  general: 'Генеральная',
  afterRepair: 'После ремонта',
};

function normalizeCalcItems(payload: {
  items?: CalculatorItem[];
  rates?: Record<string, { studio?: number; one?: number; two?: number; three?: number }>;
}): CalculatorItem[] {
  if (Array.isArray(payload.items) && payload.items.length) {
    return payload.items.map((item, index) => ({
      id: item.id,
      name: item.name || LEGACY_CALC_NAMES[item.id] || item.id,
      sort: Number.isFinite(Number(item.sort)) ? Number(item.sort) : (index + 1) * 10,
      enabled: item.enabled !== false,
      rates: {
        studio: Number(item.rates?.studio) || 0,
        one: Number(item.rates?.one) || 0,
        two: Number(item.rates?.two) || 0,
        three: Number(item.rates?.three) || 0,
      },
    }));
  }
  const rates = payload.rates || {};
  return Object.keys(rates).map((id, index) => ({
    id,
    name: LEGACY_CALC_NAMES[id] || id,
    sort: (index + 1) * 10,
    enabled: true,
    rates: {
      studio: Number(rates[id]?.studio) || 0,
      one: Number(rates[id]?.one) || 0,
      two: Number(rates[id]?.two) || 0,
      three: Number(rates[id]?.three) || 0,
    },
  }));
}

type Props = {
  serverUrl: string;
  masterToken: string;
  onToast: (text: string, kind?: 'ok' | 'err') => void;
  onNeedSettings: () => void;
};

function parseNum(value: string): number {
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function makePriceId(): string {
  return `item-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
}

function makeCalcId(): string {
  return `calc-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
}

export function PricesPanel({ serverUrl, masterToken, onToast, onNeedSettings }: Props) {
  const [subTab, setSubTab] = useState<PricesSubTab>('list');
  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const [loading, setLoading] = useState(true);
  const [savingPrices, setSavingPrices] = useState(false);
  const [savingCalc, setSavingCalc] = useState(false);
  const [priceItems, setPriceItems] = useState<PriceItem[]>([]);
  const [priceNote, setPriceNote] = useState('');
  const [calcItems, setCalcItems] = useState<CalculatorItem[]>([]);
  const priceItemsRef = useRef<PriceItem[]>([]);
  const priceNoteRef = useRef('');
  const calcItemsRef = useRef<CalculatorItem[]>([]);
  const pricesSaveLock = useRef(false);

  useEffect(() => {
    priceItemsRef.current = priceItems;
  }, [priceItems]);
  useEffect(() => {
    priceNoteRef.current = priceNote;
  }, [priceNote]);
  useEffect(() => {
    calcItemsRef.current = calcItems;
  }, [calcItems]);

  const ensureToken = () => {
    if (!masterToken.trim()) {
      onToast('Сначала укажите токен в настройках', 'err');
      onNeedSettings();
      return false;
    }
    return true;
  };

  const refreshAll = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!serverUrl.trim()) return;
    const quiet = opts?.quiet === true;
    // Full-screen spinner only for first open, never after save.
    if (!quiet) setLoading(true);
    try {
      const [prices, calc] = await Promise.all([
        fetchPrices(serverUrl, masterToken),
        fetchCalculator(serverUrl),
      ]);
      const nextPrices = (prices.items || []).map((item, index) => ({
        ...item,
        priceFrom: item.priceFrom !== false,
        enabled: item.enabled !== false,
        sort: Number.isFinite(Number(item.sort)) ? Number(item.sort) : (index + 1) * 10,
        unit: item.unit === 'm2' ? 'm2' : 'fixed' as const,
      }));
      priceItemsRef.current = nextPrices;
      setPriceItems(nextPrices);
      const note = prices.meta?.note || '';
      priceNoteRef.current = note;
      setPriceNote(note);
      const nextCalc = normalizeCalcItems(calc);
      calcItemsRef.current = nextCalc;
      setCalcItems(nextCalc);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Ошибка загрузки цен', 'err');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [masterToken, onToast, serverUrl]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const visiblePrices = useMemo(() => {
    if (listFilter === 'all') return priceItems;
    return priceItems.filter((item) => item.unit === listFilter);
  }, [listFilter, priceItems]);

  const patchPrice = (id: string, patch: Partial<PriceItem>) => {
    const next = priceItemsRef.current.map((item) => (item.id === id ? { ...item, ...patch } : item));
    priceItemsRef.current = next;
    setPriceItems(next);
  };

  const togglePriceFlag = (id: string, patch: Partial<Pick<PriceItem, 'priceFrom' | 'enabled'>>) => {
    const next = priceItemsRef.current.map((item) => (item.id === id ? { ...item, ...patch } : item));
    priceItemsRef.current = next;
    setPriceItems(next);

    void (async () => {
      if (!ensureToken()) return;
      const empty = next.find((row) => !String(row.name || '').trim());
      if (empty) {
        onToast('Сначала укажите название услуги, потом тумблер', 'err');
        return;
      }
      if (pricesSaveLock.current) {
        onToast('Подождите, предыдущее сохранение ещё идёт', 'err');
        return;
      }
      pricesSaveLock.current = true;
      setSavingPrices(true);
      try {
        await savePrices(serverUrl, masterToken, next, priceNoteRef.current);
        onToast(
          patch.priceFrom === false
            ? 'На сайте без «от»'
            : patch.priceFrom === true
              ? 'На сайте с «от»'
              : patch.enabled === false
                ? 'Убрано с сайта'
                : 'Снова на сайте'
        );
      } catch (error) {
        onToast(error instanceof Error ? error.message : 'Не удалось сохранить тумблер', 'err');
        await refreshAll({ quiet: true });
      } finally {
        pricesSaveLock.current = false;
        setSavingPrices(false);
      }
    })();
  };

  const patchCalcItem = (id: string, patch: Partial<CalculatorItem>) => {
    setCalcItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const patchCalcRate = (id: string, size: CalcSizeKey, value: string) => {
    setCalcItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, rates: { ...item.rates, [size]: parseNum(value) } }
          : item
      )
    );
  };

  const onAddCalc = () => {
    const nextSort =
      calcItems.reduce((max, item) => Math.max(max, Number(item.sort) || 0), 0) + 10;
    setCalcItems((prev) => [
      ...prev,
      {
        id: makeCalcId(),
        name: '',
        sort: nextSort,
        enabled: true,
        rates: EMPTY_SIZE_RATES(),
      },
    ]);
  };

  const onDeleteCalc = (item: CalculatorItem) => {
    const nextItems = calcItemsRef.current.filter((row) => row.id !== item.id);
    if (nextItems.length < 1) {
      onToast('В калькуляторе должна остаться хотя бы одна услуга', 'err');
      return;
    }
    calcItemsRef.current = nextItems;
    setCalcItems(nextItems);

    void (async () => {
      if (!ensureToken()) return;
      const empty = nextItems.find((row) => !String(row.name || '').trim());
      if (empty) {
        onToast('Удалено в телефоне. Заполните названия и нажмите «Сохранить калькулятор»', 'err');
        return;
      }
      setSavingCalc(true);
      try {
        await saveCalculator(serverUrl, masterToken, nextItems);
        onToast('Сайт подтвердил: услуга убрана из калькулятора');
      } catch (error) {
        onToast(error instanceof Error ? error.message : 'Не удалось удалить на сайте', 'err');
        await refreshAll({ quiet: true });
      } finally {
        setSavingCalc(false);
      }
    })();
  };

  const onAddPrice = () => {
    const nextSort =
      priceItems.reduce((max, item) => Math.max(max, Number(item.sort) || 0), 0) + 10;
    const unit: PriceUnit = listFilter === 'm2' ? 'm2' : 'fixed';
    setPriceItems((prev) => [
      ...prev,
      {
        id: makePriceId(),
        name: '',
        price: 0,
        priceFrom: true,
        unit,
        durationMinutes: 60,
        sort: nextSort,
        enabled: true,
      },
    ]);
  };

  const persistPrices = async (items: PriceItem[], note: string, okMessage: string) => {
    if (!ensureToken()) return false;
    const empty = items.find((item) => !String(item.name || '').trim());
    if (empty) {
      onToast('У каждой позиции должно быть название', 'err');
      return false;
    }
    setSavingPrices(true);
    try {
      await savePrices(serverUrl, masterToken, items, note);
      // Keep current editor state — no full-screen reload spinner.
      onToast(okMessage);
      return true;
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Ошибка сохранения прайса', 'err');
      return false;
    } finally {
      setSavingPrices(false);
    }
  };

  const onDeletePrice = (item: PriceItem) => {
    // Compute from ref — never from a stale empty array race.
    const nextItems = priceItemsRef.current.filter((row) => row.id !== item.id);
    if (nextItems.length < 1) {
      onToast('Нельзя удалить все позиции прайса', 'err');
      return;
    }
    priceItemsRef.current = nextItems;
    setPriceItems(nextItems);

    void (async () => {
      if (!ensureToken()) return;
      const empty = nextItems.find((row) => !String(row.name || '').trim());
      if (empty) {
        onToast('Удалено в телефоне. Заполните названия и нажмите «Сохранить прайс»', 'err');
        return;
      }
      if (pricesSaveLock.current) {
        onToast('Подождите, предыдущее сохранение ещё идёт', 'err');
        return;
      }
      pricesSaveLock.current = true;
      setSavingPrices(true);
      try {
        // Save the exact snapshot we computed — not whatever state is later.
        await savePrices(serverUrl, masterToken, nextItems, priceNoteRef.current);
        onToast('Сайт подтвердил: позиция удалена');
      } catch (error) {
        onToast(error instanceof Error ? error.message : 'Не удалось удалить на сайте', 'err');
        await refreshAll({ quiet: true });
      } finally {
        pricesSaveLock.current = false;
        setSavingPrices(false);
      }
    })();
  };

  const onSavePrices = async () => {
    await persistPrices(priceItems, priceNote, 'Сайт подтвердил: прайс записан и отдаётся клиентам');
  };

  const onSaveCalc = async () => {
    if (!ensureToken()) return;
    const empty = calcItems.find((item) => !String(item.name || '').trim());
    if (empty) {
      onToast('У каждой услуги калькулятора должно быть название', 'err');
      return;
    }
    if (calcItems.length < 1) {
      onToast('Добавьте хотя бы одну услугу в калькулятор', 'err');
      return;
    }
    setSavingCalc(true);
    try {
      const data = await saveCalculator(serverUrl, masterToken, calcItems);
      setCalcItems(normalizeCalcItems(data));
      onToast('Сайт подтвердил: калькулятор записан и отдаётся клиентам');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Ошибка сохранения калькулятора', 'err');
    } finally {
      setSavingCalc(false);
    }
  };

  if (loading) {
    return <ActivityIndicator color="#0f766e" style={{ marginTop: 24 }} />;
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.subTabs}>
        {(
          [
            { id: 'list', label: 'Прайс' },
            { id: 'calc', label: 'Калькулятор' },
          ] as const
        ).map((tab) => (
          <Pressable
            key={tab.id}
            style={[styles.subTab, subTab === tab.id && styles.subTabActive]}
            onPress={() => setSubTab(tab.id)}
          >
            <Text style={[styles.subTabText, subTab === tab.id && styles.subTabTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {subTab === 'list' ? (
        <View>
          <Text style={styles.hint}>
            Позиции прайса на сайте. «от» и «На сайте» сохраняются сразу. Удаление тоже сразу убирает
            строку с сайта. Остальное — через «Сохранить прайс».
          </Text>

          <View style={styles.filterRow}>
            {(
              [
                { id: 'all', label: 'Все' },
                { id: 'm2', label: '₽/м²' },
                { id: 'fixed', label: 'Фикс' },
              ] as const
            ).map((f) => (
              <Pressable
                key={f.id}
                style={[styles.filterChip, listFilter === f.id && styles.filterChipActive]}
                onPress={() => setListFilter(f.id)}
              >
                <Text
                  style={[styles.filterText, listFilter === f.id && styles.filterTextActive]}
                >
                  {f.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {visiblePrices.length === 0 ? (
            <Text style={styles.empty}>В этом блоке пока пусто — добавьте услугу.</Text>
          ) : null}

          {visiblePrices.map((item) => (
            <View key={item.id} style={styles.card}>
              <View style={styles.cardTop}>
                <TextInput
                  style={styles.nameInput}
                  value={item.name}
                  onChangeText={(name) => patchPrice(item.id, { name })}
                  placeholder="Название услуги"
                />
                <Pressable
                  style={styles.deleteBtn}
                  onPress={() => onDeletePrice(item)}
                  disabled={savingPrices}
                >
                  <Text style={styles.deleteText}>✕</Text>
                </Pressable>
              </View>

              <View style={styles.row}>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Цена, ₽</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="numeric"
                    value={String(item.price ?? 0)}
                    onChangeText={(v) => patchPrice(item.id, { price: parseNum(v) })}
                  />
                </View>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Минут</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="numeric"
                    value={String(item.durationMinutes ?? 0)}
                    onChangeText={(v) => patchPrice(item.id, { durationMinutes: parseNum(v) })}
                  />
                </View>
              </View>

              <View style={styles.unitRow}>
                <Pressable
                  style={[styles.unitBtn, item.unit === 'm2' && styles.unitBtnActive]}
                  onPress={() => patchPrice(item.id, { unit: 'm2' })}
                >
                  <Text style={[styles.unitText, item.unit === 'm2' && styles.unitTextActive]}>
                    ₽/м²
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.unitBtn, item.unit === 'fixed' && styles.unitBtnActive]}
                  onPress={() => patchPrice(item.id, { unit: 'fixed' })}
                >
                  <Text style={[styles.unitText, item.unit === 'fixed' && styles.unitTextActive]}>
                    Фикс
                  </Text>
                </Pressable>
              </View>

              <View style={styles.switchRow}>
                <Pressable
                  style={[styles.flagBtn, item.priceFrom !== false && styles.flagBtnActive]}
                  onPress={() =>
                    togglePriceFlag(item.id, { priceFrom: !(item.priceFrom !== false) })
                  }
                  disabled={savingPrices}
                >
                  <Text
                    style={[styles.flagText, item.priceFrom !== false && styles.flagTextActive]}
                  >
                    {item.priceFrom !== false ? '«от» вкл' : '«от» выкл'}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.flagBtn, item.enabled !== false && styles.flagBtnActive]}
                  onPress={() =>
                    togglePriceFlag(item.id, { enabled: !(item.enabled !== false) })
                  }
                  disabled={savingPrices}
                >
                  <Text
                    style={[styles.flagText, item.enabled !== false && styles.flagTextActive]}
                  >
                    {item.enabled !== false ? 'На сайте' : 'Скрыто'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ))}

          <Pressable style={styles.addBtn} onPress={onAddPrice}>
            <Text style={styles.addText}>Добавить услугу</Text>
          </Pressable>

          <Pressable
            style={[styles.primaryBtn, savingPrices && styles.btnDisabled, { marginTop: 8, marginBottom: 8 }]}
            onPress={onSavePrices}
            disabled={savingPrices}
          >
            <Text style={styles.primaryText}>
              {savingPrices ? 'Сохранение…' : 'Сохранить прайс'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {subTab === 'calc' ? (
        <View>
          <Text style={styles.hint}>
            Ориентир для клиента: тип уборки × размер квартиры. Можно добавить свой тип услуги.
          </Text>
          {calcItems.length === 0 ? (
            <Text style={styles.empty}>Пока пусто — добавьте услугу в калькулятор.</Text>
          ) : null}
          {calcItems.map((item) => (
            <View key={item.id} style={styles.card}>
              <View style={styles.cardTop}>
                <TextInput
                  style={styles.nameInput}
                  value={item.name}
                  onChangeText={(name) => patchCalcItem(item.id, { name })}
                  placeholder="Название услуги"
                />
                <Pressable
                  style={styles.deleteBtn}
                  onPress={() => onDeleteCalc(item)}
                  disabled={savingCalc}
                >
                  <Text style={styles.deleteText}>✕</Text>
                </Pressable>
              </View>
              <View style={styles.calcGrid}>
                {CALC_SIZES.map((size) => (
                  <View key={size.key} style={styles.calcCell}>
                    <Text style={styles.fieldLabel}>{size.label}</Text>
                    <TextInput
                      style={styles.input}
                      keyboardType="numeric"
                      value={String(item.rates[size.key] ?? 0)}
                      onChangeText={(v) => patchCalcRate(item.id, size.key, v)}
                    />
                  </View>
                ))}
              </View>
            </View>
          ))}
          <Pressable style={styles.addBtn} onPress={onAddCalc}>
            <Text style={styles.addText}>Добавить услугу</Text>
          </Pressable>
          <Pressable
            style={[styles.primaryBtn, savingCalc && styles.btnDisabled, { marginTop: 8, marginBottom: 8 }]}
            onPress={onSaveCalc}
            disabled={savingCalc}
          >
            <Text style={styles.primaryText}>
              {savingCalc ? 'Сохранение…' : 'Сохранить калькулятор'}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  subTabs: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d1e7e3',
    padding: 3,
    marginBottom: 10,
  },
  subTab: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  subTabActive: { backgroundColor: '#ecfdf5' },
  subTabText: { color: '#64748b', fontWeight: '700', fontSize: 12 },
  subTabTextActive: { color: '#0f766e' },
  hint: { color: '#64748b', marginBottom: 10, fontSize: 13, lineHeight: 18 },
  empty: { color: '#94a3b8', marginBottom: 12, fontStyle: 'italic' },
  filterRow: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d1e7e3',
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#fff',
  },
  filterChipActive: { backgroundColor: '#0f766e', borderColor: '#0f766e' },
  filterText: { color: '#64748b', fontWeight: '700', fontSize: 12 },
  filterTextActive: { color: '#fff' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d1e7e3',
    padding: 10,
    marginBottom: 8,
    gap: 8,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontWeight: '800', color: '#115e59', fontSize: 15 },
  nameInput: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#d1e7e3',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontWeight: '700',
    color: '#115e59',
  },
  deleteBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  deleteText: { color: '#9a3412', fontWeight: '800', fontSize: 14 },
  row: { flexDirection: 'row', gap: 8 },
  field: { flex: 1 },
  fieldLabel: { color: '#64748b', fontSize: 11, fontWeight: '600', marginBottom: 3 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1e7e3',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  unitRow: { flexDirection: 'row', gap: 6 },
  unitBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d1e7e3',
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  unitBtnActive: { backgroundColor: '#ecfdf5', borderColor: '#0f766e' },
  unitText: { color: '#64748b', fontWeight: '700', fontSize: 12 },
  unitTextActive: { color: '#0f766e' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  flagBtn: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  flagBtnActive: { backgroundColor: '#ecfdf5', borderColor: '#0f766e' },
  flagText: { color: '#64748b', fontWeight: '700', fontSize: 12 },
  flagTextActive: { color: '#0f766e' },
  calcGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  calcCell: { width: '47%' },
  addBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#ecfdf5',
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 2,
    marginBottom: 4,
  },
  addText: { color: '#0f766e', fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 8 },
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
});
