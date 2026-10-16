import { AndroidAudioTypePresets, AudioSession } from '@livekit/react-native';
import { Platform } from 'react-native';

import { SkoFyApi } from '@/services/api';

import { LiveKitTransport } from './livekitTransport';
import type { MediaAccess, MediaTransport, TransportEvent } from './mediaTransport';

// One call's audio: the pass, the transport and the phone's audio session —
// so the call screen only says prepare / connect / mute / speaker / end.
// docs/CALL_RECORDING_DESIGN.md.
export class CallMedia {
  private access: MediaAccess | null = null;
  private accessFor: string | null = null;
  // One fetch per call at a time; only the latest one fills the cache.
  private pending: { callId: string; promise: Promise<MediaAccess> } | null = null;
  private sessionStarted = false;
  private unsubscribe: (() => void) | null = null;
  // Bumped by end(): a connect still under way for an earlier call stops
  // instead of joining a room nobody will leave (mic on, recorder running).
  private generation = 0;
  // Mute and speaker can be pressed while it still rings; applied on connect.
  private muted = false;
  private speaker = false;

  constructor(private readonly transport: MediaTransport = new LiveKitTransport()) {}

  /** Fetches the call's pass early (while ringing) so the recording notice
   * shows before answering, and answering doesn't wait for it. */
  async prepare(callId: string): Promise<MediaAccess> {
    if (this.access && this.accessFor === callId) return this.access;
    if (this.pending?.callId === callId) return this.pending.promise;
    const promise: Promise<MediaAccess> = SkoFyApi.calls.media(callId)
      .then(access => {
        if (this.pending?.promise === promise) { this.access = access; this.accessFor = callId; }
        return access;
      })
      .finally(() => { if (this.pending?.promise === promise) this.pending = null; });
    this.pending = { callId, promise };
    return promise;
  }

  /** Joins the call's audio. `onEvent` hears drops and recoveries. */
  async connect(callId: string, onEvent: (event: TransportEvent) => void): Promise<MediaAccess> {
    const mine = this.generation;
    const stale = () => mine !== this.generation;
    const access = await this.prepare(callId);
    if (stale()) throw new CallMediaEnded();
    this.unsubscribe?.();
    this.unsubscribe = this.transport.onEvent(onEvent);
    await AudioSession.configureAudio({
      android: { preferredOutputList: ['bluetooth', 'headset', 'earpiece', 'speaker'], audioTypeOptions: AndroidAudioTypePresets.communication },
      ios: { defaultOutput: 'earpiece' },
    });
    await AudioSession.startAudioSession();
    this.sessionStarted = true;
    if (stale()) { await this.release(); throw new CallMediaEnded(); }
    await this.transport.connect(access);
    if (stale()) { await this.transport.disconnect(); throw new CallMediaEnded(); }
    if (this.muted) await this.transport.setMuted(true).catch(() => {});
    if (this.speaker) await this.applySpeaker();
    return access;
  }

  setMuted(muted: boolean): Promise<void> {
    this.muted = muted;
    return this.transport.setMuted(muted);
  }

  async setSpeaker(on: boolean): Promise<void> {
    this.speaker = on;
    if (this.sessionStarted) await this.applySpeaker();
  }

  private async applySpeaker(): Promise<void> {
    const on = this.speaker;
    const output = Platform.OS === 'ios' ? (on ? 'force_speaker' : 'default') : (on ? 'speaker' : 'earpiece');
    await AudioSession.selectAudioOutput(output).catch(() => {});
  }

  /** Leaves the call's audio and releases everything. Safe to call more than once. */
  async end(): Promise<void> {
    this.generation += 1;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.access = null;
    this.accessFor = null;
    this.pending = null;
    this.muted = false;
    this.speaker = false;
    await this.release();
  }

  private async release(): Promise<void> {
    await this.transport.disconnect();
    if (this.sessionStarted) {
      this.sessionStarted = false;
      await AudioSession.stopAudioSession().catch(() => {});
    }
  }
}

/** The call ended while its audio was still connecting — not a failure. */
export class CallMediaEnded extends Error {
  constructor() {
    super('The call ended while connecting');
    this.name = 'CallMediaEnded';
  }
}
