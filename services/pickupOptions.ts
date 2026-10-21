// Pickup & Drop options — the rules behind the form's choices, with no UI.
// The server checks the same rules (skofy-backend app/domain/pickup.py).

export type PickupPurchase = 'PREPAID' | 'BUY_FOR_ME';

/** A store (an allowlisted business) or a person (any address — a friend's house). */
export type PickupSource = 'STORE' | 'PERSON';

/** A pickup from a person: the server's cap and list (GET /jobs/pickup-from-person). */
export interface PersonPickupRules {
  max_value: number;
  banned: string;
}

export const DEFAULT_PERSON_PICKUP_RULES: PersonPickupRules = {
  max_value: 500,
  banned: 'alcohol, tobacco or vapes, cannabis, medication, weapons, cash, or anything illegal',
};

/** Pasted text that holds a link — a shared location, read by the server
 * (POST /jobs/pickup-location-link) instead of searched for. */
export function looksLikeLink(text: string): boolean {
  return /https?:\/\//i.test(text);
}

/** An ID number and at least one ID photo on the profile. The photos are
 * saved as a JSON list, so removing them all leaves "[]" — that's none.
 * Same rule as the server (customer_repo.has_id_on_file). */
export function hasIdOnFile(profile: { id_number?: string | null; id_document_url?: string | null }): boolean {
  const docs = (profile.id_document_url ?? '').trim();
  return !!profile.id_number?.trim() && !!docs && docs !== '[]' && docs !== 'null';
}

/** Why a pickup from a person can't be posted yet, or null. Same rules as the server (app/domain/pickup.py). */
export function personPickupError(
  item: string, valueText: string, declared: boolean, rules: PersonPickupRules,
): string | null {
  if (!item.trim()) return 'Say what the item is — e.g. house keys, a phone charger.';
  const value = parseLimit(valueText);
  if (value === null || value > rules.max_value) return `Enter what it's worth — up to $${rules.max_value}.`;
  if (!declared) return `Confirm it isn't ${rules.banned}.`;
  return null;
}

export type PickupTiming =
  | { kind: 'ASAP' }
  | { kind: 'SCHEDULED'; at: Date | null };

/** The most a customer can ask a provider to spend for them. */
export const MAX_PURCHASE_LIMIT = 1000;

/** Shown on the form: the platform doesn't do age or licence checks at the door. */
export const NOT_DELIVERED_NOTE =
  "We can't deliver alcohol, tobacco, vapes or controlled medication.";

