import type { OfferResponse } from '@/types/offer';

// No `color` field exists on the backend — purely presentation, cycled
// per card so a scrolling row of offers doesn't read as one flat color.
export const OFFER_CARD_COLORS = ['#EC4899', '#8B5CF6', '#F59E0B', '#0EA5E9', '#10B981'];

/** "$20 OFF" / "20% OFF" / "Free Fee" — the one place this mapping lives. */
export function discountText(o: Pick<OfferResponse, 'discount_type' | 'discount_value'>): string {
  if (o.discount_type === 'PERCENTAGE') return `${o.discount_value}%`;
  if (o.discount_type === 'FIXED_AMOUNT') return `$${o.discount_value}`;
  return 'Free Fee';
}

// Single source of truth for the day-math — expiryText and isExpiryUrgent
// both derive from this instead of each recomputing it themselves.
function daysUntilExpiry(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  return Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000);
}

export function expiryText(expiresAt: string | null): string {
  const days = daysUntilExpiry(expiresAt);
  if (days === null) return 'No expiry';
  if (days <= 0) return 'Expired';
  if (days === 1) return 'Expires tomorrow';
  if (days <= 7) return `Expires in ${days} days`;
  return `Expires ${new Date(expiresAt as string).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

/** Only "Expired"/"Expires tomorrow" reads as genuinely urgent — a plain
 * "Expires in 4 days" shouldn't be styled as alarming as those. */
export function isExpiryUrgent(expiresAt: string | null): boolean {
  const days = daysUntilExpiry(expiresAt);
  return days !== null && days <= 1;
}
