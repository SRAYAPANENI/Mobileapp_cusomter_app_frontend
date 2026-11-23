import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { BASE_URL, getFreshAccessToken } from '@/services/api';

const WS_BASE = BASE_URL.replace(/^http/, 'ws');

/** Listens on a job's live line (/ws/jobs/{id}) while the screen is in front,
 * and calls `onEvent` with each message's type and body — e.g. the applicants
 * screen hearing "applicants_changed" when someone applies or withdraws.
 * Reconnects with backoff (1s → 30s); closes when the screen loses focus. */
export function useJobEvents(jobId: string | undefined, onEvent: (type: string, msg: any) => void) {
  // The latest handler, without reconnecting each render.
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useFocusEffect(useCallback(() => {
    if (!jobId) return;
    let closed = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let delay = 1000;

    const connect = async () => {
      const token = await getFreshAccessToken();
      if (!token || closed) return;
      ws = new WebSocket(`${WS_BASE}/ws/jobs/${jobId}`);
      // The token goes as the first message, never in the URL (ws.py).
      ws.onopen = () => { ws?.send(JSON.stringify({ type: 'auth', token })); delay = 1000; };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (typeof msg?.type === 'string') handler.current(msg.type, msg);
        } catch {}
      };
      ws.onclose = (e) => {
        // 4403/4404: not this person's job, or gone — retrying can't help.
        if (closed || e.code === 4403 || e.code === 4404) return;
        retry = setTimeout(() => { delay = Math.min(delay * 2, 30000); connect(); }, delay);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [jobId]));
}
