import { SkoFyApi } from './api';

export interface PendingRating {
  job_id: string;
  title: string;
  /** The provider the customer is rating. */
  counterpart_name: string;
  status: string;
}

// Ratings answered during this app session — skipped with "Maybe later" or
// submitted. Kept in memory on purpose: a skipped rating comes back the next
// time the app is opened (until it's submitted), but answering it on one
// screen must stop every other screen asking again — several screens (the
// tracking screen, the job chat, the home reminder) can each ask.
const handledThisSession = new Set<string>();

export function markRatingSkipped(jobId: string) {
  handledThisSession.add(jobId);
}

export function markRatingSubmitted(jobId: string) {
  handledThisSession.add(jobId);
}

export function isRatingSkipped(jobId: string): boolean {
  return handledThisSession.has(jobId);
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
