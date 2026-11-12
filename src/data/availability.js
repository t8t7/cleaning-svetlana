/** SSR/demo fallback. Live data comes from GET /api/availability (Android app). */

export const availabilityMeta = {
  personName: 'Светлана',
  timezoneLabel: 'Йошкар-Ола',
  workDayStart: 8,
  workDayEnd: 20,
  note: 'Расписание обновляется с телефона мастера',
};

const BUSINESS_TZ = 'Europe/Moscow';
const WEEKDAY_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const DAY_LABELS = {
  mon: 'Пн',
  tue: 'Вт',
  wed: 'Ср',
  thu: 'Чт',
  fri: 'Пт',
  sat: 'Сб',
  sun: 'Вс',
};

/**
 * status: free | busy | partial
 * busyRanges: [{ from: 10, to: 14 }] in hours (24h)
 */
export const weekPlanBase = [
  { key: 'mon', label: 'Пн', shortDate: '10.11', status: 'partial', busyRanges: [{ from: 9, to: 13 }] },
  { key: 'tue', label: 'Вт', shortDate: '11.11', status: 'busy', busyRanges: [{ from: 8, to: 20 }] },
  { key: 'wed', label: 'Ср', shortDate: '12.11', status: 'free', busyRanges: [] },
  { key: 'thu', label: 'Чт', shortDate: '13.11', status: 'partial', busyRanges: [{ from: 14, to: 18 }] },
  { key: 'fri', label: 'Пт', shortDate: '14.11', status: 'free', busyRanges: [] },
  { key: 'sat', label: 'Сб', shortDate: '15.11', status: 'partial', busyRanges: [{ from: 10, to: 15 }] },
  { key: 'sun', label: 'Вс', shortDate: '16.11', status: 'busy', busyRanges: [{ from: 8, to: 20 }] },
];

export function getBusinessNow(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: BUSINESS_TZ,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  const hourRaw = Number(parts.hour);
  const hour = hourRaw === 24 ? 0 : hourRaw;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    dayIndex: WEEKDAY_INDEX[parts.weekday] ?? 0,
    hour: hour + Number(parts.minute) / 60,
    shortDate: `${parts.day}.${parts.month}`,
  };
}

export function withCurrentWeekDates(plan, now = new Date()) {
  const business = getBusinessNow(now);
  const todayNoonUtc = new Date(Date.UTC(business.year, business.month - 1, business.day, 12, 0, 0));
  const monday = new Date(todayNoonUtc);
  monday.setUTCDate(todayNoonUtc.getUTCDate() - business.dayIndex);

  return plan.map((day, i) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + i);
    const d = String(date.getUTCDate()).padStart(2, '0');
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    return {
      ...day,
      label: DAY_LABELS[day.key] || day.label,
      shortDate: `${d}.${m}`,
    };
  });
}

/** Current-week plan for SSR/demo (dates follow Europe/Moscow). */
export const weekPlan = withCurrentWeekDates(weekPlanBase);

export function getLiveStatus(plan = weekPlan, now = new Date()) {
  const business = getBusinessNow(now);
  const today = plan[business.dayIndex] || plan[0];
  const hour = business.hour;

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
    const until = formatHour(currentBusy.to);
    return {
      state: 'busy-now',
      title: `Занята до ${until}`,
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

export function formatHour(h) {
  const hours = Math.floor(h);
  const minutes = Math.round((h - hours) * 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function buildDaySlots(day, start = 8, end = 20) {
  const slots = [];
  for (let h = start; h < end; h += 1) {
    const busy = day.busyRanges.some((r) => h >= r.from && h < r.to);
    slots.push({
      from: h,
      to: h + 1,
      label: `${formatHour(h)}–${formatHour(h + 1)}`,
      busy,
    });
  }
  return slots;
}
