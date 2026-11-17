import { CareRecord, SkoFyApi } from '@/services/api';
import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_MS = 5000;
// The whole job at least this often, whatever its stamp says.
const FULL_EVERY_MS = 30_000;

export interface CareJob {
  /** The job as the server has it (null until loaded). */
  job: any | null;
  /** A code to read out now — check-in, arrival, or hand-back. */
  code: string | null;
  /** Hand-over photos and updates, for something left in the provider's care. */
  record: CareRecord | null;
  reload: () => void;
}

// A job priced up front, followed for the tracking screen: the booking, the
// code to read out, the photos and updates. One poll for the screen's
// booking card and its trip details alike.
//
// Each tick asks the job's stamp (one small query) and reloads the whole job
// only when it changed — except while a waiting clock runs: its minutes and
// money are counted as the job is read, with nothing stored changing, so then
// it's read every time. Codes live outside the job (they're issued on the
// spot), so they're asked for on every tick the job calls for one.
export function useCareJob(jobId: string | undefined, enabled: boolean): CareJob {
  const [job, setJob] = useState<any>(null);
  const [code, setCode] = useState<string | null>(null);
  const [record, setRecord] = useState<CareRecord | null>(null);
  const last = useRef<{ stamp: string; at: number; job: any | null }>({ stamp: '', at: 0, job: null });

  const load = useCallback(async (force = false) => {
    if (!jobId) return;
    const prev = last.current;
    const counting = !!prev.job?.trip_wait?.can_stop;
    let j = prev.job;
    const stamp = await SkoFyApi.jobs.stamp(jobId).then((r) => r?.stamp ?? null).catch(() => null);
    if (force || counting || stamp === null || stamp !== prev.stamp || Date.now() - prev.at >= FULL_EVERY_MS) {
      const fresh: any = await SkoFyApi.jobs.get(jobId).catch(() => null);
      if (fresh) {
        j = fresh;
        last.current = { stamp: stamp ?? '', at: Date.now(), job: fresh };
        setJob(fresh);
      }
    }
    if (!j) return;
    const steps: string[] = j.steps ?? [];
    if (j.status === 'ACCEPTED' && j.payment_status === 'HELD' && (steps.includes('CHECK_IN_CODE') || steps.includes('ARRIVAL_CODE'))) {
      setCode((await SkoFyApi.jobs.checkInCode(jobId).catch(() => null))?.code ?? null);
    } else if (j.status === 'IN_PROGRESS' && steps.includes('HANDBACK_CODE') && !j.delivered_at
      // A delivery's drop-off code is the tracking screen's (it can be sent
      // on to whoever receives it); shown here too, it showed twice.
      && !steps.includes('PICKUP_PROOF')) {
      setCode((await SkoFyApi.jobs.getDeliveryCode(jobId).catch(() => null))?.code ?? null);
    } else {
      setCode(null);
    }
    if (steps.includes('HANDOVER_PHOTOS') && j.handover_at) {
      setRecord(await SkoFyApi.jobs.careRecord(jobId).catch(() => null));
    }
  }, [jobId]);

  useEffect(() => {
    if (!enabled || !jobId) return;
    void load(true);
    const id = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(id);
  }, [enabled, jobId, load]);

  const reload = useCallback(() => { void load(true); }, [load]);
  return { job, code, record, reload };
}
