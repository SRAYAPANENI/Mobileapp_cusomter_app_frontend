import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';

// This app's own setting: the name both apps shared ('skofy_app_lock_enabled')
// was one setting where both run inside one host app, so turning the lock on
// in one turned it on in the other. Still read when this one isn't set yet.
const APP_LOCK_KEY = 'dodorez_customer_app_lock_enabled';
const SHARED_APP_LOCK_KEY = 'skofy_app_lock_enabled';

export const AppLock = {
  /** Woken with the phone locked (a call, a notification), iOS can keep the
   * setting shut: failing then left the lock off for that whole run, so the
   * app opened unlocked. Waits until it can be read — the app in front. */
  async isEnabled(): Promise<boolean> {
    for (;;) {
      try {
        const own = await SecureStore.getItemAsync(APP_LOCK_KEY);
        return (own ?? await SecureStore.getItemAsync(SHARED_APP_LOCK_KEY)) === 'true';
      } catch {
        await new Promise<void>(resolve => {
          const retry = setTimeout(done, 2_000);
          const sub = AppState.addEventListener('change', state => { if (state === 'active') done(); });
          function done() { clearTimeout(retry); sub.remove(); resolve(); }
        });
      }
    }
  },

  async setEnabled(enabled: boolean): Promise<void> {
    // Removed first: writing over an entry keeps how it was first stored,
    // and this one must be readable while the phone is locked.
    await SecureStore.deleteItemAsync(APP_LOCK_KEY);
    await SecureStore.setItemAsync(APP_LOCK_KEY, enabled ? 'true' : 'false', {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  },

  // Whether this device can actually do biometric auth right now — no
  // fingerprint/Face ID sensor, or a sensor with nothing enrolled, both
  // mean the toggle shouldn't be offered (or should explain why not).
  async isAvailable(): Promise<boolean> {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return false;
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    return isEnrolled;
  },

  async authenticate(promptMessage: string): Promise<boolean> {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });
    return result.success;
  },
};
