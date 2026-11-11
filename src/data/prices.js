/** SSR/demo fallback. Live data: GET /api/prices (APK will manage via PUT). */

export const pricesMeta = {
  currency: 'RUB',
  note: 'Цены «от» — ориентир. Точную сумму согласуем до начала работ.',
};

export const priceItems = [
  {
    id: 'general',
    name: 'Генеральная уборка',
    price: 200,
    priceFrom: true,
    unit: 'm2',
    durationMinutes: 300,
    sort: 10,
    enabled: true,
  },
  {
    id: 'kitchen',
    name: 'Уборка кухни',
    price: 1000,
    priceFrom: true,
    unit: 'fixed',
    durationMinutes: 60,
    sort: 20,
    enabled: true,
  },
  {
    id: 'bathroom',
    name: 'Уборка ванной комнаты',
    price: 1500,
    priceFrom: true,
    unit: 'fixed',
    durationMinutes: 60,
    sort: 30,
    enabled: true,
  },
  {
    id: 'wc',
    name: 'Мытьё санузла',
    price: 1500,
    priceFrom: true,
    unit: 'fixed',
    durationMinutes: 60,
    sort: 40,
    enabled: true,
  },
  {
    id: 'fridge',
    name: 'Мытьё холодильника',
    price: 800,
    priceFrom: true,
    unit: 'fixed',
    durationMinutes: 30,
    sort: 50,
    enabled: true,
  },
  {
    id: 'oven',
    name: 'Мытьё духовки',
    price: 500,
    priceFrom: false,
    unit: 'fixed',
    durationMinutes: 30,
    sort: 60,
    enabled: true,
  },
  {
    id: 'windows',
    name: 'Мытьё окон',
    price: 600,
    priceFrom: true,
    unit: 'fixed',
    durationMinutes: 45,
    sort: 70,
    enabled: true,
  },
  {
    id: 'balcony',
    name: 'Мытьё балкона',
    price: 2000,
    priceFrom: true,
    unit: 'fixed',
    durationMinutes: 90,
    sort: 80,
    enabled: true,
  },
  {
    id: 'office',
    name: 'Уборка офиса',
    price: 150,
    priceFrom: true,
    unit: 'm2',
    durationMinutes: 180,
    sort: 90,
    enabled: true,
  },
  {
    id: 'event',
    name: 'Уборка после мероприятия',
    price: 200,
    priceFrom: true,
    unit: 'm2',
    durationMinutes: 180,
    sort: 100,
    enabled: true,
  },
  {
    id: 'industrial',
    name: 'Уборка производственного помещения',
    price: 200,
    priceFrom: true,
    unit: 'm2',
    durationMinutes: 300,
    sort: 110,
    enabled: true,
  },
];

export function formatDuration(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m <= 0) return '';
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (rest === 0) return `${h} ч`;
  return `${h} ч ${rest} мин`;
}

export function presentPriceItem(item) {
  const amount = Math.round(Number(item.price) || 0).toLocaleString('ru-RU');
  const prefix = item.priceFrom !== false ? 'от ' : '';
  return {
    ...item,
    durationLabel: formatDuration(item.durationMinutes),
    priceLabel: `${prefix}${amount} ₽`,
    unitLabel: item.unit === 'm2' ? 'за м²' : '',
  };
}

/** @deprecated use priceItems + presentPriceItem; kept for any old imports */
export const priceList = priceItems.map((item) => {
  const view = presentPriceItem(item);
  return {
    name: view.name,
    duration: view.durationLabel,
    price: view.priceLabel,
    note: view.unitLabel,
  };
});
