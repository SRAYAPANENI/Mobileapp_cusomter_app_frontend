import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

// Starts true (assume online) rather than null/false — NetInfo's first
// determination is async, and defaulting to "offline" would flash the
// full-page NoInternetState on every cold start before NetInfo has had a
// chance to answer. Same assumption network-status-banner.tsx already makes.
export function useIsOnline(): boolean {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOnline(state.isConnected !== false && state.isInternetReachable !== false);
    });
    return unsubscribe;
  }, []);

  return isOnline;
}
