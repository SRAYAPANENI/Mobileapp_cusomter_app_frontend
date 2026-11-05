import { useSyncExternalStore } from 'react';

// Whether the Dodorez server answers. The phone's own connection is
// React Query's onlineManager (services/query-client.ts); this is the other
// half — online, but the server down or unreachable. Without it a dead server
// looked like an empty account: signed in, every screen blank, nothing said.
//
// Every request reports here (services/api.ts timedFetch): an answer of any
// kind means reachable; no answer, a timeout, or a gateway error (502–504)
// means not. While unreachable it checks the server's /health every few
// seconds, so the banner (components/connection-banner.tsx) clears by itself.

type Listener = () => void;

let reachable = true;
const listeners = new Set<Listener>();
let healthCheck: (() => Promise<boolean>) | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const CHECK_EVERY_MS = 8_000;

function notify(): void {
  listeners.forEach((l) => l());
}

/** services/api.ts tells this how to ask the server whether it's up. */
export function setHealthCheck(fn: () => Promise<boolean>): void {
  healthCheck = fn;
}

/** A request got an answer (true) or none (false). */
export function reportReachable(ok: boolean): void {
  if (ok === reachable) return;
  reachable = ok;
  if (ok && timer) {
    clearInterval(timer);
    timer = null;
  }
  if (!ok && !timer) timer = setInterval(() => { checkNow(); }, CHECK_EVERY_MS);
  notify();
}

/** Asks the server now — the banner's Retry, and the timer above. */
export async function checkNow(): Promise<boolean> {
  if (!healthCheck) return reachable;
  const ok = await healthCheck().catch(() => false);
  reportReachable(ok);
  return ok;
}

export function isServerReachable(): boolean {
  return reachable;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Re-renders when the server becomes reachable or unreachable. */
export function useServerReachable(): boolean {
  return useSyncExternalStore(subscribe, isServerReachable, isServerReachable);
}
