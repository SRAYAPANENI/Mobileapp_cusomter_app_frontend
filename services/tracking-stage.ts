// Where a hired job is, for the customer's tracking screen (app/track-provider.tsx):
// one headline, one short line under it, and the steps of the job with the
// current one marked. Everything the screen shows is arranged around this —
// what's happening now first, the one thing the customer has to do next,
// and the fine print only when asked for.
//
// Pure: the screen's state in, the stage out — no fetching, no React.

export type StageKey =
  | 'book'          // priced up front, not booked and paid yet
  | 'pay_fee'       // quoted: the visiting / delivery fee isn't held yet
  | 'hold_goods'    // buy it for me: the shopping money isn't held yet
  | 'on_the_way'    // heading to the customer (or the pickup)
  | 'booked'        // booked, nobody travels (at the provider's place, online)
  | 'code'          // a code to read out now
  | 'inspecting'
  | 'report'        // the inspection report, to look over
  | 'price'         // the provider's price, to answer
  | 'working'
  | 'delivered'     // handed over: to mark complete
  | 'done'
  | 'closed';       // cancelled or disputed

export interface TrackingInput {
  jobStatus: string;
  isCompleted: boolean;
  delivery: boolean;           // Pickup & Delivery
  travels: boolean;            // the provider comes to the customer
  setOff: boolean;             // they've set off — on the map from then
  paysUpfront: boolean;
  upfrontPaid: boolean;
  feeHeld: boolean;            // a quoted job's visiting / delivery fee
  needsGoodsHold: boolean;     // buy it for me, money not held yet
  pickupFromStore: boolean;
  collected: boolean;          // the order is with the provider
  delivered: boolean;
  hasCode: boolean;            // a code is waiting to be read out
  inspectionDone: boolean;
  inspectionConfirmed: boolean;
  invoiceStatus: string | null;
  recipientName: string | null;
  hostedAtTheirPlace: boolean; // the customer brings it to the provider
  online: boolean;             // done online: nobody travels, nothing visited (a meeting instead)
}

export interface TrackingStage {
  key: StageKey;
  title: string;
  /** One short line; the ETA takes its place while the provider is moving. */
  subtitle: string;
  /** The provider is travelling and the ETA means something. */
  moving: boolean;
  /** The customer has something to do now — the sheet opens to show it. */
  needsAction: boolean;
  steps: string[];
  /** Index into steps; steps.length when all are done. */
  step: number;
}

export function trackingStage(i: TrackingInput): TrackingStage {
  if (i.isCompleted || i.jobStatus === 'COMPLETED') {
    const steps = stepsFor(i);
    return { key: 'done', title: 'Completed', subtitle: 'Thanks for using Dodorez.', moving: false, needsAction: false, steps, step: steps.length };
  }
  if (i.jobStatus === 'CANCELLED' || i.jobStatus === 'DISPUTED') {
    return {
      key: 'closed',
      title: i.jobStatus === 'DISPUTED' ? 'Under review' : 'Cancelled',
      subtitle: i.jobStatus === 'DISPUTED' ? 'Our team will get back to you within 24 hours.' : 'This job is no longer active.',
      moving: false, needsAction: false, steps: stepsFor(i), step: 0,
    };
  }
  if (i.online) return i.paysUpfront ? onlineBookedStage(i) : onlineQuotedStage(i);
  return i.delivery ? deliveryStage(i) : i.paysUpfront ? bookedStage(i) : quotedStage(i);
}

function stepsFor(i: TrackingInput): string[] {
  // Online: no trip, no visit, no inspection — the price (or the booking), then the work.
  if (i.online) return i.paysUpfront ? ['Booked', 'Session', 'Done'] : ['Booked', 'Price', 'Work', 'Done'];
  if (i.delivery) return ['Booked', 'Pickup', 'On the way', 'Delivered'];
  if (i.paysUpfront) return i.travels ? ['Booked', 'On the way', 'In progress', 'Done'] : ['Booked', 'Check-in', 'In progress', 'Done'];
  return ['Booked', 'On the way', 'Inspection', 'Price', 'Work'];
}

