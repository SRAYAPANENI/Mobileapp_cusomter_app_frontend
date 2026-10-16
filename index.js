// Custom entry point (replaces the default "expo-router/entry") so the FCM
// background message handler registers before the component tree mounts —
// required for Android's headless JS to invoke it while the app is killed.
import { registerGlobals } from '@livekit/react-native';
import { registerBackgroundHandler, registerCallDeclineTask } from './services/callManager';

// WebRTC for call audio through our own media server — before anything uses it.
registerGlobals();

registerBackgroundHandler();
registerCallDeclineTask();

import 'expo-router/entry';
