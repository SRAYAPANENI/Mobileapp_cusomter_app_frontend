import { Room, RoomEvent } from 'livekit-client';

import type { MediaAccess, MediaTransport, TransportEvent } from './mediaTransport';

// A call's audio through our own media server (self-hosted LiveKit). The
// only file that knows LiveKit's room API.
export class LiveKitTransport implements MediaTransport {
  private room: Room | null = null;
  private listeners = new Set<(event: TransportEvent) => void>();

  private emit(event: TransportEvent) {
    this.listeners.forEach(listener => listener(event));
  }

  onEvent(listener: (event: TransportEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async connect(access: MediaAccess): Promise<void> {
    await this.disconnect();
    const room = new Room({
      adaptiveStream: false,
      dynacast: false,
      // WebRTC's own voice processing (see the @livekit/react-native patch).
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.room = room;
    room
      .on(RoomEvent.Reconnecting, () => this.emit('reconnecting'))
      .on(RoomEvent.Reconnected, () => this.emit('reconnected'))
      .on(RoomEvent.Disconnected, () => { if (this.room === room) this.emit('disconnected'); })
      // The recorder joins hidden, so these are only ever the other person.
      .on(RoomEvent.ParticipantConnected, () => { if (this.room === room) this.emit('peerJoined'); })
      .on(RoomEvent.ParticipantDisconnected, () => { if (this.room === room) this.emit('peerLeft'); });
    await room.connect(access.url, access.token, { autoSubscribe: true });
    await room.localParticipant.setMicrophoneEnabled(true);
    this.emit('connected');
    if (room.remoteParticipants.size > 0) this.emit('peerJoined');
  }

  async setMuted(muted: boolean): Promise<void> {
    await this.room?.localParticipant.setMicrophoneEnabled(!muted);
  }

  async disconnect(): Promise<void> {
    const room = this.room;
    this.room = null;  // its Disconnected event no longer counts as a drop
    if (room) await room.disconnect().catch(() => {});
  }
}
