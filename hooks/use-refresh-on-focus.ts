import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';

type Refreshable = { refetch: () => unknown; isStale: boolean };

/** The same, but refreshing every time — for data another screen still
 * changes outside the data layer (until that screen moves onto it). */
export function useRefetchOnFocus(...queries: Refreshable[]) {
  const first = useRef(true);
  const latest = useRef(queries);
  latest.current = queries;
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    latest.current.forEach((q) => { q.refetch(); });
  }, []));
}

/**
 * Coming back to a screen refreshes what's out of date (older than the query
 * client's 30 s), not everything every time — and not on the first visit,
 * which loads anyway (docs/APP_DATA_ARCHITECTURE.md §4).
 */
export function useRefreshOnFocus(...queries: Refreshable[]) {
  const first = useRef(true);
  const latest = useRef(queries);
  latest.current = queries;
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    latest.current.forEach((q) => { if (q.isStale) q.refetch(); });
  }, []));
}
