import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

// The chats and job screens open in the stack right now, oldest first.
// Tapping a notification for one that's already open goes back to it instead
// of stacking another copy on top. Copies used to pile up, one per tap, and
// Back then led to the same chat again and again.

type Params = Record<string, string>;

interface OpenScreen {
  route: string;
  key: string;
  /** The params it was opened with, so going back to it changes nothing. */
  params: Params;
  focused: boolean;
}

const openScreens: OpenScreen[] = [];

function stringParams(params: Record<string, unknown>): Params {
  const out: Params = {};
  for (const [k, v] of Object.entries(params)) if (typeof v === 'string') out[k] = v;
  return out;
}

/** Registers this screen as open for `key` (a job or ticket id) while it's mounted. */
export function useOpenScreen(route: string, key: string | null | undefined, params: Record<string, unknown>) {
  const entryRef = useRef<OpenScreen | null>(null);
  const focusedRef = useRef(false);
  // The params it was first opened with, not later ones.
  const firstParamsRef = useRef(stringParams(params));

  useEffect(() => {
    if (!key) return;
    const entry: OpenScreen = { route, key, params: firstParamsRef.current, focused: focusedRef.current };
    entryRef.current = entry;
    openScreens.push(entry);
    return () => {
      const i = openScreens.indexOf(entry);
      if (i >= 0) openScreens.splice(i, 1);
      if (entryRef.current === entry) entryRef.current = null;
    };
  }, [route, key]);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    if (entryRef.current) entryRef.current.focused = true;
    return () => {
      focusedRef.current = false;
      if (entryRef.current) entryRef.current.focused = false;
    };
  }, []));
}

/** This job's or ticket's screen is the one in front right now. */
export function isScreenInFront(route: string, key: string | null | undefined): boolean {
  return !!key && openScreens.some(s => s.route === route && s.key === key && s.focused);
}

/** Opens a job's or ticket's screen: nothing if it's already in front, back to
 * it if it's open further down, a new screen only if it isn't open at all. */
export function openScreen(route: string, key: string, params: Record<string, unknown>) {
  // Going back reaches the newest screen of this route, so only that one can be reused.
  const newest = [...openScreens].reverse().find(s => s.route === route);
  if (newest && newest.key === key) {
    if (!newest.focused) router.dismissTo({ pathname: route, params: newest.params } as any);
    return;
  }
  router.push({ pathname: route, params: stringParams(params) } as any);
}
