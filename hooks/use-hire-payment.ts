import { useStripe } from '@stripe/stripe-react-native';
import { Alert } from 'react-native';

import { SkoFyApi, STRIPE_PUBLISHABLE_KEY } from '@/services/api';

// Tracks whichever Stripe key is actually configured, not the JS bundle's
// dev/release mode — those are different axes, and a release build can
// still be running against Stripe test keys (as it is during this testing
// phase). Flips itself once STRIPE_PUBLISHABLE_KEY becomes a real pk_live_ key.
const STRIPE_TEST_MODE = STRIPE_PUBLISHABLE_KEY.startsWith('pk_test_');

type PaymentResult =
  | { status: 'success' }
  | { status: 'cancelled' }
  // The card was charged (PaymentSheet reported success) but the backend
  // hadn't confirmed HELD after 5s of polling — usually just a slow
  // webhook, not a decline. Distinct from 'error' specifically so callers
  // don't tell the customer "Payment Failed" for a charge that most likely
  // went through, and don't invite an immediate retry that could create a
  // second payment intent for the same job.
  | { status: 'pending'; message: string }
  | { status: 'error'; message: string };

type FeePaymentResult =
  | { status: 'success'; charged: boolean; amount: number }
  | { status: 'cancelled' }
  | { status: 'pending'; message: string }
  | { status: 'error'; message: string };

/** A bank payment (ACH) clears in days; the job starts on its own when it does. */
export const BANK_PAYMENT_PENDING =
  "Your bank payment is on its way — it takes 3–5 business days to clear. The job starts automatically when it does, and we'll let you both know.";

const PAYMENT_ELIGIBILITY_CODES = new Set([
  'CONNECT_ONBOARDING_INCOMPLETE',
  'BACKGROUND_CHECK_PENDING',
  'LICENSE_NOT_VERIFIED',
]);

// Every field below has its own separate light/dark default baked into the
// native Stripe SDK — only overriding primary/primaryText/componentBackground
// (as this used to) left everything else (background, borders, placeholder
// text, icons...) following the DEVICE's system theme, so on a phone in dark
// mode the sheet rendered as a dark shell around a few white input rows. The
// rest of the app is locked to light mode (see voice-post-modal.tsx's note on
// the same constraint) — pin every field here too so this doesn't depend on
// system theme at all.
const SKOFY_PAYMENT_SHEET_APPEARANCE = {
  colors: {
    primary: '#FFCE48',
    background: '#FFFFFF',
    componentBackground: '#F9FAFB',
    componentBorder: '#E5E7EB',
    componentDivider: '#E5E7EB',
    primaryText: '#111111',
    secondaryText: '#6B7280',
    componentText: '#111111',
    placeholderText: '#9CA3AF',
    icon: '#6B7280',
    error: '#EF4444',
  },
  shapes: { borderRadius: 12 },
  primaryButton: {
    colors: { background: '#FFCE48', text: '#111111' },
  },
};

// "pi_123_secret_abc" → "pi_123": the payment's id, as the server knows it.
const intentIdOf = (clientSecret: string) => clientSecret.split('_secret_')[0];

/** Testing only (Stripe test keys): pay with Stripe's test card in one tap,
 * or type a card into Stripe's sheet as usual. Never shown with live keys.
 * The system's own dialog, so it shows above any open sheet. */
function chooseTestPayment(buttonLabel?: string): Promise<'test-card' | 'card' | 'cancel'> {
  return new Promise((resolve) => {
    Alert.alert(
      'Test mode',
      `${buttonLabel ? `${buttonLabel}. ` : ''}Payments are in test mode — no real money moves. Pay with Stripe's test card in one tap, or enter a card (use 4242 4242 4242 4242, any future date, any CVC).`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve('cancel') },
        { text: 'Enter a card', onPress: () => resolve('card') },
        { text: 'Use test card', onPress: () => resolve('test-card') },
      ],
      { cancelable: true, onDismiss: () => resolve('cancel') },
    );
  });
}

/** Bidding is retired — hiring itself no longer involves any payment (there's
 * no agreed price yet). Both apps' PaymentSheet flows now happen later:
 * the inspection fee right after hire, and the job cost once an invoice is
 * accepted post-inspection. See payInspectionFee / payInvoice below. */
