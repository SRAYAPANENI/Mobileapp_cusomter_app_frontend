import notifee, { AuthorizationStatus } from '@notifee/react-native';

// Notifications allowed or not — one place for asking and for checking, so
// the "Turn on notifications" nudge reads the answer, not the moment before
// it. Asked once per launch (callManager's initCallManager); the home screen
// used to check at the same moment and, finding it not answered yet, showed
// the nudge to people who then tapped Allow — and never looked again.

let asking: Promise<unknown> | null = null;

/** Shows the system prompt where one is due (Android 13+, iOS's first
 * time) — once per launch, whoever asks first: two at once could put the
 * prompt up twice. */
export function askNotificationPermission(): Promise<unknown> {
  if (!asking) {
    asking = notifee.requestPermission().catch((err) => {
      console.error('Failed to request notification permission:', err);
    });
  }
  return asking;
}

/** True only when they're turned off. Waits for the prompt to be answered
 * — starting it if it hasn't been yet: the home screen's check runs before
 * the root layout's (a child's effects run first), and on Android 13+ "not
 * asked yet" reads as off. iOS's "not asked yet" isn't off either. */
export async function notificationsBlocked(): Promise<boolean> {
  await askNotificationPermission();
  const { authorizationStatus } = await notifee.getNotificationSettings();
  return authorizationStatus === AuthorizationStatus.DENIED;
}
