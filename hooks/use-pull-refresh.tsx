import React, { useCallback, useRef, useState } from 'react';
import { RefreshControl } from 'react-native';

/**
 * Pull down to reload a screen — the brand-yellow spinner every list uses.
 * `load` should reload quietly (no full-screen spinner): the content stays put
 * while the small one at the top turns. Pass the result as `refreshControl`.
 */
export function usePullRefresh(load: () => unknown) {
  const [refreshing, setRefreshing] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadRef.current();
    } catch {
      // The screen shows its own error; the spinner just stops.
    } finally {
      setRefreshing(false);
    }
  }, []);
  return <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFCE48" colors={['#FFCE48']} />;
}
