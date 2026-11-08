import { useQuery } from '@tanstack/react-query';
import { AppConfig, SkoFyApi } from '@/services/api';
import { qk } from './keys';

// Logo, maintenance mode, module toggles and Terms & Conditions — set from
// the admin portal, no app release needed. Works logged out (maintenance
// gating at launch) and logged in (terms.needs_review becomes meaningful).
// Polled, not just fetched once: an admin flipping maintenance on should
// reach an already-open app within a reasonable window, not just at next
// cold start. staleTime keeps a cached answer usable immediately on a slow
// or offline launch instead of blocking render on a fresh fetch.
export function useAppConfig() {
  return useQuery({
    queryKey: qk.appConfig,
    queryFn: (): Promise<AppConfig> => SkoFyApi.appConfig.get(),
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
    // A transient network blip must never brick the app into a maintenance
    // screen it's actually wrong about — keep the last known-good config.
    retry: 1,
  });
}
