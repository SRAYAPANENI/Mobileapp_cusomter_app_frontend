import { useCallback, useEffect, useRef, useState } from 'react';

import { SkoFyApi } from '@/services/api';

// The "Push Notifications" switch in Settings. It's saved on the server —
// the server is what decides whether to push — so it used to look off while
// pushes kept arriving. Off stops notification pushes to this app only;
// the notification list still fills and calls still ring.

/** The saved switch, and a setter that saves it — shown at once, put back
 * (and reported via onError) if saving fails. */
export function usePushPreference(onError: (message: string) => void) {
  const [enabled, setEnabled] = useState(true);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    SkoFyApi.notifications.getPushPreference()
      .then(on => { if (!cancelled) setEnabled(on); })
      .catch(() => {}); // stays on (the server's default) until it can be read
    return () => { cancelled = true; };
  }, []);

  const change = useCallback((next: boolean) => {
    setEnabled(next);
    SkoFyApi.notifications.setPushPreference(next).catch((e: any) => {
      setEnabled(!next);
      onErrorRef.current(e?.message || 'Could not save your notification setting. Please try again.');
    });
  }, []);

  return [enabled, change] as const;
}
