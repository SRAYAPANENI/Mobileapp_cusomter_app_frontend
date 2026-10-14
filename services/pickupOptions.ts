// Pickup & Drop options — the rules behind the form's choices, with no UI.
// The server checks the same rules (skofy-backend app/domain/pickup.py).

export type PickupPurchase = 'PREPAID' | 'BUY_FOR_ME';

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
}) {
  const scheduled = options.timing.kind === 'SCHEDULED' && options.timing.at;
  return {
    // As soon as possible is urgent; a scheduled time is a booked slot.
    urgency: (scheduled ? 'LOW' : 'HIGH') as 'LOW' | 'HIGH',
    ...(scheduled ? { scheduled_at: (options.timing as { at: Date }).at.toISOString() } : {}),
    pickup_purchase: options.purchase as PickupPurchase,
    ...(options.purchase === 'BUY_FOR_ME' ? { purchase_limit: parseLimit(options.limitText) } : {}),
    dropoff_address: options.dropoffAddress || undefined,
    dropoff_notes: options.notes.trim() || undefined,
  };
}
