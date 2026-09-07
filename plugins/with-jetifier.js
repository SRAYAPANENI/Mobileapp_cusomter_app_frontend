const { withGradleProperties } = require('expo/config-plugins');

// @react-native-voice/voice's android/build.gradle still declares
// `com.android.support:appcompat-v7` (pre-AndroidX, unmaintained package) —
// that legacy artifact ships its own copy of android.support.v4.app.* classes
// that collide with the compat shims androidx.core:core already ships,
// failing :app:checkReleaseDuplicateClasses. Jetifier rewrites legacy
// support-library artifacts to their AndroidX equivalents at build time,
// which resolves the collision at the source instead of needing an
// exclude-group workaround for every future package with the same problem.
// Same durability reasoning as with-real-device-architecture.js: setting
// this by hand in android/gradle.properties doesn't survive
// `expo prebuild --clean` regenerating that file from scratch.
module.exports = function withJetifier(config) {
  return withGradleProperties(config, (config) => {
    const props = config.modResults;
    const key = 'android.enableJetifier';
    const existing = props.find((p) => p.type === 'property' && p.key === key);
    if (existing && existing.type === 'property') {
      existing.value = 'true';
    } else {
      props.push({ type: 'property', key, value: 'true' });
    }
    return config;
  });
};
