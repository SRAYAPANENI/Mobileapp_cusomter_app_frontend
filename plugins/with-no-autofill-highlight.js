const { AndroidConfig, withAndroidStyles } = require('expo/config-plugins');

// When Android's autofill service recognises a field (password, phone, the
// sign-in code), it paints a square yellow highlight over it — ignoring the
// field's rounded border, so its corners stick out. Autofill itself still
// works; this only makes that highlight transparent. In a plugin, not
// android/…/styles.xml, so it survives `expo prebuild --clean`.
module.exports = function withNoAutofillHighlight(config) {
  return withAndroidStyles(config, (config) => {
    config.modResults = AndroidConfig.Styles.assignStylesValue(config.modResults, {
      add: true,
      parent: AndroidConfig.Styles.getAppThemeGroup(),
      name: 'android:autofilledHighlight',
      value: '@android:color/transparent',
      targetApi: '26',
    });
    return config;
  });
};
