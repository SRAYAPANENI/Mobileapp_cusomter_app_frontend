import InCallManager from 'react-native-incall-manager';

// The phone's call sounds while a call isn't connected yet: the ringtone for
// an incoming call, the ringback for one we're making. Once answered, the
// call's own audio session (CallMedia) takes over and these stop.
export const callSounds = {
  /** Someone's calling us: the phone's own ringtone. */
  ring(): void {
    // No vibration (0), the default iOS category, looping until stopped:
    // the library's own defaults, spelled out because its typings want all four.
    InCallManager.startRingtone('_DEFAULT_', 0, 'default', -1);
  },
  /** We're calling: ringback in the call's audio route. */
  ringback(): void {
    InCallManager.start({ media: 'audio' });
    InCallManager.startRingback('_DTMF_');
  },
  /** Silence, and hand the audio route back (before CallMedia connects, or when the call's over). */
  stop(): void {
    InCallManager.stopRingtone();
    InCallManager.stopRingback();
    InCallManager.stop();
  },
};
