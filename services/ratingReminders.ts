import { SkoFyApi } from './api';

export interface PendingRating {
  job_id: string;
  title: string;
  /** The provider the customer is rating. */
  counterpart_name: string;
  status: string;
}

// Ratings dismissed with "Maybe later" during this app session. Kept in
// memory on purpose: a skipped rating comes back the next time the app is
// opened (until it's submitted), but skipping it on one screen doesn't make
// the next screen ask again straight away.
const skippedThisSession = new Set<string>();

export function markRatingSkipped(jobId: string) {
  skippedThisSession.add(jobId);
}

export function isRatingSkipped(jobId: string): boolean {
  return skippedThisSession.has(jobId);
}

/** The newest finished job (completed or disputed) the customer still owes a
 *  rating for and hasn't skipped this session — or null. Never throws: a
 *  reminder failing to load must not break the screen showing it. */
export async function nextPendingRating(): Promise<PendingRating | null> {
  try {
    const pending = await SkoFyApi.jobs.pendingRatings();
    return pending.find(p => !isRatingSkipped(p.job_id)) ?? null;
  } catch {
    return null;
  }
}
