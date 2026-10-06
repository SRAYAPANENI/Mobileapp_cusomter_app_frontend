const { withMainApplication } = require('expo/config-plugins');

// Incoming calls must ring with the phone's own ringtone (the one picked in
// the phone's settings), following ring volume and silent/vibrate mode — the
// way WhatsApp calls do. Notifee can only give a channel a bundled sound file
// or the short notification beep, and Android fixes a channel's sound when
// the channel is first created. So the channel is created here, natively,
// before any JS runs; Notifee's createChannel() for the same id is then a
// no-op, and the call notification's loopSound keeps it ringing until it's
// answered, declined or cancelled.
//
// CHANNEL_ID must match CALL_CHANNEL_ID in services/callManager.ts.
const CHANNEL_ID = 'incoming_calls_v7';
const MARKER = '// dodorez:call-ringtone-channel';

const KOTLIN = `
    ${MARKER}
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
      val notificationManager = getSystemService(android.app.NotificationManager::class.java)
      if (notificationManager.getNotificationChannel("${CHANNEL_ID}") == null) {
        val channel = android.app.NotificationChannel(
          "${CHANNEL_ID}", "Incoming Calls", android.app.NotificationManager.IMPORTANCE_HIGH,
        )
        channel.setSound(
          android.provider.Settings.System.DEFAULT_RINGTONE_URI,
          android.media.AudioAttributes.Builder()
            .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build(),
        )
        channel.enableVibration(true)
        channel.lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
        notificationManager.createNotificationChannel(channel)
      }
    }`;

module.exports = function withCallRingtoneChannel(config) {
  return withMainApplication(config, (config) => {
    const src = config.modResults.contents;
    if (!src.includes(MARKER)) {
      config.modResults.contents = src.replace(/super\.onCreate\(\)/, (m) => m + KOTLIN);
    }
    return config;
  });
};

module.exports.CHANNEL_ID = CHANNEL_ID;
module.exports.KOTLIN = KOTLIN;
