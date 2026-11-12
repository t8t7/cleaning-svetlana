import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
  { key: 'three', label: '3-комн.+' },
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

export function PricesPanel({ serverUrl, masterToken, onToast, onNeedSettings }: Props) {
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

  const onSavePrices = async () => {
    if (!ensureToken()) return;
    setSavingPrices(true);
    try {
      const data = await savePrices(serverUrl, masterToken, priceItems, priceNote);
      setPriceItems(data.items || priceItems);
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
      <Text style={styles.sectionLabel}>Прайс-лист</Text>
      <Text style={styles.hint}>₽/м² — цена за квадрат. Фикс — фиксированная сумма.</Text>
      <TextInput
        style={styles.input}
        value={priceNote}
        onChangeText={setPriceNote}
        placeholder="Подпись под ценами на сайте"
        maxLength={200}
      />

      {priceItems.map((item) => (
        <View key={item.id} style={styles.card}>
          <TextInput
            style={styles.nameInput}
            value={item.name}
            onChangeText={(name) => patchPrice(item.id, { name })}
            placeholder="Название"
          />
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
              onPress={() => patchPrice(item.id, { unit: 'm2' as PriceUnit })}
            >
              <Text style={[styles.unitText, item.unit === 'm2' && styles.unitTextActive]}>₽/м²</Text>
            </Pressable>
            <Pressable
              style={[styles.unitBtn, item.unit === 'fixed' && styles.unitBtnActive]}
              onPress={() => patchPrice(item.id, { unit: 'fixed' as PriceUnit })}
            >
              <Text style={[styles.unitText, item.unit === 'fixed' && styles.unitTextActive]}>Фикс</Text>
            </Pressable>
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Показывать «от»</Text>
            <Switch
              value={item.priceFrom !== false}
              onValueChange={(priceFrom) => patchPrice(item.id, { priceFrom })}
              trackColor={{ false: '#cbd5e1', true: '#99f6e4' }}
              thumbColor={item.priceFrom !== false ? '#0f766e' : '#f8fafc'}
            />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Показывать на сайте</Text>
            <Switch
              value={item.enabled !== false}
              onValueChange={(enabled) => patchPrice(item.id, { enabled })}
              trackColor={{ false: '#cbd5e1', true: '#99f6e4' }}
              thumbColor={item.enabled !== false ? '#0f766e' : '#f8fafc'}
            />
          </View>
        </View>
      ))}

      <View style={styles.actions}>
        <Pressable style={styles.secondaryBtn} onPress={refreshAll}>
          <Text style={styles.secondaryText}>Обновить</Text>
        </Pressable>
        <Pressable
          style={[styles.primaryBtn, savingPrices && styles.btnDisabled]}
          onPress={onSavePrices}
          disabled={savingPrices}
        >
          <Text style={styles.primaryText}>{savingPrices ? 'Сохранение…' : 'Сохранить прайс'}</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionLabel}>Карточки «Услуги»</Text>
      <Text style={styles.hint}>Названия на сайте фиксированы — меняются цена и время.</Text>
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
                  patchService(item.id, { durationMinutes: v.trim() === '' ? null : parseNum(v) })
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

      <Text style={styles.sectionLabel}>Калькулятор-ориентир</Text>
      <Text style={styles.hint}>Суммы «от» для студии / 1 / 2 / 3-комнатной.</Text>
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
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  sectionLabel: { fontWeight: '700', color: '#115e59', marginBottom: 8, marginTop: 12 },
  hint: { color: '#64748b', marginBottom: 10, fontSize: 13 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d1e7e3',
    padding: 12,
    marginBottom: 10,
    gap: 8,
  },
  cardTitle: { fontWeight: '800', color: '#115e59', fontSize: 15 },
  nameInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#d1e7e3',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontWeight: '700',
    color: '#115e59',
  },
  row: { flexDirection: 'row', gap: 8 },
  field: { flex: 1 },
  fieldLabel: { color: '#64748b', fontSize: 12, fontWeight: '600', marginBottom: 4 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1e7e3',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  unitRow: { flexDirection: 'row', gap: 6 },
  unitBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d1e7e3',
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  unitBtnActive: { backgroundColor: '#ecfdf5', borderColor: '#0f766e' },
  unitText: { color: '#64748b', fontWeight: '700', fontSize: 12 },
  unitTextActive: { color: '#0f766e' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchLabel: { color: '#334155', fontWeight: '600' },
  calcGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  calcCell: { width: '47%' },
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