const stage = (i: TrackingInput, key: StageKey, step: number, title: string, subtitle: string,
  extra: Partial<Pick<TrackingStage, 'moving' | 'needsAction'>> = {}): TrackingStage => ({
  key, title, subtitle, step, steps: stepsFor(i), moving: !!extra.moving, needsAction: !!extra.needsAction,
});

// Hired and paid, not on the way yet.
const notSetOff = (i: TrackingInput): TrackingStage =>
  stage(i, 'booked', 0, 'Booked', 'You’ll see your provider on the map once they set off.');

// Pickup & Delivery: booked → collected → on its way → delivered.
function deliveryStage(i: TrackingInput): TrackingStage {
  const place = i.pickupFromStore ? 'store' : 'pickup';
  if (i.jobStatus === 'ACCEPTED') {
    if (i.paysUpfront && !i.upfrontPaid) {
      return stage(i, 'book', 0, 'Book your trip', 'Pay to confirm — your provider sets off once it’s booked.', { needsAction: true });
    }
    if (!i.paysUpfront && !i.feeHeld) {
      return stage(i, 'pay_fee', 0, 'Pay the delivery fee', `Your provider heads to the ${place} once it’s paid.`, { needsAction: true });
    }
    if (i.needsGoodsHold) {
      return stage(i, 'hold_goods', 0, 'Hold the shopping money', 'So your provider can buy your items.', { needsAction: true });
    }
    if (i.collected) {
      // A quoted pickup, collected: its delivery price comes next (INVOICE_PENDING).
      return stage(i, 'price', 2, 'Picked up', 'Your provider has your order and will send their delivery price.');
    }
    if (!i.setOff) return notSetOff(i);
    return stage(i, 'on_the_way', 1, `Heading to the ${place}`,
      i.pickupFromStore ? 'They’ll pick up your order and bring it to you.' : 'They’ll check the item before taking it.',
      { moving: true });
  }
  if (i.jobStatus === 'INVOICE_PENDING') return priceStage(i, 2);
  if (i.jobStatus === 'IN_PROGRESS') {
    if (i.delivered) {
      return stage(i, 'delivered', 3, 'Delivered', 'All good? Mark it complete.', { needsAction: true });
    }
    const to = i.recipientName ?? 'you';
    if (i.hasCode) {
      return stage(i, 'code', 2, 'At the drop-off',
        i.recipientName ? `Send ${i.recipientName} the code below — they give it to your provider.` : 'Give your provider the code below.',
        { needsAction: true });
    }
    return stage(i, 'on_the_way', 2, `On the way to ${to}`, 'Your order has been picked up.', { moving: true });
  }
  return stage(i, 'on_the_way', 1, 'On the way', '', { moving: i.travels });
}

// Priced up front (care, hours, a set price): booked → check-in → under way.
function bookedStage(i: TrackingInput): TrackingStage {
  if (i.jobStatus === 'ACCEPTED') {
    if (!i.upfrontPaid) {
      return stage(i, 'book', 0, 'Book it', 'Pay to confirm your booking.', { needsAction: true });
    }
    if (i.hasCode) {
      return stage(i, 'code', 1, i.hostedAtTheirPlace ? 'Check in' : 'Your provider is here',
        'Give your provider the code below.', { needsAction: true });
    }
    if (!i.travels) {
      return stage(i, 'booked', 1, 'Booked', i.hostedAtTheirPlace ? 'Bring it at the time below.' : 'You’re all set.');
    }
    if (!i.setOff) return notSetOff(i);
    return stage(i, 'on_the_way', 1, 'On the way', 'Your provider is heading to you.', { moving: true });
  }
  if (i.jobStatus === 'IN_PROGRESS') {
    if (i.delivered) return stage(i, 'delivered', 3, 'Handed back', 'All good? Mark it complete.', { needsAction: true });
    if (i.hasCode) return stage(i, 'code', 2, 'Hand-back', 'Give your provider the code below when you get it back.', { needsAction: true });
    return stage(i, 'working', 2, 'In progress', 'Mark it complete when it’s done.');
  }
  return stage(i, 'booked', 1, 'Booked', '');
}

