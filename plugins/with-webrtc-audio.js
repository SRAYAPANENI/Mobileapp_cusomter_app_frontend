const { withMainApplication } = require('expo/config-plugins');

// Calls: WebRTC's own echo canceller and noise suppressor instead of the
// phone's hardware ones. Many Android phones ship a weak hardware echo
// canceller, and while it's on WebRTC switches its own (much stronger) one
// off — the other person heard themselves back. react-native-webrtc builds
// its audio module from WebRTCModuleOptions when it starts, so it's set as the
// app starts, before any call.
const MARKER = 'WebRTCModuleOptions.getInstance().audioDeviceModule';

const CODE = `
    // Calls: WebRTC's echo canceller, not the phone's (plugins/with-webrtc-audio.js).
    com.oney.WebRTCModule.WebRTCModuleOptions.getInstance().audioDeviceModule =
      org.webrtc.audio.JavaAudioDeviceModule.builder(this)
        .setUseHardwareAcousticEchoCanceler(false)
        .setUseHardwareNoiseSuppressor(false)
        .setEnableVolumeLogger(false)
        .createAudioDeviceModule()`;

module.exports = function withWebRtcAudio(config) {
  return withMainApplication(config, (config) => {
    const src = config.modResults.contents;
    if (src.includes(MARKER)) return config;
    if (!src.includes('super.onCreate()')) {
      throw new Error('with-webrtc-audio: MainApplication has no super.onCreate() to follow');
    }
    config.modResults.contents = src.replace('super.onCreate()', `super.onCreate()${CODE}`);
    return config;
  });
};
