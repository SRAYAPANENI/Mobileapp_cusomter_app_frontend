import { Audio } from 'expo-av';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { CallState } from '@/components/call-overlay';
import { SkoFyApi, type SupportCallStatus, type SupportCallView } from '@/services/api';
import { dismissSupportCallNotification } from '@/services/callManager';

import { CallMedia, CallMediaEnded } from './callMedia';
import { callSounds } from './callSounds';
import type { TransportEvent } from './mediaTransport';
import { openSupportCallLine } from './supportCallLine';

// A voice call with the agent handling this support ticket. This only
// coordinates: the line (supportCallLine) brings call updates, callSounds
// rings, CallMedia carries the audio — and the server's lifecycle
// (app/domain/support_calls.py) decides every state; this follows it:
//
//   RINGING ─answer─▶ ACTIVE ─hang up─▶ ENDED
//   RINGING ─▶ DECLINED · CANCELLED · MISSED
//
// On the call screen that's: calling / ringing → connecting → connected → ended.

const LIVE = new Set<SupportCallView['status']>(['RINGING', 'ACTIVE']);
const ENDED_LABEL: Partial<Record<SupportCallView['status'], string>> = {
  MISSED: 'No answer',
  DECLINED: 'Call declined',
  ENDED: 'Call ended',
};
const ENDED_SCREEN_MS = 1500;
const STATUS_POLL_MS = 10000;
// The other side gone from the call's room this long (their app crashed, no
// network, never joined), or our own connection not back: the call ends.
const GONE_MS = 30000;