// Quoted: the visiting fee, the visit, the inspection, the price, the work.
function quotedStage(i: TrackingInput): TrackingStage {
  switch (i.jobStatus) {
    case 'ACCEPTED':
      if (!i.feeHeld) {
        return stage(i, 'pay_fee', 0, 'Pay the visiting fee', 'Your provider can start once it’s paid.', { needsAction: true });
      }
      if (i.hasCode) {
        return stage(i, 'code', 1, 'Your provider is here', 'Give them the code below to start the inspection.', { needsAction: true });
      }
      if (i.travels && !i.setOff) return notSetOff(i);
      return stage(i, 'on_the_way', 1, 'On the way', 'Your provider is heading to you.', { moving: i.travels });
    case 'INSPECTING':
      if (i.inspectionDone && !i.inspectionConfirmed) {
        return stage(i, 'report', 2, 'Check the inspection', 'Look over what your provider found.', { needsAction: true });
      }
      return stage(i, 'inspecting', 2, 'Inspecting the job', 'You’ll see their report here.');
    case 'INVOICE_PENDING':
      return priceStage(i, 3);
    case 'IN_PROGRESS':
      return stage(i, 'working', 4, 'Work in progress', 'Mark it complete when the job’s done.');
    default:
      return stage(i, 'on_the_way', 1, 'On the way', '', { moving: i.travels });
  }
}

// Online, priced by quote: no visiting fee — the provider sends a price, the
// customer pays it into escrow, then the work.
function onlineQuotedStage(i: TrackingInput): TrackingStage {
  switch (i.jobStatus) {
    case 'INVOICE_PENDING':
      return priceStage(i, 1);
    case 'IN_PROGRESS':
      return stage(i, 'working', 2, 'Work in progress', 'Mark it complete when it’s done.');
    default:
      return stage(i, 'booked', 1, 'Waiting for the price',
        'Your provider will send their price here. You pay it before any work starts.');
  }
}

// Online, paid up front (an hour, a fixed price): booked → the session → done.
function onlineBookedStage(i: TrackingInput): TrackingStage {
  if (i.jobStatus === 'ACCEPTED' && !i.upfrontPaid) {
    return stage(i, 'book', 0, 'Book it', 'Pay to confirm your session.', { needsAction: true });
  }
  if (i.jobStatus === 'IN_PROGRESS') {
    return stage(i, 'working', 1, 'In session', 'Mark it complete when it’s done.');
  }
  return stage(i, 'booked', 1, 'Booked', 'Join the session from here when it starts.');
}

// The provider's price, waiting on the customer (or on the provider, after a counter-offer).
function priceStage(i: TrackingInput, step: number): TrackingStage {
  const s = i.invoiceStatus;
  const what = i.delivery ? 'delivery price' : 'price';
  if (s === 'COUNTERED') return stage(i, 'price', step, 'Waiting for your provider', 'They’re looking at your offer.');
  if (s === 'ACCEPTED') return stage(i, 'price', step, i.delivery ? 'Pay to get it delivered' : 'Pay to start', 'The price is agreed.', { needsAction: true });
  if (s === 'COUNTER_REJECTED') {
    return stage(i, 'price', step, 'Your provider kept their price', i.delivery ? 'Pay it to get your order.' : 'Pay it to go ahead, or cancel.', { needsAction: true });
  }
  return stage(i, 'price', step, `Review the ${what}`, `Your provider has sent their ${what}.`, { needsAction: !!s });
}
