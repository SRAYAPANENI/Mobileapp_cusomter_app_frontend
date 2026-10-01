import { useEffect, useState } from 'react';

import { SkoFyApi, TokenStore } from '@/services/api';

export type ActiveJobBanner = {
  jobId: string;
  title: string;
  message: string;
};

const POLL_MS = 10000;
// Which job statuses this banner covers — the exact pre-work window where
// something can change without the customer being on track-provider to see
// it (pay the fee, code ready, invoice raised/negotiated). IN_PROGRESS and
// beyond aren't included: once real work has started there's no comparable
// "waiting on you" moment that needs a global nudge.
const TRACKED_STATUSES = ['ACCEPTED', 'INSPECTING', 'INVOICE_PENDING'];

async function describeJob(job: any): Promise<ActiveJobBanner | null> {
  let message = '';
  if (job.status === 'ACCEPTED') {
    const feeStatus = await SkoFyApi.payments.getStatus(job.id, 'INSPECTION_FEE').catch(() => null);
    if (feeStatus?.status !== 'HELD') {
      message = 'Pay the visiting fee to continue';
    } else {
      const otpResult = await SkoFyApi.jobs.getInspectionOtp(job.id).catch(() => null);
      message = otpResult?.otp
        ? 'Your inspection code is ready — tap to view'
        : 'Waiting for your provider to arrive';
    }
  } else if (job.status === 'INSPECTING') {
    message = 'Your provider is inspecting the job';
  } else if (job.status === 'INVOICE_PENDING') {
    const inv = job.invoice;
    if (!inv) message = 'Invoice pending';
    else if (inv.status === 'PENDING') message = `Invoice ready — $${Number(inv.amount).toFixed(2)}, tap to review`;
    else if (inv.status === 'COUNTERED') message = 'Waiting for your provider to respond to your offer';
    else if (inv.status === 'COUNTER_REJECTED') message = 'Provider declined your offer — action needed';
    else if (inv.status === 'ACCEPTED') message = 'Invoice accepted — pay now to start the job';
  }
  return message ? { jobId: job.id, title: job.title || 'Your job', message } : null;
}

/** Polls for ALL of the customer's currently active jobs (not just the
 * first one — a customer can easily have more than one provider hired at
 * once, each with its own independent OTP/invoice state) and derives a
 * short, tappable status line for each. The same information
 * track-provider.tsx shows in full, condensed to one line per job so it can
 * surface from anywhere in the app, not just while that specific job's
 * screen happens to be open. */
export function useActiveJobStatus(): ActiveJobBanner[] {
  const [banners, setBanners] = useState<ActiveJobBanner[]>([]);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      const token = await TokenStore.getAccessToken();
      if (!token) {
        if (!cancelled) setBanners([]);
        return;
      }

      try {
        const jobs = await SkoFyApi.jobs.list();
        const active = (jobs || []).filter((j: any) => TRACKED_STATUSES.includes(j.status));
        if (!active.length) {
          if (!cancelled) setBanners([]);
          return;
        }

        const described = await Promise.all(active.map(describeJob));
        const next = described.filter((b): b is ActiveJobBanner => b !== null);
        if (!cancelled) setBanners(next);
      } catch {
        // Transient poll miss — keep showing the last known banners rather
        // than flashing them away for a single dropped request.
      }
    };

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return banners;
}
