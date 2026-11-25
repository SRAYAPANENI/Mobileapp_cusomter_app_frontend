import { useCallback, useEffect, useState } from 'react';
import { SkoFyApi } from '@/services/api';
import type { JobSkill } from '@/services/job-shape';

export type JobSkillsState = 'loading' | 'ready' | 'failed';

/** The profession's skills, with how each is priced and where it's done. The
 * form needs them before it can ask anything: without them it would offer
 * choices the server refuses. */
export function useJobSkills(profession: string, enabled: boolean) {
  const [state, setState] = useState<JobSkillsState>('loading');
  const [skills, setSkills] = useState<JobSkill[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !profession) { setState('ready'); setSkills([]); return; }
    let live = true;
    setState('loading');
    SkoFyApi.skills.list(profession)
      .then((list: any) => {
        if (!live) return;
        setSkills((Array.isArray(list) ? list : []).map((s: any) => ({
          id: s.id, name: s.name, pricing: s.pricing ?? null, venues: s.venues ?? null,
        })));
        setState('ready');
      })
      .catch(() => { if (live) setState('failed'); });
    return () => { live = false; };
  }, [profession, enabled, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, skills, retry };
}
