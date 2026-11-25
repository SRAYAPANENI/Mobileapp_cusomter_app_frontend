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

// The catalogue's place codes → the places offered (pick-up & drop-off is its own flow).
// R (movers, towing, a courier) collects at your place — offered as "At my place".
const CODE_WHERE: Record<string, Where> = { C: 'MY_PLACE', P: 'THEIR_PLACE', O: 'ONLINE', R: 'MY_PLACE' };

/** The places to offer: those the pricing type allows, and where the skill is
 * actually done ("C,O" from the catalogue). Never empty. */
export function wheresFor(pricing?: SkillPricing | null, venues?: string | null, hosting = true): Where[] {
  const all = pricing ? PRICING_RULES[pricing].wheres : (['MY_PLACE', 'THEIR_PLACE', 'ONLINE'] as Where[]);
  // Hosting turned off (App Settings): not offered — the server refuses it.
  const byPricing = hosting ? all : all.filter((w) => w !== 'THEIR_PLACE');
  const done = (venues ?? '').split(',').map((c) => CODE_WHERE[c.trim()]).filter(Boolean);
  const both = done.length ? byPricing.filter((w) => done.includes(w)) : byPricing;
  return both.length ? both : byPricing;
}

/** A skill as the form needs it. `pricing` as the server names it — it can
 * be one this form doesn't book (TRIP), or one newer than this app. */
export interface JobSkill { id: string; name: string; pricing: string | null; venues: string | null }

/** The pricing, when this form knows how to ask for it. */
export function formPricing(pricing: string | null | undefined): SkillPricing | null {
  return pricing && Object.prototype.hasOwnProperty.call(PRICING_RULES, pricing) ? (pricing as SkillPricing) : null;
}

/** Why this skill can't be booked here at all, in words fit to show — said
 * before anything is asked, instead of offering places the server refuses. */
export function notBookable(
  pricing: string | null | undefined, venues: string | null | undefined, hosting = true,
): { text: string; pickup?: boolean } | null {
  if (pricing === 'TRIP') return { text: 'Pick-up and delivery has its own form, priced by the trip.', pickup: true };
  const done = (venues ?? '').split(',').map((c) => CODE_WHERE[c.trim()]).filter(Boolean);
  if (!done.length || done.some((w) => w !== 'THEIR_PLACE')) return null;
  if (!hosting) return { text: "This is done at the provider's place, and those jobs are turned off right now." };
  if (pricing === 'QUOTE') return { text: "This is done at the provider's shop. Booking jobs at a shop is coming soon." };
  return null;
}

/** The choices still allowed with this one changed — online work has nothing
 * in care and no stays; a home can only be looked after at your place. With
 * the skill's pricing known, it decides how long and what fits. */
export function normalize(choice: JobChoice, pricing?: SkillPricing | null, venues?: string | null, hosting = true): JobChoice {
  const next = { ...choice };
  const wheres = wheresFor(pricing, venues, hosting);
  if (!wheres.includes(next.where)) next.where = wheres[0];
  if (pricing) {
    const rules = PRICING_RULES[pricing];
    next.howLong = rules.howLong;
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

/** Work booked by the hour runs at most this long in one go (the server's
 * limit: app/domain/job_shape.py _LONGEST). */
export const MAX_HOURS = 24;
/** One-tap lengths for it. */
export const QUICK_HOURS = [1, 2, 3, 4, 8];
const HOUR_MS = 3600000;

/** How long it's booked for, in hours; null until both times make sense. */
export function bookedHours(choice: Pick<JobChoice, 'startISO' | 'endISO'>): number | null {
  if (!choice.startISO || !choice.endISO) return null;
  const hours = (new Date(choice.endISO).getTime() - new Date(choice.startISO).getTime()) / HOUR_MS;
  return hours > 0 ? hours : null;
}

/** "45 min", "3 hours", "2 h 30 min". */
export function hoursText(hours: number): string {
  const mins = Math.round(hours * 60);
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h === 0) return `${m} min`;
  return m ? `${h} h ${m} min` : h === 1 ? '1 hour' : `${h} hours`;
}

export function endAfter(startISO: string, hours: number): string {
  return new Date(new Date(startISO).getTime() + hours * HOUR_MS).toISOString();
}

/** A new start. Work booked by the hour keeps its length and moves with it —
 * an "until" left on the old day made it days long without anyone choosing
 * that. One too long to be booked is chosen again. */
export function withStart(choice: JobChoice, startISO: string): JobChoice {
  if (choice.howLong !== 'HOURS') return { ...choice, startISO };
  const hours = bookedHours(choice);
  return { ...choice, startISO, endISO: hours !== null && hours <= MAX_HOURS ? endAfter(startISO, hours) : null };
}

/** The longest it can run, in hours. Things left in storage can stay up to a
 * year; a pet or a home sit, 90 days (app/domain/job_shape.py _LONGEST). */
export function longestHours(choice: Pick<JobChoice, 'howLong' | 'inCare'>): number {
  return choice.howLong === 'HOURS' ? MAX_HOURS : (choice.inCare === 'ITEM' ? 365 : 90) * 24;
}

/** Too long to be booked: why, and what to do that's actually on screen
 * ("Over days" is only offered when the skill's pricing doesn't decide). */
export function tooLongProblem(choice: JobChoice, pricing?: SkillPricing | null): string | null {
  const hours = bookedHours(choice);
  if (choice.howLong === 'ONCE' || hours === null || hours <= longestHours(choice)) return null;
  if (choice.howLong === 'DAYS') return `A stay can be up to ${longestHours(choice) / 24} days.`;
  const fix = !pricing && choice.where !== 'ONLINE'
    ? 'Choose an earlier “Until”, or “Over days”.'
    : 'Choose an earlier “Until”. For more days, post each one separately.';
  return `This is booked by the hour, up to ${MAX_HOURS} hours at a time. Your times add up to ${hoursText(hours)}. ${fix}`;
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
  const tooLong = tooLongProblem(choice, pricing);
  if (tooLong) return { error: tooLong };
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
