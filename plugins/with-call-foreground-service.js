const { withAndroidManifest } = require('expo/config-plugins');

// The ongoing-call notification (callManager.ts startOngoingCallNotification)
// runs Notifee's ForegroundService with type PHONE_CALL, but Notifee's own
// manifest declares that service as "shortService". From Android 14 a
// foreground service may only start with a type its manifest entry declares —
// otherwise startForeground() throws and the app closes the moment a call
// connects. This re-declares the service with the phoneCall type.
const NOTIFEE_SERVICE = 'app.notifee.core.ForegroundService';

module.exports = function withCallForegroundService(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';
    const application = manifest.application[0];
    application.service = (application.service || []).filter(
      (s) => s.$['android:name'] !== NOTIFEE_SERVICE,
    );
    application.service.push({
      $: {
        'android:name': NOTIFEE_SERVICE,
        'android:exported': 'false',
        'android:foregroundServiceType': 'phoneCall',
        'tools:replace': 'android:foregroundServiceType',
      },
    });
    return config;
  });
};
