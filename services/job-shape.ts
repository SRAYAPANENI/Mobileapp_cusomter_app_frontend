// What kind of job the customer is posting, from three plain questions —
// where, how long, and what's left with the provider — turned into the job's
// shape the server runs it by (docs/JOB_SHAPE_DESIGN.md). The customer never
// picks a pricing unit: a few hours are priced per hour, a stay at their
// place per night, a stay at yours per day, and one visit by a quote after
// the provider sees the job.

export type Where = 'MY_PLACE' | 'THEIR_PLACE' | 'ONLINE';
/** How the skill is priced — one standard way per profession
 * (skofy-backend/app/domain/skill_pricing.py). Decides which questions apply. */
export type SkillPricing = 'QUOTE' | 'HOUR' | 'VISIT' | 'NIGHT' | 'DAY';
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
  pricing_unit: 'QUOTE' | 'HOUR' | 'DAY' | 'NIGHT' | 'VISIT';
  ends_at?: string;
  /** What's left in care — each pet's needs, or the item (services/care-sheet.ts). */
  care_sheet?: Record<string, unknown>;
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

interface PricingRules { howLong: HowLong; wheres: Where[]; inCares: InCare[]; note: string }

/** What a pricing type allows: how long is fixed by it, and only the places
 * and things-in-care that fit. */
export const PRICING_RULES: Record<SkillPricing, PricingRules> = {
  QUOTE: { howLong: 'ONCE', wheres: ['MY_PLACE', 'ONLINE'], inCares: ['NONE'],
    note: 'Priced by a quote: the provider sees the job, then sends their price for you to approve.' },
  VISIT: { howLong: 'ONCE', wheres: ['MY_PLACE', 'THEIR_PLACE', 'ONLINE'], inCares: ['NONE', 'LIVING_BEING', 'ITEM'],
    note: "One visit at the provider's set price — you'll see each one's price before you choose, and pay when you book." },
  HOUR: { howLong: 'HOURS', wheres: ['MY_PLACE', 'THEIR_PLACE', 'ONLINE'], inCares: ['NONE', 'LIVING_BEING', 'ITEM', 'HOME'],
    note: "Booked by the hour — you'll see each provider's total before you choose, and pay when you book." },
  NIGHT: { howLong: 'DAYS', wheres: ['THEIR_PLACE', 'MY_PLACE'], inCares: ['LIVING_BEING', 'ITEM', 'HOME', 'NONE'],
    note: "Priced per night — longer stays use the provider's weekly or monthly price when it costs less." },
  DAY: { howLong: 'DAYS', wheres: ['THEIR_PLACE', 'MY_PLACE'], inCares: ['LIVING_BEING', 'ITEM', 'HOME', 'NONE'],
    note: "Priced per day — longer stays use the provider's weekly or monthly price when it costs less." },
};

/** The choices still allowed with this one changed — online work has nothing
 * in care and no stays; a home can only be looked after at your place. With
 * the skill's pricing known, it decides how long and what fits. */
export function normalize(choice: JobChoice, pricing?: SkillPricing | null): JobChoice {
  const next = { ...choice };
  if (pricing) {
    const rules = PRICING_RULES[pricing];
    next.howLong = rules.howLong;
    if (!rules.wheres.includes(next.where)) next.where = rules.wheres[0];
    if (!rules.inCares.includes(next.inCare)) next.inCare = rules.inCares[0];
  }
  if (next.where === 'ONLINE') {
    next.inCare = 'NONE';
    if (next.howLong === 'DAYS') next.howLong = 'HOURS';
  }
  if (next.inCare === 'HOME' && next.where !== 'MY_PLACE') next.inCare = 'NONE';
  if (!pricing && next.howLong === 'ONCE' && bookedForSetTime(next)) next.howLong = 'HOURS';
  if (next.howLong === 'ONCE') { next.startISO = null; next.endISO = null; }
  return next;
}

/** The shape to post, or what's missing — in words fit to show. The skill's
 * pricing sets the unit (the server checks it the same way). */
export function shapeFor(
  choice: JobChoice, now: Date = new Date(), pricing?: SkillPricing | null,
): { shape: JobShapePayload } | { error: string } {
  const venue = VENUE[choice.where];
  if (choice.howLong === 'ONCE') {
    return { shape: { venue, timing: 'ONCE', custody: choice.inCare, pricing_unit: pricing === 'VISIT' ? 'VISIT' : 'QUOTE' } };
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
  // Things left in storage can stay up to a year; a pet or a home sit, 90 days.
  const longestDays = choice.inCare === 'ITEM' ? 365 : 90;
  if (choice.howLong === 'DAYS' && hours > longestDays * 24) return { error: `A stay can be up to ${longestDays} days.` };
  if (choice.howLong === 'HOURS') {
    return { shape: { venue, timing: 'WINDOW', custody: choice.inCare, pricing_unit: 'HOUR', ends_at: end.toISOString() } };
  }
  const stayUnit = pricing === 'NIGHT' || pricing === 'DAY' ? pricing : choice.where === 'THEIR_PLACE' ? 'NIGHT' : 'DAY';
  return {
    shape: { venue, timing: 'STAY', custody: choice.inCare, pricing_unit: stayUnit, ends_at: end.toISOString() },
  };
}

/** One line under the choices: how the price works. */
export function priceHint(choice: JobChoice, pricing?: SkillPricing | null): string {
  if (pricing) return PRICING_RULES[pricing].note;
  if (choice.howLong === 'ONCE') return 'Your provider quotes the price after seeing the job — you approve it before paying.';
  const unit = choice.howLong === 'HOURS' ? 'hour' : choice.where === 'THEIR_PLACE' ? 'night' : 'day';
  const longer = choice.howLong === 'DAYS' ? ' Longer stays use their weekly or monthly price when it costs less.' : '';
  return `Providers have a price per ${unit} — you'll see each one's total before you choose, and pay when you book.${longer}`;
}

/** The customer's time zone — nights and days are counted in it. */
export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
