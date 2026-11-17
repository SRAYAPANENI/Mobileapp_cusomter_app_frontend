import { notificationsBlocked } from '@/services/notification-permission';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

/** Whether to show "Turn on notifications": only while they're really off.
 * Checked again each time the app comes back to the front — turned on in
 * Settings, it goes away by itself. Closed with ✕, it stays closed until the
 * app is next opened. */
export function useNotificationNudge(): { show: boolean; dismiss: () => void } {
  const [blocked, setBlocked] = useState(false);
  const dismissed = useRef(false);
  const [, rerender] = useState(0);

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
    dismissed.current = true;
    rerender((n) => n + 1);
  }, []);

  return { show: blocked && !dismissed.current, dismiss };
}
