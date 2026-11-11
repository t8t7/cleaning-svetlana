import fs from 'node:fs/promises';
import path from 'node:path';

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = {
  mon: 'Пн',
  tue: 'Вт',
  wed: 'Ср',
  thu: 'Чт',
  fri: 'Пт',
  sat: 'Сб',
  sun: 'Вс',
};
const WORK_START = 8;
const WORK_END = 20;

export const DEFAULT_AVAILABILITY = {
  meta: {
    personName: 'Светлана',
    timezoneLabel: 'Йошкар-Ола',
    workDayStart: WORK_START,
    workDayEnd: WORK_END,
    note: 'Расписание обновляется с телефона мастера',
    updatedAt: null,
  },
  weekPlan: [
    { key: 'mon', label: 'Пн', shortDate: '10.11', status: 'partial', busyRanges: [{ from: 9, to: 13 }] },
    { key: 'tue', label: 'Вт', shortDate: '11.11', status: 'busy', busyRanges: [{ from: 8, to: 20 }] },
    { key: 'wed', label: 'Ср', shortDate: '12.11', status: 'free', busyRanges: [] },
    { key: 'thu', label: 'Чт', shortDate: '13.11', status: 'partial', busyRanges: [{ from: 14, to: 18 }] },
    { key: 'fri', label: 'Пт', shortDate: '14.11', status: 'free', busyRanges: [] },
    { key: 'sat', label: 'Сб', shortDate: '15.11', status: 'partial', busyRanges: [{ from: 10, to: 15 }] },
    { key: 'sun', label: 'Вс', shortDate: '16.11', status: 'busy', busyRanges: [{ from: 8, to: 20 }] },
  ],
};

