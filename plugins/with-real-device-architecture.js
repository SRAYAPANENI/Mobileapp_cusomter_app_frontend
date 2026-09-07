const { withGradleProperties } = require('expo/config-plugins');

// Expo's default template bundles all 4 ABIs (armeabi-v7a, arm64-v8a, x86,
// x86_64) into the APK — x86/x86_64 only exist to run on an emulator, never
// on a real device, and including them roughly quadruples the native library
// payload. This used to be a hand-edit to android/gradle.properties after
// each prebuild — fragile, since `expo prebuild --clean` regenerates that
// file from scratch and silently drops the edit (confirmed: it did, the
// first time this ran after being added). Doing it as a config plugin
// instead means it survives every future prebuild automatically. Mirrors
// the identical plugin in skofy-service-provider-app/plugins/.
const REAL_DEVICE_ARCHITECTURES = 'arm64-v8a';

module.exports = function withRealDeviceArchitecture(config) {
  return withGradleProperties(config, (config) => {
    const props = config.modResults;
    const key = 'reactNativeArchitectures';
    const existing = props.find((p) => p.type === 'property' && p.key === key);
    if (existing && existing.type === 'property') {
      existing.value = REAL_DEVICE_ARCHITECTURES;
    } else {
      props.push({ type: 'property', key, value: REAL_DEVICE_ARCHITECTURES });
    }
    return config;
  });
};
