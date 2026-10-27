import { useEffect, useState } from 'react';

/** The two clocks on a texted code: when "Resend" works again, and when the
 * code itself expires (the server says when). Kept as end times, not
 * counters, so they're still right after the app was in the background. */
export function useCodeTimer(resendAfterSeconds = 30) {
  const [resendAt, setResendAt] = useState(0);
  const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const running = now < Math.max(resendAt, expiresAt);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const left = (at: number) => Math.max(0, Math.ceil((at - now) / 1000));
  return {
    resendIn: left(resendAt),
    expiresIn: left(expiresAt),
    expired: expiresAt > 0 && now >= expiresAt,
    /** A code was just sent, valid for this many seconds. */
    start: (expiresInSeconds: number) => {
      const t = Date.now();
      setNow(t);
      setResendAt(t + resendAfterSeconds * 1000);
      setExpiresAt(t + expiresInSeconds * 1000);
    },
    /** Back to no code (the number is being changed). */
    reset: () => {
      setResendAt(0);
      setExpiresAt(0);
    },
  };
}

export type CodeTimer = ReturnType<typeof useCodeTimer>;
