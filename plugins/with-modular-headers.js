const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// FirebaseCoreInternal's Swift pod depends on GoogleUtilities, which (like
// most CocoaPods pods) doesn't define a Clang module by default — pod install
// fails with "does not define modules" unless something makes it modular.
// use_modular_headers! is the targeted fix CocoaPods' own error message
// suggests: it makes every pod define a module, while keeping plain static
// *library* linking (not switching to use_frameworks!). The alternative,
// use_frameworks! :linkage => :static, additionally forces every pod to
// build as a Framework module, which is what triggers a much bigger class of
// cross-module Objective-C visibility errors in @react-native-firebase's
// Objective-C sources (RNFBApp/RNFBMessaging) — this avoids that entirely.
const MARKER = '# with-modular-headers';

module.exports = function withModularHeaders(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf-8');
      if (contents.includes(MARKER)) return config;

      contents = contents.replace(
        /(prepare_react_native_project!\n)/,
        `$1\n${MARKER}\nuse_modular_headers!\n`,
      );
      fs.writeFileSync(podfilePath, contents);
      return config;
    },
  ]);
};
