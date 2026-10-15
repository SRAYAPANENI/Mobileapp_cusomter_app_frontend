import { router } from 'expo-router';

// Which job screen is in front right now (e.g. /track-provider for job X).
// Tapping a notification for that same job used to push a second copy of the
// screen on top of it — both copies then polled the job and, when it
// completed, each opened its own rating popup.
let inFront: { route: string; jobId: string } | null = null;

export function setJobScreenInFront(route: string, jobId: string | null | undefined) {
  inFront = jobId ? { route, jobId } : null;
}

export function clearJobScreenInFront(route: string, jobId: string | null | undefined) {
  if (inFront && inFront.route === route && inFront.jobId === jobId) inFront = null;
}

/** Opens a job's screen unless it's already the one in front. */
export function openJobScreen(route: string, jobId: string) {
  if (inFront && inFront.route === route && inFront.jobId === jobId) return;
  router.push({ pathname: route, params: { jobId } } as any);
}
