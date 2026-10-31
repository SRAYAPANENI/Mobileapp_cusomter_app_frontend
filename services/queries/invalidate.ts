import { queryClient } from '@/services/query-client';
import { qk } from './keys';

// A write changes some cached reads: after any successful write through the
// API, those are refreshed — for every screen, on the data layer or not, so
// one screen's change shows on the others (docs/APP_DATA_ARCHITECTURE.md).
const AFFECTS: { prefix: string; keys: readonly (readonly string[])[] }[] = [
  { prefix: '/customers', keys: [qk.customer.all] },
  { prefix: '/jobs', keys: [qk.jobs.all] },
  { prefix: '/payments', keys: [qk.jobs.all] },
];

export function afterWrite(endpoint: string, method: string | undefined) {
  if (!method || method.toUpperCase() === 'GET') return;
  const path = endpoint.split('?')[0];
  for (const { prefix, keys } of AFFECTS) {
    if (path.startsWith(prefix)) keys.forEach((queryKey) => { queryClient.invalidateQueries({ queryKey }); });
  }
}
