// Custom entry point (replaces the default "expo-router/entry") so the FCM
// background message handler registers before the component tree mounts —
// required for Android's headless JS to invoke it while the app is killed.
import { registerBackgroundHandler, registerCallDeclineTask } from './services/callManager';

registerBackgroundHandler();
registerCallDeclineTask();

import 'expo-router/entry';
