import { useCallback, useEffect, useRef, useState } from 'react';
import type { NativeScrollEvent } from 'react-native';

// "typing…" in a chat, both ways. While keys are pressed "typing" is repeated
// every few seconds; the other side drops it by itself when the repeats stop,
// so a lost "stopped" (no signal, app closed) can't leave it on screen. The
// same timings are in both apps and the portal (src/lib/typingSender.ts).
const REPEAT_MS = 3000;
const IDLE_MS = 4000;
const SHOWN_MS = 6000;

/** Tells the other side while this person types. `onText` on every change of
 * the box; `sent` as a message goes (it takes the dots' place when it
 * arrives, so nothing is said); `stop` if it didn't go after all. */
export function useTypingSender(send: (typing: boolean) => void) {
  const sendRef = useRef(send);
  sendRef.current = send;
  const typing = useRef(false);
  // Their message is on its way: the dots still show over there.
  const sending = useRef(false);
  const lastSent = useRef(0);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (idle.current) { clearTimeout(idle.current); idle.current = null; }
    if (!typing.current && !sending.current) return;
    typing.current = false;
    sending.current = false;
    sendRef.current(false);
  }, []);

  const sent = useCallback(() => {
    if (idle.current) { clearTimeout(idle.current); idle.current = null; }
    sending.current = typing.current;
    typing.current = false;
  }, []);

  const onText = useCallback((text: string) => {
    if (text.trim() === '') { stop(); return; }
    const now = Date.now();
    if (!typing.current || now - lastSent.current >= REPEAT_MS) {
      typing.current = true;
      sending.current = false;
      lastSent.current = now;
      sendRef.current(true);
    }
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(stop, IDLE_MS);
  }, [stop]);

  useEffect(() => stop, [stop]);
  return { onText, sent, stop };
}

/** Whether the other side is typing now: `set` with each signal, and with
 * false when their message arrives or the line drops. */
export function useTypingShown() {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = useCallback((typing: boolean) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setShown(typing);
    if (typing) timer.current = setTimeout(() => setShown(false), SHOWN_MS);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { shown, set };
}

const NEAR_BOTTOM = 120;

/** The typing bubble grows the list: someone reading older messages must not
 * be pulled to the bottom by it. `follows()` says whether a change of the
 * list's size should scroll to the end. */
export function useTypingScroll(shown: boolean, messageCount: number) {
  const nearBottom = useRef(true);
  const last = useRef({ shown, messageCount });

  const onScroll = (e: NativeScrollEvent) => {
    nearBottom.current = e.contentSize.height - e.contentOffset.y - e.layoutMeasurement.height < NEAR_BOTTOM;
  };
  const follows = () => {
    const onlyTyping = last.current.shown !== shown && last.current.messageCount === messageCount;
    last.current = { shown, messageCount };
    return !onlyTyping || nearBottom.current;
  };
  return { onScroll, follows };
}