export function parseLimit(text: string): number | null {
  const n = Number(text.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/** Why the payment choice can't be posted yet, or null. */
export function purchaseError(purchase: PickupPurchase, limitText: string): string | null {
  if (purchase === 'PREPAID') return null;
  const limit = parseLimit(limitText);
  if (limit === null || limit < 1 || limit > MAX_PURCHASE_LIMIT) {
    return `Set how much the provider may spend, $1 to $${MAX_PURCHASE_LIMIT}.`;
  }
  return null;
}

/** A time on today (dayOffset 0) or tomorrow (1), from the time picker's parts. */
export function scheduleAt(dayOffset: 0 | 1, hour12: string, minute: string, period: string): Date {
  const at = new Date();
  at.setDate(at.getDate() + dayOffset);
  const hour = (parseInt(hour12, 10) % 12) + (period === 'PM' ? 12 : 0);
  at.setHours(hour, parseInt(minute, 10), 0, 0);
  return at;
}

/** Why the timing can't be posted yet, or null. */
export function timingError(timing: PickupTiming): string | null {
  if (timing.kind === 'ASAP') return null;
  if (!timing.at) return 'Pick a time for the delivery.';
  if (timing.at.getTime() < Date.now() + 15 * 60 * 1000) return 'Pick a time at least 15 minutes from now.';
  return null;
}

/** The job fields these choices become. */
export function pickupJobFields(options: {
  timing: PickupTiming; purchase: PickupPurchase; limitText: string; notes: string; dropoffAddress: string;
  details: PickupDetails; items: ShoppingItem[];
}) {
  const buying = options.purchase === 'BUY_FOR_ME';
  const scheduled = options.timing.kind === 'SCHEDULED' && options.timing.at;
  return {
    // As soon as possible is urgent; a scheduled time is a booked slot.
    urgency: (scheduled ? 'LOW' : 'HIGH') as 'LOW' | 'HIGH',
    ...(scheduled ? { scheduled_at: (options.timing as { at: Date }).at.toISOString() } : {}),
    pickup_purchase: options.purchase as PickupPurchase,
    ...(buying
      ? { purchase_limit: parseLimit(options.limitText), shopping_list: filledItems(options.items) }
      : { pickup_details: cleanDetails(options.details) }),
    dropoff_address: options.dropoffAddress || undefined,
    dropoff_notes: options.notes.trim() || undefined,
  };
}

// ── What to collect ──────────────────────────────────────────────────────────

/** Already paid: what the store needs to hand the order over. Shown only to
 * the hired provider; the store code is hidden again once it's collected. */
export interface PickupDetails {
  order_name?: string;
  order_number?: string;
  pickup_code?: string;
  store_contact?: string;
  /** From a person: who hands it over (shown to the hired provider only). */
  handover_name?: string;
  handover_phone?: string;
}

export type IfUnavailable = 'SUBSTITUTE' | 'SKIP' | 'CALL';

/** Buy it for me: one line of the shopping list. */
export interface ShoppingItem {
  name: string;
  quantity: number;
  if_unavailable: IfUnavailable;
}

export const MAX_SHOPPING_ITEMS = 30;

export const IF_UNAVAILABLE_LABELS: Record<IfUnavailable, string> = {
  CALL: 'Call me',
  SUBSTITUTE: 'Similar is fine',
  SKIP: 'Skip it',
};

export function newShoppingItem(): ShoppingItem {
  return { name: '', quantity: 1, if_unavailable: 'CALL' };
}

/** The list as it's posted: blank lines dropped. */
export function filledItems(items: ShoppingItem[]): ShoppingItem[] {
  return items
    .map(i => ({ ...i, name: i.name.trim() }))
    .filter(i => i.name.length > 0);
}

/** Why the shopping list can't be posted yet, or null. */
export function shoppingListError(purchase: PickupPurchase, items: ShoppingItem[]): string | null {
  if (purchase !== 'BUY_FOR_ME') return null;
  const n = filledItems(items).length;
  if (n === 0) return 'Add at least one item to buy.';
  if (n > MAX_SHOPPING_ITEMS) return `A shopping list can have up to ${MAX_SHOPPING_ITEMS} items.`;
  return null;
}

function cleanDetails(details: PickupDetails): PickupDetails {
  const out: PickupDetails = {};
  (Object.keys(details) as (keyof PickupDetails)[]).forEach(k => {
    const v = details[k]?.trim();
    if (v) out[k] = v;
  });
  return out;
}

// ── Buy it for me: the shopping money held at hire ───────────────────────────
// Same numbers as the server (app/domain/pickup.py): no 12% on the goods —
// a 5% shopping fee on what's actually bought, between $1.99 and $9.99.

export const SHOPPING_FEE_RATE = 0.05;
export const MIN_SHOPPING_FEE = 1.99;
export const MAX_SHOPPING_FEE = 9.99;

const cents = (n: number) => Math.round(n * 100) / 100;

export function shoppingFee(goods: number): number {
  if (!(goods > 0)) return 0;
  return Math.min(Math.max(cents(goods * SHOPPING_FEE_RATE), MIN_SHOPPING_FEE), MAX_SHOPPING_FEE);
}

/** What's held at hire: the limit plus the most the fee can be (before the card fee). */
export function goodsHoldAmount(limit: number): number {
  return cents(limit + shoppingFee(limit));
}

/** After pickup: the items, the fee, and what comes back from the hold (card fee aside). */
export function goodsSplitPreview(limit: number, goods: number): { goods: number; fee: number; back: number } {
  const held = goodsHoldAmount(limit);
  const bought = Math.min(Math.max(cents(goods), 0), held);
  const fee = Math.min(shoppingFee(bought), cents(held - bought));
  return { goods: bought, fee, back: cents(held - bought - fee) };
}
