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
