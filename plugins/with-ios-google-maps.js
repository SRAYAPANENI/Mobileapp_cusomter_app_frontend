const { withAppDelegate, withPodfile } = require('expo/config-plugins');

// react-native-maps@1.20.1 ships no Expo config plugin at all (no
// app.plugin.js) and its own podspec only depends on React-Core — it does
// NOT auto-link the Google Maps iOS SDK the way it does on Android via
// app.json's android.config.googleMaps. PROVIDER_GOOGLE on iOS needs both
// the GoogleMaps pod linked AND GMSServices.provideAPIKey() called before
// any map renders, neither of which happens without this plugin.
const GOOGLE_MAPS_API_KEY = 'AIzaSyC9GCq5AcsfOek3gTzAJHe1105SryMJc8Q';
const MARKER = 'with-ios-google-maps';

function withGoogleMapsPod(config) {
  return withPodfile(config, (config) => {
    let contents = config.modResults.contents;
    if (contents.includes(`pod 'GoogleMaps'`)) return config;
    contents = contents.replace(
      /(target '[^']+' do\n)/,
      `$1  # ${MARKER}\n  pod 'GoogleMaps'\n  pod 'Google-Maps-iOS-Utils'\n`,
    );
    config.modResults.contents = contents;
    return config;
  });
}

function withGoogleMapsApiKey(config) {
  return withAppDelegate(config, (config) => {
    let contents = config.modResults.contents;
    if (contents.includes('GMSServices')) return config;

    const isSwift = config.modResults.language === 'swift';
    if (isSwift) {
      contents = contents.replace(
        /^(import .+\n)/,
        `$1import GoogleMaps\n`,
      );
      contents = contents.replace(
        /(func application\([^)]*didFinishLaunchingWithOptions[^{]*\{\n)/,
        `$1    GMSServices.provideAPIKey("${GOOGLE_MAPS_API_KEY}")\n`,
      );
    } else {
      contents = contents.replace(
        /(#import <React\/RCTBridge\.h>\n)/,
        `$1#import <GoogleMaps/GoogleMaps.h>\n`,
      );
      contents = contents.replace(
        /(didFinishLaunchingWithOptions:\(NSDictionary \*\)launchOptions\n\{\n)/,
        `$1  [GMSServices provideAPIKey:@"${GOOGLE_MAPS_API_KEY}"];\n`,
      );
    }
    config.modResults.contents = contents;
    return config;
  });
}

module.exports = function withIosGoogleMaps(config) {
  config = withGoogleMapsPod(config);
  config = withGoogleMapsApiKey(config);
  return config;
};
