import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { useEffect, useRef, useSyncExternalStore } from 'react';

import { checkNow, useServerReachable } from '@/services/server-status';

// The app's one view of the internet connection. Every screen and the
// banner read it here — they used to each listen to NetInfo on their own,
// with two different ideas of "offline", so the top banner and a screen's
// full-page state could disagree, or both show at once.
//
// What's shown (one at a time, like Uber, WhatsApp or YouTube):
//  - offline: the top banner (components/network-status-banner.tsx), with
//    everything on screen still usable;
//  - a screen with nothing loaded at all: its full-page NoInternetState
//    (components/no-internet-state.tsx) — the banner hides while it shows;
//  - back online: "Back online" for BACK_ONLINE_MS, and screens reload.
// The same file is in both apps (they share no code): keep them identical.

export const BACK_ONLINE_MS = 2500;

export type Connection = {
  /** Connected, and the internet reachable (or not yet known: assumed yes,
   * so nothing flashes "offline" on every cold start). */
  online: boolean;
  /** It came back a moment ago — "Back online" is showing. */
  backOnline: boolean;
  /** A full-page NoInternetState is on screen: the banner stays hidden. */
  fullPage: boolean;
};

let state: Connection = { online: true, backOnline: false, fullPage: false };
let fullPages = 0;
let backOnlineTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
let unsubscribeNetInfo: (() => void) | null = null;

function set(patch: Partial<Connection>) {
  const next = { ...state, ...patch };
  if (next.online === state.online && next.backOnline === state.backOnline && next.fullPage === state.fullPage) return;
  state = next;
  listeners.forEach((l) => l());
}

/** Online: connected, and the internet not known to be unreachable. */
export function isOnlineState(s: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>): boolean {
  return s.isConnected !== false && s.isInternetReachable !== false;
}

function onNetInfo(s: NetInfoState) {
  const online = isOnlineState(s);
  if (online === state.online) return;
  if (backOnlineTimer) { clearTimeout(backOnlineTimer); backOnlineTimer = null; }
  if (!online) {
    set({ online: false, backOnline: false });
    return;
  }
  set({ online: true, backOnline: true });
  void checkNow();   // is the server there too? — answered now, not in 8s
  backOnlineTimer = setTimeout(() => { backOnlineTimer = null; set({ backOnline: false }); }, BACK_ONLINE_MS);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // One NetInfo listener for the whole app, started by the first reader.
  if (!unsubscribeNetInfo) unsubscribeNetInfo = NetInfo.addEventListener(onNetInfo);
  return () => { listeners.delete(listener); };
}

const snapshot = () => state;

/** Online right now, outside a component — e.g. not to alert a failed load
 * the banner already explains. */
export const isOnlineNow = (): boolean => state.online;

/** The connection, as every screen and the banner see it. */
export function useConnection(): Connection {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Ask again now (the Refresh button) rather than wait for NetInfo. */
export async function checkConnection(): Promise<boolean> {
  try {
    const s = await NetInfo.refresh();
    onNetInfo(s);
    return isOnlineState(s);
  } catch {
    return state.online;   // the check itself failed: what's known stands
  }
}

/** A full-page NoInternetState is showing — returns its "gone" call. */
export function showingFullPage(): () => void {
  fullPages += 1;
  set({ fullPage: true });
  let done = false;
  return () => {
    if (done) return;
    done = true;
    fullPages = Math.max(0, fullPages - 1);
    set({ fullPage: fullPages > 0 });
  };
}

/** Runs `reload` when the connection comes back — for a screen that loads
 * its own data (one on the shared query cache refreshes by itself). The
 * screen calls it, not its NoInternetState: the screen usually removes that
 * page the moment it's online, before the page could act. */
export function useReloadWhenBackOnline(reload: () => void): void {
  const { online } = useConnection();
  // Back also means the server answering again (services/server-status.ts):
  // online all along, but nothing loaded while it was down.
  const reachable = useServerReachable();   // always called — a hook
  const usable = online && reachable;
  const latest = useRef(reload);
  latest.current = reload;
  const wasUsable = useRef(usable);
  useEffect(() => {
    if (usable && !wasUsable.current) latest.current();
    wasUsable.current = usable;
  }, [usable]);
}
