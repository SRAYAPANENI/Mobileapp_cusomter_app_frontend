// What kind of job the customer is posting, from three plain questions —
// where, how long, and what's left with the provider — turned into the job's
// shape the server runs it by (docs/JOB_SHAPE_DESIGN.md). The customer never
// picks a pricing unit: a few hours are priced per hour, a stay at their
// place per night, a stay at yours per day, and one visit by a quote after
// the provider sees the job.

export type Where = 'MY_PLACE' | 'THEIR_PLACE' | 'ONLINE';
export type HowLong = 'ONCE' | 'HOURS' | 'DAYS';
export type InCare = 'NONE' | 'LIVING_BEING' | 'ITEM' | 'HOME';

export interface JobChoice {
  where: Where;
  howLong: HowLong;
  inCare: InCare;
  /** For a few hours or a stay: when it starts and ends. */
  startISO: string | null;
  endISO: string | null;
}

export interface JobShapePayload {
  venue: 'CUSTOMER_PLACE' | 'PROVIDER_PLACE' | 'ONLINE';
  timing: 'ONCE' | 'WINDOW' | 'STAY';
  custody: InCare;
  pricing_unit: 'QUOTE' | 'HOUR' | 'DAY' | 'NIGHT';
  ends_at?: string;
}

export const DEFAULT_CHOICE: JobChoice = { where: 'MY_PLACE', howLong: 'ONCE', inCare: 'NONE', startISO: null, endISO: null };

const VENUE: Record<Where, JobShapePayload['venue']> = {
  MY_PLACE: 'CUSTOMER_PLACE', THEIR_PLACE: 'PROVIDER_PLACE', ONLINE: 'ONLINE',
};

/** Work at their place, or with something left in their care, is booked for
 * a set time and priced up front — not one visit with a quote (the server
 * refuses that pairing: app/services/job_capability.py). */
export function bookedForSetTime(choice: Pick<JobChoice, 'where' | 'inCare'>): boolean {
  return choice.where === 'THEIR_PLACE' || choice.inCare !== 'NONE';
}

/** The choices still allowed with this one changed — online work has nothing
 * in care and no stays; a home can only be looked after at your place. */
export function normalize(choice: JobChoice): JobChoice {
  const next = { ...choice };
  if (next.where === 'ONLINE') {
    next.inCare = 'NONE';
    if (next.howLong === 'DAYS') next.howLong = 'HOURS';
  }
  if (next.inCare === 'HOME' && next.where !== 'MY_PLACE') next.inCare = 'NONE';
  if (next.howLong === 'ONCE' && bookedForSetTime(next)) next.howLong = 'HOURS';
  if (next.howLong === 'ONCE') { next.startISO = null; next.endISO = null; }
  return next;
}

/** The shape to post, or what's missing — in words fit to show. */
export function shapeFor(choice: JobChoice, now: Date = new Date()): { shape: JobShapePayload } | { error: string } {
  const venue = VENUE[choice.where];
  if (choice.howLong === 'ONCE') {
    return { shape: { venue, timing: 'ONCE', custody: choice.inCare, pricing_unit: 'QUOTE' } };
  }
  if (!choice.startISO || !choice.endISO) {
    return { error: choice.howLong === 'DAYS' ? 'Choose the drop-off and pick-up times.' : 'Choose when it starts and ends.' };
  }
  const start = new Date(choice.startISO);
  const end = new Date(choice.endISO);
  if (start.getTime() < now.getTime() - 2 * 60 * 1000) return { error: 'The start has already passed — choose a later one.' };
  if (end.getTime() <= start.getTime()) return { error: 'The end must be after the start.' };
  // The server's limits (app/domain/job_shape.py _LONGEST).
  const hours = (end.getTime() - start.getTime()) / 3600000;
  if (choice.howLong === 'HOURS' && hours > 24) return { error: "A few hours can't run past a day — choose “Over days” instead." };
  if (choice.howLong === 'DAYS' && hours > 90 * 24) return { error: 'A stay can be up to 90 days.' };
  if (choice.howLong === 'HOURS') {
    return { shape: { venue, timing: 'WINDOW', custody: choice.inCare, pricing_unit: 'HOUR', ends_at: end.toISOString() } };
  }
  return {
    shape: {
      venue, timing: 'STAY', custody: choice.inCare,
      pricing_unit: choice.where === 'THEIR_PLACE' ? 'NIGHT' : 'DAY',
      ends_at: end.toISOString(),
    },
  };
}

/** One line under the choices: how the price works. */
export function priceHint(choice: JobChoice): string {
  if (choice.howLong === 'ONCE') return 'Your provider quotes the price after seeing the job — you approve it before paying.';
  const unit = choice.howLong === 'HOURS' ? 'hour' : choice.where === 'THEIR_PLACE' ? 'night' : 'day';
  return `Providers have a price per ${unit} — you'll see each one's total before you choose, and pay when you book.`;
}

/** The customer's time zone — nights and days are counted in it. */
export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
