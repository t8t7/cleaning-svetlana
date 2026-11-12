export type BusyRange = { from: number; to: number };

export type DayPlan = {
  key: string;
  label: string;
  shortDate: string;
  status: 'free' | 'busy' | 'partial';
  busyRanges: BusyRange[];
};

export type AvailabilityMeta = {
  personName: string;
  timezoneLabel: string;
  workDayStart: number;
  workDayEnd: number;
  note: string;
  updatedAt: string | null;
};

export type LiveStatus = {
  state: 'free' | 'busy' | 'busy-now';
  title: string;
  detail: string;
  today: DayPlan;
};

export type AvailabilityPayload = {
  meta: AvailabilityMeta;
  weekPlan: DayPlan[];
  live?: LiveStatus;
  ok?: boolean;
};

export type AppSettings = {
  serverUrl: string;
  masterToken: string;
};

export type WorkItem = {
  id: string;
  url: string;
  caption: string;
  createdAt?: string;
  avgRating: number;
  ratingCount: number;
};

export type AppVersionInfo = {
  versionName: string;
  versionCode: number;
  apkReady: boolean;
  downloadPath: string;
};

export type PriceUnit = 'm2' | 'fixed';

export type PriceItem = {
  id: string;
  name: string;
  price: number;
  priceFrom: boolean;
  unit: PriceUnit;
  durationMinutes: number;
  sort: number;
  enabled: boolean;
  durationLabel?: string;
  priceLabel?: string;
  unitLabel?: string;
};

export type PricesPayload = {
  meta: { currency?: string; note?: string; updatedAt?: string | null };
  items: PriceItem[];
  ok?: boolean;
};

export type ServiceUnit = 'm2' | 'fixed' | 'request';

export type ServiceCardItem = {
  id: 'general' | 'after-repair' | 'maintain' | 'windows';
  price: number;
  priceFrom: boolean;
  unit: ServiceUnit;
  durationMinutes: number | null;
  durationMinutesMax: number | null;
  durationApprox: boolean;
  durationText: string;
  priceLabel?: string;
  durationLabel?: string;
};

export type ServicesPayload = {
  meta: { updatedAt?: string | null };
  items: ServiceCardItem[];
  ok?: boolean;
};

export type CalculatorRates = {
  maintain: { studio: number; one: number; two: number; three: number };
  general: { studio: number; one: number; two: number; three: number };
  afterRepair: { studio: number; one: number; two: number; three: number };
};

export type CalculatorPayload = {
  meta: { updatedAt?: string | null };
  rates: CalculatorRates;
  ok?: boolean;
};