export function useHirePayment() {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const holdLabel = (intent: { hold?: boolean; amount?: number }) =>
    intent.hold && intent.amount ? `Hold $${intent.amount.toFixed(2)}` : undefined;

  // `bankPayment`: the server offered ACH too (a big job) — the sheet must
  // allow a method that clears in days.
  // `buttonLabel`: the sheet's own button — "Hold $12.51" for a hold on the
  // card (only what's used is taken), so it never reads as paying it all.
  const runPaymentSheet = async (clientSecret: string, bankPayment = false, buttonLabel?: string): Promise<PaymentResult> => {
    if (STRIPE_TEST_MODE) {
      const way = await chooseTestPayment(buttonLabel);
      if (way === 'cancel') return { status: 'cancelled' };
      if (way === 'test-card') {
        try {
          await SkoFyApi.payments.payWithTestCard(intentIdOf(clientSecret));
          return { status: 'success' };
        } catch (err: any) {
          return { status: 'error', message: err?.message ?? "The test payment didn't go through. Please try again." };
        }
      }
    }
    const { ephemeral_key_secret, stripe_customer_id } = await SkoFyApi.payments.createEphemeralKey();
    const { error: initError } = await initPaymentSheet({
      merchantDisplayName: 'Dodorez',
      customerId: stripe_customer_id,
      customerEphemeralKeySecret: ephemeral_key_secret,
      paymentIntentClientSecret: clientSecret,
      allowsDelayedPaymentMethods: bankPayment,
      // Cash App Pay and pay-over-time (Affirm, Klarna) hand off to their own
      // app or page and come back here — when the server offers them
      // (app/domain/payment_methods.py).
      returnURL: 'skofycustomerapp://stripe-redirect',
      // One-tap options alongside manual card entry. Google Pay works as
      // soon as the device has it set up — no extra account setup needed
      // beyond enableGooglePay in app.json's Stripe plugin config. Apple
      // Pay is wired the same way, but the button won't actually appear
      // until merchantIdentifier in app.json is a real Apple Merchant ID
      // (requires an Apple Developer account + registering it with both
      // Apple and Stripe) — today it's still a placeholder.
      googlePay: { merchantCountryCode: 'US', testEnv: STRIPE_TEST_MODE },
      applePay: { merchantCountryCode: 'US' },
      appearance: SKOFY_PAYMENT_SHEET_APPEARANCE,
      ...(buttonLabel ? { primaryButtonLabel: buttonLabel } : {}),
    });
    if (initError) return { status: 'error', message: initError.message };

    const { error: presentError } = await presentPaymentSheet();
    if (presentError) {
      if (presentError.code === 'Canceled') return { status: 'cancelled' };
      return { status: 'error', message: presentError.message };
    }
    return { status: 'success' };
  };

  const hireApplicant = async (jobId: string, applicationId: string): Promise<PaymentResult> => {
    try {
      await SkoFyApi.jobs.hireApplicant(jobId, applicationId);
      return { status: 'success' };
    } catch (err: any) {
      if (PAYMENT_ELIGIBILITY_CODES.has(err?.error_code)) {
        return { status: 'error', message: "This provider hasn't finished payout setup yet — try another applicant." };
      }
      return { status: 'error', message: err?.message ?? 'Failed to hire provider. Please try again.' };
    }
  };

  /** Call right after hireApplicant() succeeds. Polls for HELD the same way
   * hire used to — payment_service.get_status self-heals against Stripe
   * directly if a webhook hasn't landed yet, so this doesn't purely depend
   * on webhook delivery timing. Returns charged/amount so the caller can show
   * an explicit confirmation — silently succeeding with no visible feedback
   * looked indistinguishable from nothing having happened at all. */
  const payInspectionFee = (jobId: string) =>
    payHold(jobId, 'INSPECTION_FEE', SkoFyApi.payments.createInspectionFeeIntent, 'Failed to pay the visiting fee. Please try again.');

  /** Buy it for me: the shopping money, held right after the delivery fee. */
  const payGoodsHold = (jobId: string) =>
    payHold(jobId, 'GOODS_ADVANCE', SkoFyApi.payments.createGoodsHoldIntent, 'Failed to hold the shopping money. Please try again.');

  // One flow for every amount held at hire: create the intent, present the
  // sheet, then wait for HELD.
  const payHold = async (
    jobId: string,
    purpose: 'INSPECTION_FEE' | 'GOODS_ADVANCE',
    createIntent: (jobId: string) => Promise<{ requires_payment: boolean; client_secret: string | null; amount: number }>,
    failMessage: string,
  ): Promise<FeePaymentResult> => {
    try {
      const intentResult = await createIntent(jobId);
      if (!intentResult.requires_payment) {
        // Free Inspection ($0) — already marked HELD server-side, nothing
        // for the customer to actually pay.
        return { status: 'success', charged: false, amount: 0 };
      }
      const sheetResult = await runPaymentSheet(intentResult.client_secret!, false, holdLabel(intentResult));
      if (sheetResult.status !== 'success') return sheetResult;

      for (let attempt = 0; attempt < 5; attempt++) {
        const paymentStatus = await SkoFyApi.payments.getStatus(jobId, purpose).catch(() => null);
        if (paymentStatus?.status === 'HELD') {
          return { status: 'success', charged: true, amount: intentResult.amount };
        }
        if (paymentStatus?.status === 'FAILED') {
          return { status: 'error', message: 'Your card was declined. Please try a different payment method.' };
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      return { status: 'pending', message: 'Your payment is still processing — this usually clears within a minute. Check back shortly before trying again.' };
    } catch (err: any) {
      return { status: 'error', message: err?.message ?? failMessage };
    }
  };

  /** Call once the invoice (or a countered amount) has been accepted —
   * creates the job-cost escrow, presents PaymentSheet, then confirms so the
   * job actually starts. */
  const payInvoice = async (jobId: string, offerCode?: string): Promise<PaymentResult> => {
    try {
      const intentResult = await SkoFyApi.jobs.payInvoice(jobId, offerCode);
      if (intentResult.requires_payment) {
        const sheetResult = await runPaymentSheet(intentResult.client_secret!, !!intentResult.bank_payment);
        if (sheetResult.status !== 'success') return sheetResult;
      }

      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await SkoFyApi.jobs.confirmJobCostPayment(jobId);
          return { status: 'success' };
        } catch (err: any) {
          if (err?.error_code !== 'PAYMENT_NOT_HELD') throw err;
          // A bank payment takes days, not seconds — say so instead of waiting.
          const status = await SkoFyApi.payments.getStatus(jobId, 'JOB_COST').catch(() => null);
          if (status?.processing) {
            return { status: 'pending', message: BANK_PAYMENT_PENDING };
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      return { status: 'pending', message: 'Your payment is still processing — this usually clears within a minute. Check back shortly before trying again.' };
    } catch (err: any) {
      return { status: 'error', message: err?.message ?? 'Failed to process payment. Please try again.' };
    }
  };

  /** A payment made on a job that's already running or done — work added
   * mid-job, or a tip: open it, present the sheet, then confirm it's held. */
  const payAndConfirm = async (
    open: () => Promise<{ requires_payment: boolean; client_secret: string | null; hold?: boolean; amount?: number }>,
    confirm: () => Promise<unknown>,
    failMessage: string,
  ): Promise<PaymentResult> => {
    try {
      const intent = await open();
      if (intent.requires_payment) {
        const sheetResult = await runPaymentSheet(intent.client_secret!, false, holdLabel(intent));
        if (sheetResult.status !== 'success') return sheetResult;
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await confirm();
          return { status: 'success' };
        } catch (err: any) {
          if (err?.error_code !== 'PAYMENT_NOT_HELD') throw err;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      return { status: 'pending', message: 'Your payment is still processing — this usually clears within a minute.' };
    } catch (err: any) {
      return { status: 'error', message: err?.message ?? failMessage };
    }
  };

  const payExtraWork = (jobId: string) => payAndConfirm(
    () => SkoFyApi.jobs.payExtraWork(jobId), () => SkoFyApi.jobs.confirmExtraWork(jobId),
    'Failed to pay for the added work. Please try again.',
  );

  const payTip = (jobId: string, amount: number) => payAndConfirm(
    () => SkoFyApi.jobs.startTip(jobId, amount), () => SkoFyApi.jobs.confirmTip(jobId),
    'Failed to send the tip. Please try again.',
  );

  /** A job priced up front: pay the agreed price to book it — with an offer code, if one was applied. */
  const payBooking = (jobId: string, offerCode?: string | null) => payAndConfirm(
    () => SkoFyApi.jobs.payBooking(jobId, offerCode), () => SkoFyApi.jobs.confirmBooking(jobId),
    'Failed to book. Please try again.',
  );

  return { hireApplicant, payInspectionFee, payGoodsHold, payInvoice, payExtraWork, payTip, payBooking };
}
