import { notificationsBlocked } from '@/services/notification-permission';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

// Closed with ✕: for the rest of this launch — not just this mount of the
// screen (the home screen mounts again after signing out and in).
let closedThisLaunch = false;

/** Whether to show "Turn on notifications": only while they're really off.
 * Checked again each time the app comes back to the front — turned on in
 * Settings, it goes away by itself; back from Settings still off, it stays.
 * Closed with ✕, it stays closed until the app is next opened. */
export function useNotificationNudge(): { show: boolean; dismiss: () => void } {
  const [blocked, setBlocked] = useState(false);
  const [closed, setClosed] = useState(closedThisLaunch);

  useEffect(() => {
    let alive = true;
    const check = () => {
      notificationsBlocked()
        .then((off) => { if (alive) setBlocked(off); })
        .catch(() => {});
    };
    check();
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') check(); });
    return () => { alive = false; sub.remove(); };
  }, []);

  const dismiss = useCallback(() => {
    closedThisLaunch = true;
    setClosed(true);
  }, []);

  return { show: blocked && !closed, dismiss };
}
