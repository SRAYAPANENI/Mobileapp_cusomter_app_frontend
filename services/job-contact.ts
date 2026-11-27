// When the customer and provider can reach each other about a job: chat and
// calls are open only while the job is being done — and again on a completed
// job while the provider is arranging a guarantee fix. The server decides
// (skofy-backend app/services/contact_gate.py) and says so on the job's own
// detail as `contact_open`; this is so the app never offers a button that
// only leads to "this job is closed".

const CONTACT_OPEN_STATUSES = new Set(['ACCEPTED', 'INSPECTING', 'INVOICE_PENDING', 'IN_PROGRESS']);

export function jobContactOpen(jobStatus: string | null | undefined): boolean {
  return !!jobStatus && CONTACT_OPEN_STATUSES.has(jobStatus);
}

/** What the server said (the job's detail), with the status it said it for. */
export interface ServerContact {
  status: string;
  open: boolean;
}

/** Read off a job's detail — null from an older server without the field. */
export function serverContactOf(job: { status?: string; contact_open?: boolean | null } | null | undefined): ServerContact | null {
  return job?.status && typeof job.contact_open === 'boolean' ? { status: job.status, open: job.contact_open } : null;
}

/** Open now: the server's answer while the job is still where it was when the
 *  server gave it (it covers the guarantee fix); once the status has moved on,
 *  the status rule until the detail is read again. */
export function contactOpenNow(jobStatus: string | null | undefined, server: ServerContact | null): boolean {
  if (server && server.status === jobStatus) return server.open;
  return jobContactOpen(jobStatus);
}
