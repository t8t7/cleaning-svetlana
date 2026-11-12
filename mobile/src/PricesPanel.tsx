import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  fetchCalculator,
  fetchPrices,
  fetchServices,
  saveCalculator,
  savePrices,
  saveServices,
} from './api';
import type {
  CalculatorRates,
  PriceItem,
  PriceUnit,
  ServiceCardItem,
  ServiceUnit,
} from './types';

type PricesSubTab = 'list' | 'services' | 'calc';
type ListFilter = 'all' | 'm2' | 'fixed';

const SERVICE_TITLES: Record<ServiceCardItem['id'], string> = {
  general: 'Генеральная уборка',
  'after-repair': 'Уборка после ремонта',
  maintain: 'Поддерживающая уборка',
  windows: 'Мойка окон',
};

const CALC_TYPES: { key: keyof CalculatorRates; label: string }[] = [
  { key: 'maintain', label: 'Поддерживающая' },
  { key: 'general', label: 'Генеральная' },
  { key: 'afterRepair', label: 'После ремонта' },
];

const CALC_SIZES: { key: keyof CalculatorRates['general']; label: string }[] = [
  { key: 'studio', label: 'Студия' },
  { key: 'one', label: '1-комн.' },
  { key: 'two', label: '2-комн.' },
  { key: 'three', label: '3+' },
];

const EMPTY_RATES: CalculatorRates = {
  maintain: { studio: 0, one: 0, two: 0, three: 0 },
  general: { studio: 0, one: 0, two: 0, three: 0 },
  afterRepair: { studio: 0, one: 0, two: 0, three: 0 },
};

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

