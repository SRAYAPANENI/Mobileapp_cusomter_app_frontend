// When a job should happen (a booked slot) or be done by (an urgent
// deadline): the times a customer can pick. Pure — no React — so the picker
// only draws what this decides. Only future times exist here: a time that's
// already passed (or is too close to arrange anything) is never offered.
// The server refuses past times too (app/domain/job_shape.py has_passed).

/** The earliest pickable time is at least this far ahead. */
export const MIN_LEAD_MINUTES = 15;
/** The time list's step. */
export const SLOT_MINUTES = 30;
const FIRST_HOUR = 6; // 6:00 AM
const LAST_HOUR = 23; // last slot 11:30 PM

export interface TimeParts {
  hour: string; // "01".."12"
  minute: string; // "00".."59"
  period: 'AM' | 'PM';
}

export interface DayPart {
  title: string;
  slots: Date[];
}

export interface QuickPick {
  label: string;
  at: Date;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

export function sameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

/** "Today", "Tomorrow", or "Fri, Oct 24" — the labels the date picker uses. */
export function dayLabel(day: Date, now: Date): string {
  if (sameDay(day, now)) return 'Today';
  if (sameDay(day, addDays(now, 1))) return 'Tomorrow';
  return day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function earliestAllowed(now: Date): Date {
  return new Date(now.getTime() + MIN_LEAD_MINUTES * 60_000);
}

/** Whether it can be picked now: at least MIN_LEAD_MINUTES ahead. */
export function isPickable(at: Date, now: Date): boolean {
  return at.getTime() >= earliestAllowed(now).getTime();
}

/** Whether an already-picked (or AI-heard) time has gone by — the server's
 * own check. Softer than isPickable: a time picked 15 minutes ahead stays
 * valid while the customer finishes the form. */
export function hasPassed(at: Date, now: Date): boolean {
  return at.getTime() <= now.getTime();
}

/** The day's slots (6:00 AM – 11:30 PM, every 30 min) still ahead of `now`. */
export function slotsFor(day: Date, now: Date): Date[] {
  const base = startOfDay(day);
  const slots: Date[] = [];
  for (let h = FIRST_HOUR; h <= LAST_HOUR; h++) {
    for (let m = 0; m < 60; m += SLOT_MINUTES) {
      const at = new Date(base);
      at.setHours(h, m, 0, 0);
      if (isPickable(at, now)) slots.push(at);
    }
  }
  return slots;
}

/** Slots grouped the way people think about a day. Empty parts are left out. */
export function byPartOfDay(slots: Date[]): DayPart[] {
  const parts: DayPart[] = [
    { title: 'Morning', slots: [] },
    { title: 'Afternoon', slots: [] },
    { title: 'Evening', slots: [] },
    { title: 'Night', slots: [] },
  ];
  for (const at of slots) {
    const h = at.getHours();
    parts[h < 12 ? 0 : h < 17 ? 1 : h < 21 ? 2 : 3].slots.push(at);
  }
  return parts.filter((p) => p.slots.length > 0);
}

function roundUpTo(at: Date, minutes: number): Date {
  const step = minutes * 60_000;
  return new Date(Math.ceil(at.getTime() / step) * step);
}

/** One-tap choices: soon (in 1/2/4 hours, to the next quarter hour), tonight, tomorrow morning. */
export function quickPicks(now: Date): QuickPick[] {
  const picks: QuickPick[] = [1, 2, 4].map((h) => ({
    label: h === 1 ? 'In 1 hour' : `In ${h} hours`,
    at: roundUpTo(new Date(now.getTime() + h * 3_600_000), 15),
  }));
  const tonight = new Date(startOfDay(now));
  tonight.setHours(20, 0, 0, 0);
  if (isPickable(tonight, now) && tonight.getTime() > picks[picks.length - 1].at.getTime()) {
    picks.push({ label: 'Tonight 8 PM', at: tonight });
  }
  const tomorrowMorning = addDays(startOfDay(now), 1);
  tomorrowMorning.setHours(9, 0, 0, 0);
  picks.push({ label: 'Tomorrow 9 AM', at: tomorrowMorning });
  return picks;
}

export function toParts(at: Date): TimeParts {
  const h24 = at.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return {
    hour: String(h12).padStart(2, '0'),
    minute: String(at.getMinutes()).padStart(2, '0'),
    period: h24 < 12 ? 'AM' : 'PM',
  };
}

/** The moment for a day (an ISO date, or today when none) and a picked time. */
export function fromParts(dayISO: string | null | undefined, parts: TimeParts, now: Date = new Date()): Date {
  const at = dayISO ? startOfDay(new Date(dayISO)) : startOfDay(now);
  let h24 = parseInt(parts.hour, 10) % 12;
  if (parts.period === 'PM') h24 += 12;
  at.setHours(h24, parseInt(parts.minute, 10), 0, 0);
  return at;
}

/** "03:30 PM" */
export function timeText(at: Date): string {
  const p = toParts(at);
  return `${p.hour}:${p.minute} ${p.period}`;
}

/** "03:30 PM - 05:30 PM" — the two-hour window label the job form shows. */
export function windowLabel(at: Date): string {
  return `${timeText(at)} - ${timeText(new Date(at.getTime() + 2 * 3_600_000))}`;
}

/** "in 45 min", "in 2 h 15 min", "in 3 days". */
export function untilText(at: Date, now: Date): string {
  const mins = Math.max(0, Math.round((at.getTime() - now.getTime()) / 60_000));
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const rest = mins % 60;
    return rest ? `in ${hours} h ${rest} min` : `in ${hours} h`;
  }
  const days = Math.round(hours / 24);
  return days === 1 ? 'in 1 day' : `in ${days} days`;
}
