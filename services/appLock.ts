import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const APP_LOCK_KEY = 'skofy_app_lock_enabled';

export const AppLock = {
  async isEnabled(): Promise<boolean> {
    return (await SecureStore.getItemAsync(APP_LOCK_KEY)) === 'true';
  },

  async setEnabled(enabled: boolean): Promise<void> {
    await SecureStore.setItemAsync(APP_LOCK_KEY, enabled ? 'true' : 'false');
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
