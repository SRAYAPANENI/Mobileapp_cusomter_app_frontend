import { SkoFyApi, getFreshAccessToken, type SupportCallView } from '@/services/api';

// A support ticket's live line (/ws/support/<ticket>): call updates from the
// server while the support chat is open. Only knows how to stay connected
// and hand them over.

const MAX_RETRY_MS = 30000;
// The server closes a line that's silent for 75 s (so a gone phone doesn't look reachable).
const PING_MS = 25000;

/** Opens the line and keeps it open (reconnecting with backoff). Returns close(). */
export function openSupportCallLine(ticketId: string, onCall: (call: SupportCallView) => void): () => void {
  let socket: WebSocket | null = null;
  let closed = false;
  let retry = 1000;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReconnect = () => {
    retryTimer = setTimeout(connect, retry);
    retry = Math.min(retry * 2, MAX_RETRY_MS);
  };

  async function connect() {
    const token = await getFreshAccessToken();
    if (closed || !token) return;
    socket = new WebSocket(SkoFyApi.supportCalls.getSocketUrl(ticketId));
    socket.onopen = () => {
      socket?.send(JSON.stringify({ type: 'auth', token })); // first message: never in the URL
      retry = 1000;
    };
    socket.onmessage = (e) => {
      try {
        const data = JSON.parse(String(e.data));
        if (data?.type === 'support_call' && data.call?.ticket_id === ticketId) onCall(data.call);
      } catch { /* not for us */ }
    };
    socket.onclose = (e) => {
      if (closed || e.code === 4403 || e.code === 4404) return;
      // 4401: signed out elsewhere, or the login expired — asking once runs the
      // normal "Signed Out" flow if it's the former; otherwise reconnect.
      if (e.code === 4401) {
        SkoFyApi.auth.checkSession().then(scheduleReconnect, (err: any) => {
          if (err?.error_code !== 'SESSION_EXPIRED') scheduleReconnect();
        });
      } else {
        scheduleReconnect();
      }
    };
  }

  connect();
  const ping = setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) socket.send('ping');
  }, PING_MS);
  return () => {
    closed = true;
    clearInterval(ping);
    if (retryTimer) clearTimeout(retryTimer);
    socket?.close();
  };
}
