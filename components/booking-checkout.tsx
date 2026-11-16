import { CheckoutSheet, CheckoutSource } from '@/components/checkout-sheet';
import { CheckoutBreakdown, SkoFyApi } from '@/services/api';
import React, { useMemo } from 'react';

// Booking a job priced up front: the shared checkout sheet with the booking's
// offers and bill (skofy-backend /jobs/{id}/book/*). An offer is on the price,
// never on a trip's waiting; `total` is what they pay with no waiting, and
// the note says what's only held on their card (app/domain/card_hold.py).

const money = (n: number) => `$${n.toFixed(2)}`;

function holdNote(b: CheckoutBreakdown): string | null {
  const hold = b.hold;
  if (!hold) return null;
  if (hold.on_card) {
    return hold.wait_hold > 0 && hold.most > b.total
      ? `Only if they wait: up to ${money(hold.wait_hold)} more. We hold ${money(hold.most)} on your card and take only what's used — the rest is released as soon as it's delivered.`
      : `We hold ${money(hold.most)} on your card and take it when it's done.`;
  }
  return hold.most > b.total
    ? `You pay ${money(hold.most)} now; whatever isn't used comes back to you automatically.`
    : null;
}

interface Props {
  visible: boolean;
  jobId: string;
  /** Books it with the applied offer code (or none). */
  onBook: (offerCode: string | null) => Promise<void>;
  onClose: () => void;
}

export function BookingCheckout({ visible, jobId, onBook, onClose }: Props) {
  // Made once per job: the sheet reloads when its source changes.
  const source = useMemo<CheckoutSource>(() => ({
    offers: () => SkoFyApi.jobs.bookingOffers(jobId),
    preview: (code) => SkoFyApi.jobs.previewBooking(jobId, code),
  }), [jobId]);
  return (
    <CheckoutSheet
      visible={visible}
      jobId={jobId}
      source={source}
      onPay={onBook}
      onClose={onClose}
      title="Book it"
      subtitle="Apply an offer or promo code, then book"
      amountLabel="Price"
      totalLabel="You pay"
      payLabel={(b) => `Book — ${money(b.total)}`}
      note={holdNote}
    />
  );
}
