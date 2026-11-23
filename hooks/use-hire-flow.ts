import { useState } from 'react';
import { useHirePayment } from '@/hooks/use-hire-payment';

/** What hire() came to: hired (the checkout or the success message follows
 * on its own), or not — with why, for the screen to say. */
export type HireOutcome = { hired: true } | { hired: false; message?: string };

/**
 * Hiring an applicant, then paying what's due at hire — the one flow for
 * every screen that hires (the applicants list, an applicant's profile):
 *  - priced up front (the job's steps include PAY_UPFRONT): its checkout opens
 *    (offers, the bill, then Book) — render <BookingCheckout> with
 *    `checkoutOpen`, `book` and `skipCheckout`;
 *  - otherwise: the provider's visiting fee, charged straight away.
 * Then `doneVisible` — show the screen's "Hired" message with `doneMessage`.
 */
export function useHireFlow(jobId: string | undefined, paysUpfront: boolean) {
  const { hireApplicant, payInspectionFee, payBooking } = useHirePayment();
  const [hiringId, setHiringId] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [doneVisible, setDoneVisible] = useState(false);
  const [doneMessage, setDoneMessage] = useState('');

  const finish = (message: string) => {
    setDoneMessage(message);
    setDoneVisible(true);
  };

  const hire = async (applicationId: string): Promise<HireOutcome> => {
    if (!jobId || !applicationId) {
      // A stale or malformed link landed here without what it needs: nothing was hired.
      return { hired: false, message: "Couldn't hire this applicant — please go back and try again." };
    }
    setHiringId(applicationId);
    try {
      const result = await hireApplicant(jobId, applicationId);
      if (result.status !== 'success') {
        return { hired: false, message: result.status === 'error' ? result.message : undefined };
      }
      if (paysUpfront) {
        setCheckoutOpen(true);              // booked in the checkout — offers and the bill first
        return { hired: true };
      }
      const fee = await payInspectionFee(jobId);
      // Hired either way — a fee that needs another go is said, not treated as a failed hire.
      finish(
        fee.status === 'pending' ? fee.message
        : fee.status === 'error' ? `Visiting fee payment failed: ${fee.message}`
        : fee.status === 'cancelled'
          ? "You'll need to pay the visiting fee from the Track Provider screen before the provider can start inspecting."
        : fee.charged ? `$${fee.amount.toFixed(2)} visiting fee charged and held in escrow.`
        : 'This provider has no visiting fee.',
      );
      return { hired: true };
    } finally {
      setHiringId(null);
    }
  };

  /** The checkout's Book: pays the agreed total into escrow. */
  const book = async (offerCode: string | null) => {
    if (!jobId) return;
    const booking = await payBooking(jobId, offerCode);
    setCheckoutOpen(false);
    finish(
      booking.status === 'success' ? 'Booked — your payment is held safely until the job is done.'
      : booking.status === 'cancelled' ? 'Book and pay from the job screen to confirm it.'
      : booking.message,
    );
  };

  /** Closed without booking: hired all the same — booked from the job screen. */
  const skipCheckout = () => {
    setCheckoutOpen(false);
    finish('Book and pay from the job screen to confirm it.');
  };

  return {
    hire, hiringId, checkoutOpen, book, skipCheckout,
    doneVisible, doneMessage, closeDone: () => setDoneVisible(false),
  };
}
