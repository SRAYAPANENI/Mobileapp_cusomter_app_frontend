const { withAppDelegate } = require('expo/config-plugins');

// PushKit VoIP registration + CallKit incoming-call reporting — the only
// way to get a real incoming-call screen on iOS for a backgrounded/killed
// app, matching Android's CallStyleModule/notification-based flow. Must be
// native: Apple requires every VoIP push to be reported to CallKit inside
// the PKPushRegistryDelegate callback itself, before JS can possibly react
// (the app may not even have a JS bridge running yet).
const MARKER = 'PKPushRegistryDelegate';

function withPushKitRegistration(config) {
  return withAppDelegate(config, (config) => {
    let contents = config.modResults.contents;
    if (contents.includes(MARKER)) return config;

    contents = contents.replace(
      /^(import .+\n)/,
      `$1import PushKit\nimport RNVoipPushNotification\nimport RNCallKeep\n`,
    );

    // voipRegistry must be a stored property, not a local — a local `let`
    // gets deallocated by ARC the moment didFinishLaunchingWithOptions
    // returns, silently killing VoIP push delivery.
    contents = contents.replace(
      /(var window: UIWindow\?\n)/,
      `$1  var voipRegistry: PKPushRegistry?\n`,
    );

    contents = contents.replace(
      /(func application\([^)]*didFinishLaunchingWithOptions[^{]*\{\n)/,
      `$1    voipRegistry = PKPushRegistry(queue: nil)\n    voipRegistry?.delegate = self\n    voipRegistry?.desiredPushTypes = [PKPushType.voIP]\n`,
    );

    contents += `
extension AppDelegate: ${MARKER} {
  public func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    RNVoipPushNotificationManager.didUpdate(pushCredentials, forType: type.rawValue)
  }

  public func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    // No action needed — see react-native-voip-push-notification's docs.
  }

  // Apple requires every VoIP push to result in reportNewIncomingCall
  // within this callback, or the app can be killed/throttled from
  // receiving further VoIP pushes — this can't be deferred to JS, which
  // may not even be running yet for a killed app. The backend only ever
  // sends a VoIP push for a real incoming-call invite (see
  // notification_tasks.py's send_call_push) — never for anything else —
  // so no payload-type branching is needed here.
  public func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
    let callerName = (payload.dictionaryPayload["caller_name"] as? String) ?? "Incoming Call"
    RNCallKeep.reportNewIncomingCall(
      UUID().uuidString,
      handle: callerName,
      handleType: "generic",
      hasVideo: false,
      localizedCallerName: callerName,
      supportsHolding: true,
      supportsDTMF: true,
      supportsGrouping: false,
      supportsUngrouping: false,
      fromPushKit: true,
      payload: payload.dictionaryPayload,
      withCompletionHandler: nil
    )
    completion()
  }
}
`;

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = function withPushkitVoip(config) {
  config = withPushKitRegistration(config);
  return config;
};