export function useSupportCall(ticketId: string | undefined) {
  const [status, setStatus] = useState<SupportCallStatus | null>(null);
  const [call, setCall] = useState<SupportCallView | null>(null);
  const [callState, setCallState] = useState<CallState>('idle');
  const [endedLabel, setEndedLabel] = useState<string | undefined>();
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRef = useRef(new CallMedia(undefined, (id) => SkoFyApi.supportCalls.media(id)));
  const callRef = useRef<SupportCallView | null>(null);
  const endedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const goneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerPresentRef = useRef(false);
  // Calls already over here: late news about them (a check sent before the
  // hang-up, answering after) never brings them back.
  const overRef = useRef(new Set<string>());
  // When our view of the call last changed: a check sent before that is stale.
  const changedAtRef = useRef(0);

  const clearGone = () => {
    if (goneTimerRef.current) { clearTimeout(goneTimerRef.current); goneTimerRef.current = null; }
  };

  /** The call is over (any final state): release everything, show why for a moment. */
  const finish = useCallback((label?: string) => {
    if (callRef.current) overRef.current.add(callRef.current.id);
    callSounds.stop();
    mediaRef.current.end().catch(() => {});
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    clearGone();
    peerPresentRef.current = false;
    callRef.current = null;
    setCall(null);
    setMuted(false);
    setSpeaker(false);
    setDuration(0);
    if (endedTimerRef.current) clearTimeout(endedTimerRef.current);
    if (label) {
      setEndedLabel(label);
      setCallState('ended');
      endedTimerRef.current = setTimeout(() => setCallState('idle'), ENDED_SCREEN_MS);
    } else {
      setCallState('idle');
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!ticketId) return undefined;
    try {
      const next = await SkoFyApi.supportCalls.status(ticketId);
      setStatus(next);
      return next;
    } catch {
      return undefined;
    }
  }, [ticketId]);

  const hangUp = useCallback(() => {
    const current = callRef.current;
    if (current) SkoFyApi.supportCalls.end(current.id).catch(() => {});
    finish('Call ended');
  }, [finish]);

  const onMediaEvent = useCallback((event: TransportEvent) => {
    const startGone = () => { if (!goneTimerRef.current) goneTimerRef.current = setTimeout(hangUp, GONE_MS); };
    if (event === 'peerJoined') {
      peerPresentRef.current = true;
      clearGone();
    } else if (event === 'peerLeft' || (event === 'connected' && !peerPresentRef.current)) {
      peerPresentRef.current = false;
      startGone();
    } else if (event === 'reconnecting') {
      startGone();
    } else if (event === 'reconnected') {
      if (peerPresentRef.current) clearGone();
    } else if (event === 'disconnected') {
      hangUp();
    }
  }, [hangUp]);

  const connectAudio = useCallback(async (callId: string) => {
    setCallState('connecting');
    callSounds.stop(); // the call's own audio session takes over
    try {
      const access = await mediaRef.current.connect(callId, onMediaEvent);
      if (callRef.current?.id !== callId) return;
      setRecorded(access.recorded);
      setCallState('connected');
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } catch (err) {
      if (err instanceof CallMediaEnded) return;
      setError("Couldn't connect the call. Check your internet and try again.");
      SkoFyApi.supportCalls.end(callId).catch(() => {});
      finish();
    }
  }, [onMediaEvent, finish]);

  // Every update lands here — from the line, or our own requests.
  const apply = useCallback((next: SupportCallView) => {
    if (overRef.current.has(next.id)) return;
    // Support's "is calling" notification only means something while it rings.
    if (next.status !== 'RINGING' && next.started_by === 'agent') dismissSupportCallNotification(next.ticket_id);
    const mine = callRef.current;
    if (!LIVE.has(next.status)) {
      if (mine?.id === next.id) finish(ENDED_LABEL[next.status]);
      refreshStatus();
      return;
    }
    if (mine && mine.id !== next.id) return; // one call at a time
    if (mine?.status === 'ACTIVE' && next.status === 'RINGING') return; // stale: it's been answered
    changedAtRef.current = Date.now();
    callRef.current = next;
    setCall(next);
    if (next.status === 'RINGING') {
      if (next.started_by === 'agent') {
        if (!mine) callSounds.ring(); // support is calling: ring like a phone
        setCallState('ringing');
      } else {
        setCallState('calling');
      }
      // Fetched early, so the recording notice shows before anyone answers.
      mediaRef.current.prepare(next.id).then((a) => setRecorded(a.recorded)).catch(() => {});
    } else if (mine?.status !== 'ACTIVE') {
      connectAudio(next.id); // just answered (the line and our own request both say so)
    }
  }, [connectAudio, refreshStatus, finish]);

  useEffect(() => {
    if (!ticketId) return;
    return openSupportCallLine(ticketId, apply);
  }, [ticketId, apply]);

  // Who they can call, kept current; a live call picked up on reopening the
  // screen; and the call kept in step with the server if the line missed an
  // update (answered, or ended, while it was reconnecting).
  useEffect(() => {
    if (!ticketId) return;
    const sync = async () => {
      const sentAt = Date.now();
      const s = await refreshStatus();
      if (!s) return;
      if (s.live_call) apply(s.live_call);
      // Only a check sent after our latest change can say the call is gone.
      else if (callRef.current && changedAtRef.current < sentAt) finish('Call ended');
    };
    sync();
    const poll = setInterval(sync, STATUS_POLL_MS);
    return () => clearInterval(poll);
  }, [ticketId, refreshStatus, apply, finish]);

  // Leaving the screen hangs up.
  useEffect(() => () => {
    const current = callRef.current;
    if (current) SkoFyApi.supportCalls.end(current.id).catch(() => {});
    callSounds.stop();
    mediaRef.current.end().catch(() => {});
    if (tickRef.current) clearInterval(tickRef.current);
    if (endedTimerRef.current) clearTimeout(endedTimerRef.current);
    if (goneTimerRef.current) clearTimeout(goneTimerRef.current);
  }, []);

  const withMicrophone = async (why: string): Promise<boolean> => {
    const mic = await Audio.requestPermissionsAsync();
    if (!mic.granted) setError(`Allow microphone access for Dodorez in your phone settings to ${why}.`);
    return mic.granted;
  };

  const startCall = useCallback(async () => {
    if (!ticketId || callRef.current) return;
    setError(null);
    if (!(await withMicrophone('call'))) return;
    callSounds.ringback();
    try {
      apply(await SkoFyApi.supportCalls.call(ticketId));
    } catch (err: any) {
      callSounds.stop();
      setError(err?.message ?? "Couldn't start the call.");
      refreshStatus();
    }
  }, [ticketId, apply, refreshStatus]);

  const answer = useCallback(async () => {
    const current = callRef.current;
    if (!current) return;
    callSounds.stop();
    if (!(await withMicrophone('answer'))) {
      SkoFyApi.supportCalls.end(current.id).catch(() => {});
      finish();
      return;
    }
    try {
      apply(await SkoFyApi.supportCalls.answer(current.id));
    } catch (err: any) {
      setError(err?.message ?? "Couldn't answer the call.");
      finish();
    }
  }, [apply, finish]);

  const end = useCallback(async () => {
    const current = callRef.current;
    if (!current) return;
    try {
      apply(await SkoFyApi.supportCalls.end(current.id));
    } catch {
      finish('Call ended');
    }
  }, [apply, finish]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      mediaRef.current.setMuted(!m).catch(() => {});
      return !m;
    });
  }, []);

  const toggleSpeaker = useCallback(() => {
    setSpeaker((on) => {
      mediaRef.current.setSpeaker(!on).catch(() => {});
      return !on;
    });
  }, []);

  return {
    status, call, callState, endedLabel, muted, speaker, recorded, duration, error,
    clearError: () => setError(null),
    startCall, answer, end, toggleMute, toggleSpeaker,
  };
}