function formatShortDate(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}.${m}`;
}

/** Align week shortDate labels to the current calendar week (Mon–Sun). */
export function withCurrentWeekDates(plan, now = new Date()) {
  const dayIndex = (now.getDay() + 6) % 7;
  const monday = new Date(now);
  monday.setHours(12, 0, 0, 0);
  monday.setDate(now.getDate() - dayIndex);

  return plan.map((day, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    return {
      ...day,
      label: DAY_LABELS[day.key] || day.label,
      shortDate: formatShortDate(date),
    };
  });
}

export function deriveDayStatus(busyRanges, start = WORK_START, end = WORK_END) {
  const hours = end - start;
  if (!busyRanges.length) return 'free';
  let busyHours = 0;
  for (let h = start; h < end; h += 1) {
    if (busyRanges.some((r) => h >= r.from && h < r.to)) busyHours += 1;
  }
  if (busyHours <= 0) return 'free';
  if (busyHours >= hours) return 'busy';
  return 'partial';
}

function normalizeRange(range) {
  const from = Number(range?.from);
  const to = Number(range?.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  if (from < WORK_START || to > WORK_END || from >= to) return null;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  return { from, to };
}

/** Merge overlapping/adjacent hour ranges. */
export function mergeBusyRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const merged = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last || range.from > last.to) {
      merged.push({ ...range });
    } else {
      last.to = Math.max(last.to, range.to);
    }
  }
  return merged;
}

export function validateAvailabilityPayload(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Некорректное тело запроса' };
  }
  if (!Array.isArray(body.weekPlan) || body.weekPlan.length !== 7) {
    return { ok: false, error: 'Нужен weekPlan из 7 дней' };
  }

  const byKey = new Map();
  for (const day of body.weekPlan) {
    if (!day || typeof day !== 'object') {
      return { ok: false, error: 'Некорректный день' };
    }
    if (!DAY_KEYS.includes(day.key)) {
      return { ok: false, error: `Неизвестный день: ${day.key}` };
    }
    if (byKey.has(day.key)) {
      return { ok: false, error: `День повторяется: ${day.key}` };
    }
    if (!Array.isArray(day.busyRanges)) {
      return { ok: false, error: `busyRanges обязателен для ${day.key}` };
    }
    if (day.busyRanges.length > 24) {
      return { ok: false, error: `Слишком много диапазонов у ${day.key}` };
    }

    const ranges = [];
    for (const raw of day.busyRanges) {
      const range = normalizeRange(raw);
      if (!range) {
        return { ok: false, error: `Некорректный диапазон у ${day.key}` };
      }
      ranges.push(range);
    }

    const busyRanges = mergeBusyRanges(ranges);
    byKey.set(day.key, {
      key: day.key,
      label: DAY_LABELS[day.key],
      shortDate: String(day.shortDate || '').slice(0, 10),
      status: deriveDayStatus(busyRanges),
      busyRanges,
    });
  }

  for (const key of DAY_KEYS) {
    if (!byKey.has(key)) {
      return { ok: false, error: `Не хватает дня: ${key}` };
    }
  }

  const weekPlan = DAY_KEYS.map((key) => byKey.get(key));
  return {
    ok: true,
    data: {
      meta: {
        ...DEFAULT_AVAILABILITY.meta,
        ...(body.meta && typeof body.meta === 'object'
          ? {
              personName: String(body.meta.personName || DEFAULT_AVAILABILITY.meta.personName).slice(0, 80),
              timezoneLabel: String(
                body.meta.timezoneLabel || DEFAULT_AVAILABILITY.meta.timezoneLabel
              ).slice(0, 80),
              note: String(body.meta.note || DEFAULT_AVAILABILITY.meta.note).slice(0, 160),
            }
          : {}),
        workDayStart: WORK_START,
        workDayEnd: WORK_END,
        updatedAt: new Date().toISOString(),
      },
      weekPlan: withCurrentWeekDates(weekPlan),
    },
  };
}

export async function readAvailability(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const check = validateAvailabilityPayload(parsed);
    if (!check.ok) {
      const fallback = structuredClone(DEFAULT_AVAILABILITY);
      fallback.weekPlan = withCurrentWeekDates(fallback.weekPlan);
      return fallback;
    }
    return {
      meta: {
        ...DEFAULT_AVAILABILITY.meta,
        ...parsed.meta,
        updatedAt: parsed.meta?.updatedAt || null,
      },
      weekPlan: withCurrentWeekDates(check.data.weekPlan),
    };
  } catch {
    const fallback = structuredClone(DEFAULT_AVAILABILITY);
    fallback.weekPlan = withCurrentWeekDates(fallback.weekPlan);
    return fallback;
  }
}

export async function writeAvailabilityAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(tmp, payload, 'utf8');
  await fs.rename(tmp, filePath);
}

export function getLiveStatus(plan, now = new Date()) {
  const dayIndex = (now.getDay() + 6) % 7;
  const today = plan[dayIndex] || plan[0];
  const hour = now.getHours() + now.getMinutes() / 60;

  const formatHour = (h) => {
    const hours = Math.floor(h);
    const minutes = Math.round((h - hours) * 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  };

  if (today.status === 'free') {
    return {
      state: 'free',
      title: 'Сейчас свободна',
      detail: 'Можно согласовать уборку на сегодня или другой день',
      today,
    };
  }

  if (today.status === 'busy') {
    return {
      state: 'busy',
      title: 'Сегодня занята',
      detail: 'Выберите свободный день в расписании ниже',
      today,
    };
  }

  const currentBusy = today.busyRanges.find((r) => hour >= r.from && hour < r.to);
  if (currentBusy) {
    return {
      state: 'busy-now',
      title: `Занята до ${formatHour(currentBusy.to)}`,
      detail: 'После этого времени можно созвониться и записаться',
      today,
    };
  }

  const nextBusy = today.busyRanges.find((r) => r.from > hour);
  if (nextBusy) {
    return {
      state: 'free',
      title: 'Сейчас свободна',
      detail: `Ближайшая занятость сегодня: ${formatHour(nextBusy.from)}–${formatHour(nextBusy.to)}`,
      today,
    };
  }

  return {
    state: 'free',
    title: 'Сейчас свободна',
    detail: 'На сегодня ещё есть окна для записи',
    today,
  };
}
