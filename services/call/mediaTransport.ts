// The audio of an answered call, behind one interface (docs/CALL_RECORDING_DESIGN.md).
// The call screen depends on this, never on WebRTC or LiveKit directly, so the
// transport can be swapped or faked without touching ringing, notifications or UI.

/** A pass from our API to join one call's room on our media server. */
export interface MediaAccess {
  url: string;
  token: string;
  room: string;
  /** The call is recorded: the screen shows the recording notice. */
  recorded: boolean;
}

export type TransportEvent =
  | 'connected'      // this phone is in the call's room
  | 'reconnecting'   // this phone's network dropped; the transport is restoring it
  | 'reconnected'
  | 'disconnected'   // this phone is out for good (left, or couldn't come back)
  | 'peerJoined'     // the other person is in the room (also sent on connect if already there)
  | 'peerLeft';      // the other person left the room — their app may be gone

export interface MediaTransport {
  /** Joins the call's room and starts sending the microphone. */
  connect(access: MediaAccess): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  /** Leaves the room. Safe to call more than once. */
  disconnect(): Promise<void>;
  /** Returns an unsubscribe function. */
  onEvent(listener: (event: TransportEvent) => void): () => void;
}
