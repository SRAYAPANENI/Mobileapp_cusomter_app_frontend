import { SkoFyApi, getFreshAccessToken } from '@/services/api';
import { qk } from '@/services/queries/keys';
import { queryClient } from '@/services/query-client';

/** A live nudge for "something in /app-config changed" — modules,
 * maintenance, logo or terms. AppConfigService (app/api/v1/ws.py) broadcasts
 * {type: "app_config_changed"} over this the instant an admin saves a real
 * change, so an already-open, signed-in app reacts in about a second instead
 * of waiting out useAppConfig's poll interval — the fix for "I turned it off
 * and it's still there." The payload carries no values of its own; on
 * receipt this just invalidates the query, so /app-config stays the one
 * place the actual numbers live.
 *
 * Started once at root layout mount and left running for the process's
 * whole life: with no session yet (or no longer one, after sign-out) connect()
 * simply finds no token and backs off, so the same loop picks a fresh login
 * back up on its own without needing to be started again. Ping cadence and
 * reconnect backoff match the proven services/call/supportCallLine.ts. */

const MAX_RETRY_MS = 30_000;
// The server closes a line that's silent for 75 s (ws.py's _hold_open).
const PING_MS = 25_000;

let socket: WebSocket | null = null;
let started = false;
let retry = 1000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleReconnect() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, retry);
  retry = Math.min(retry * 2, MAX_RETRY_MS);
}

async function connect() {
  if (socket) return;
  const token = await getFreshAccessToken().catch(() => null);
  if (!token) {
    scheduleReconnect();
    return;
  }

  const ws = new WebSocket(SkoFyApi.appConfig.getSocketUrl());
  socket = ws;

  ws.onopen = () => {
    try {
      ws.send(JSON.stringify({ type: 'auth', token }));
    } catch {
      // onclose below handles the reconnect.
    }
    retry = 1000;
  };
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(String(event.data));
      if (data?.type === 'app_config_changed') {
        queryClient.invalidateQueries({ queryKey: qk.appConfig });
      }
    } catch {
      // Malformed frame — never worth crashing a background listener over.
    }
  };
  ws.onclose = () => {
    if (socket === ws) socket = null;
    scheduleReconnect();
  };
  ws.onerror = () => {
    try {
      ws.close();
    } catch {
      // already closing — onclose above does the rest.
    }
  };
}

export function startAppConfigSocket() {
  if (started) return;
  started = true;
  connect();
  setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) socket.send('ping');
  }, PING_MS);
}

/** Signing out: the open socket's identity is gone, so close it rather than
 * let a stale connection keep "working" under the old account. The retry
 * loop (and the ping interval, already running) keep going underneath and
 * reconnect under whichever account logs in next — no separate re-start
 * needed. */
export function stopAppConfigSocket() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  retry = 1000;
  if (socket) {
    try {
      socket.close();
    } catch {
      // already closing
    }
    socket = null;
  }
  if (started) scheduleReconnect();
}
