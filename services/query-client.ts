import NetInfo from '@react-native-community/netinfo';
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { AppState } from 'react-native';

// The app's one data layer (docs/APP_DATA_ARCHITECTURE.md). Screens read
// through the hooks in services/queries/, never SkoFyApi directly, so the
// same data is fetched once, shared between screens, and kept fresh here.

// Back online after a dead zone: whatever is stale refreshes by itself.
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)));

// Back to the app from another one: the same, as a browser does on tab focus.
focusManager.setEventListener((setFocused) => {
  const sub = AppState.addEventListener('change', (status) => setFocused(status === 'active'));
  return () => sub.remove();
});

const RETRYABLE = new Set(['NETWORK_ERROR', 'TIMEOUT']);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Moving between screens within 30 s reuses what's on hand.
      staleTime: 30_000,
      // Kept 10 minutes after the last screen using it closes.
      gcTime: 10 * 60_000,
      // One quiet retry on a dropped connection; a refusal (4xx) is final.
      retry: (failures, err: any) => failures < 1 && RETRYABLE.has(err?.error_code),
    },
    mutations: { retry: 0 },
  },
});