export function PricesPanel({ serverUrl, masterToken, onToast, onNeedSettings }: Props) {
  const [subTab, setSubTab] = useState<PricesSubTab>('list');
  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const [loading, setLoading] = useState(true);
  const [savingPrices, setSavingPrices] = useState(false);
  const [savingServices, setSavingServices] = useState(false);
  const [savingCalc, setSavingCalc] = useState(false);
  const [priceItems, setPriceItems] = useState<PriceItem[]>([]);
  const [priceNote, setPriceNote] = useState('');
  const [serviceItems, setServiceItems] = useState<ServiceCardItem[]>([]);
  const [calcRates, setCalcRates] = useState<CalculatorRates>(EMPTY_RATES);

  const ensureToken = () => {
    if (!masterToken.trim()) {
      onToast('Сначала укажите токен в настройках', 'err');
      onNeedSettings();
      return false;
    }
    return true;
  };

  const refreshAll = useCallback(async () => {
    if (!serverUrl.trim()) return;
    setLoading(true);
    try {
      const [prices, services, calc] = await Promise.all([
        fetchPrices(serverUrl, masterToken),
        fetchServices(serverUrl),
        fetchCalculator(serverUrl),
      ]);
      setPriceItems(
        (prices.items || []).map((item, index) => ({
          ...item,
          priceFrom: item.priceFrom !== false,
          enabled: item.enabled !== false,
          sort: Number.isFinite(Number(item.sort)) ? Number(item.sort) : (index + 1) * 10,
          unit: item.unit === 'm2' ? 'm2' : 'fixed',
        }))
      );
      setPriceNote(prices.meta?.note || '');
      setServiceItems(
        (services.items || []).map((item) => ({
          ...item,
          priceFrom: item.priceFrom !== false,
          durationApprox: item.durationApprox === true,
          durationText: item.durationText || '',
          durationMinutes: item.durationMinutes ?? null,
          durationMinutesMax: item.durationMinutesMax ?? null,
        }))
      );
      if (calc.rates) setCalcRates(calc.rates);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Ошибка загрузки цен', 'err');
    } finally {
      setLoading(false);
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
    setPriceItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const patchService = (id: ServiceCardItem['id'], patch: Partial<ServiceCardItem>) => {
    setServiceItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const patchCalc = (
    type: keyof CalculatorRates,
    size: keyof CalculatorRates['general'],
    value: string
  ) => {
    setCalcRates((prev) => ({
      ...prev,
      [type]: { ...prev[type], [size]: parseNum(value) },
    }));
  };

  const onAddPrice = (unit: PriceUnit) => {
    const nextSort =
      priceItems.reduce((max, item) => Math.max(max, Number(item.sort) || 0), 0) + 10;
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
    setListFilter(unit);
  };

  const onDeletePrice = (item: PriceItem) => {
    Alert.alert('Удалить позицию?', item.name || 'Без названия', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => setPriceItems((prev) => prev.filter((row) => row.id !== item.id)),
      },
    ]);
  };

  const onSavePrices = async () => {
    if (!ensureToken()) return;
    const empty = priceItems.find((item) => !String(item.name || '').trim());
    if (empty) {
      onToast('У каждой позиции должно быть название', 'err');
      return;
    }
    setSavingPrices(true);
    try {
      const data = await savePrices(serverUrl, masterToken, priceItems, priceNote);
      setPriceItems(
        (data.items || priceItems).map((item, index) => ({
          ...item,
          priceFrom: item.priceFrom !== false,
          enabled: item.enabled !== false,
          sort: Number.isFinite(Number(item.sort)) ? Number(item.sort) : (index + 1) * 10,
          unit: item.unit === 'm2' ? 'm2' : 'fixed',
        }))
      );
      if (data.meta?.note) setPriceNote(data.meta.note);
      onToast('Сайт подтвердил: прайс сохранён');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Ошибка сохранения прайса', 'err');
    } finally {
      setSavingPrices(false);
    }
  };

  const onSaveServices = async () => {
    if (!ensureToken()) return;
    setSavingServices(true);
    try {
      const data = await saveServices(serverUrl, masterToken, serviceItems);
      setServiceItems(data.items || serviceItems);
      onToast('Сайт подтвердил: карточки услуг сохранены');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Ошибка сохранения услуг', 'err');
    } finally {
      setSavingServices(false);
    }
  };

  const onSaveCalc = async () => {
    if (!ensureToken()) return;
    setSavingCalc(true);
    try {
      const data = await saveCalculator(serverUrl, masterToken, calcRates);
      if (data.rates) setCalcRates(data.rates);
      onToast('Сайт подтвердил: калькулятор сохранён');
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
            { id: 'services', label: 'Услуги' },
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
            Здесь позиции прайса на сайте. Можно добавить, удалить, поставить ₽/м² или фикс.
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
            <Text style={styles.empty}>В этом блоке пока пусто — добавьте позицию.</Text>
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
                <Pressable style={styles.deleteBtn} onPress={() => onDeletePrice(item)}>
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
                <Text style={styles.switchLabel}>«от»</Text>
                <Switch
                  value={item.priceFrom !== false}
                  onValueChange={(priceFrom) => patchPrice(item.id, { priceFrom })}
                  trackColor={{ false: '#cbd5e1', true: '#99f6e4' }}
                  thumbColor={item.priceFrom !== false ? '#0f766e' : '#f8fafc'}
                />
                <Text style={[styles.switchLabel, { marginLeft: 12 }]}>На сайте</Text>
                <Switch
                  value={item.enabled !== false}
                  onValueChange={(enabled) => patchPrice(item.id, { enabled })}
                  trackColor={{ false: '#cbd5e1', true: '#99f6e4' }}
                  thumbColor={item.enabled !== false ? '#0f766e' : '#f8fafc'}
                />
              </View>
            </View>
          ))}

          <View style={styles.addRow}>
            <Pressable style={styles.addBtn} onPress={() => onAddPrice('fixed')}>
              <Text style={styles.addText}>+ Фикс</Text>
            </Pressable>
            <Pressable style={styles.addBtn} onPress={() => onAddPrice('m2')}>
              <Text style={styles.addText}>+ ₽/м²</Text>
            </Pressable>
          </View>

          <View style={styles.actions}>
            <Pressable style={styles.secondaryBtn} onPress={refreshAll}>
              <Text style={styles.secondaryText}>Обновить</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, savingPrices && styles.btnDisabled]}
              onPress={onSavePrices}
              disabled={savingPrices}
            >
              <Text style={styles.primaryText}>
                {savingPrices ? 'Сохранение…' : 'Сохранить прайс'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {subTab === 'services' ? (
        <View>
          <Text style={styles.hint}>
            Четыре карточки блока «Услуги» на сайте. Названия фиксированы — правятся цена и время.
          </Text>
          {serviceItems.map((item) => (
            <View key={item.id} style={styles.card}>
              <Text style={styles.cardTitle}>{SERVICE_TITLES[item.id] || item.id}</Text>
              <View style={styles.row}>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Цена, ₽</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="numeric"
                    editable={item.unit !== 'request'}
                    value={String(item.price ?? 0)}
                    onChangeText={(v) => patchService(item.id, { price: parseNum(v) })}
                  />
                </View>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Минут</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="numeric"
                    value={item.durationMinutes == null ? '' : String(item.durationMinutes)}
                    onChangeText={(v) =>
                      patchService(item.id, {
                        durationMinutes: v.trim() === '' ? null : parseNum(v),
                      })
                    }
                  />
                </View>
              </View>
              <View style={styles.unitRow}>
                {(['m2', 'fixed', 'request'] as ServiceUnit[]).map((unit) => (
                  <Pressable
                    key={unit}
                    style={[styles.unitBtn, item.unit === unit && styles.unitBtnActive]}
                    onPress={() => patchService(item.id, { unit })}
                  >
                    <Text style={[styles.unitText, item.unit === unit && styles.unitTextActive]}>
                      {unit === 'm2' ? '₽/м²' : unit === 'fixed' ? 'Фикс' : 'Запрос'}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Показывать «от»</Text>
                <Switch
                  value={item.priceFrom !== false}
                  onValueChange={(priceFrom) => patchService(item.id, { priceFrom })}
                  trackColor={{ false: '#cbd5e1', true: '#99f6e4' }}
                  thumbColor={item.priceFrom !== false ? '#0f766e' : '#f8fafc'}
                />
              </View>
              <TextInput
                style={styles.input}
                value={item.durationText}
                onChangeText={(durationText) => patchService(item.id, { durationText })}
                placeholder="Текст длительности (напр. по объёму)"
                maxLength={40}
              />
            </View>
          ))}
          <View style={styles.actions}>
            <Pressable
              style={[styles.primaryBtn, savingServices && styles.btnDisabled]}
              onPress={onSaveServices}
              disabled={savingServices}
            >
              <Text style={styles.primaryText}>
                {savingServices ? 'Сохранение…' : 'Сохранить услуги'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {subTab === 'calc' ? (
        <View>
          <Text style={styles.hint}>
            Ориентир для клиента: тип уборки × размер квартиры (не путать с ₽/м² в прайсе).
          </Text>
          {CALC_TYPES.map((type) => (
            <View key={type.key} style={styles.card}>
              <Text style={styles.cardTitle}>{type.label}</Text>
              <View style={styles.calcGrid}>
                {CALC_SIZES.map((size) => (
                  <View key={size.key} style={styles.calcCell}>
                    <Text style={styles.fieldLabel}>{size.label}</Text>
                    <TextInput
                      style={styles.input}
                      keyboardType="numeric"
                      value={String(calcRates[type.key][size.key] ?? 0)}
                      onChangeText={(v) => patchCalc(type.key, size.key, v)}
                    />
                  </View>
                ))}
              </View>
            </View>
          ))}
          <View style={styles.actions}>
            <Pressable
              style={[styles.primaryBtn, savingCalc && styles.btnDisabled]}
              onPress={onSaveCalc}
              disabled={savingCalc}
            >
              <Text style={styles.primaryText}>
                {savingCalc ? 'Сохранение…' : 'Сохранить калькулятор'}
              </Text>
            </Pressable>
          </View>
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
    gap: 6,
  },
  switchLabel: { color: '#334155', fontWeight: '600', fontSize: 13 },
  calcGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  calcCell: { width: '47%' },
  addRow: { flexDirection: 'row', gap: 8, marginTop: 2, marginBottom: 4 },
  addBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#ecfdf5',
    paddingVertical: 12,
    alignItems: 'center',
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
