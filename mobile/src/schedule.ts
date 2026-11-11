import type { BusyRange, DayPlan } from './types';

export const WORK_START = 8;
export const WORK_END = 20;

export function hourBusy(busyRanges: BusyRange[], hour: number): boolean {
  return busyRanges.some((r) => hour >= r.from && hour < r.to);
}

export function toggleHour(busyRanges: BusyRange[], hour: number): BusyRange[] {
  const hours = new Set<number>();
  for (let h = WORK_START; h < WORK_END; h += 1) {
    if (hourBusy(busyRanges, h)) hours.add(h);
  }
  if (hours.has(hour)) hours.delete(hour);
  else hours.add(hour);

  const sorted = [...hours].sort((a, b) => a - b);
  const merged: BusyRange[] = [];
  for (const h of sorted) {
    const last = merged[merged.length - 1];
    if (!last || h > last.to) merged.push({ from: h, to: h + 1 });
    else last.to = h + 1;
  }
  return merged;
}

export function deriveStatus(busyRanges: BusyRange[]): DayPlan['status'] {
  const total = WORK_END - WORK_START;
  let busy = 0;
  for (let h = WORK_START; h < WORK_END; h += 1) {
    if (hourBusy(busyRanges, h)) busy += 1;
  }
  if (busy <= 0) return 'free';
  if (busy >= total) return 'busy';
  return 'partial';
}

export function setDayFullyFree(day: DayPlan): DayPlan {
  return { ...day, busyRanges: [], status: 'free' };
}

export function setDayFullyBusy(day: DayPlan): DayPlan {
  return {
    ...day,
    busyRanges: [{ from: WORK_START, to: WORK_END }],
    status: 'busy',
  };
}

export function formatHour(h: number): string {
  return `${String(Math.floor(h)).padStart(2, '0')}:00`;
}
