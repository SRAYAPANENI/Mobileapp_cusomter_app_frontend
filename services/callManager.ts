import notifee, { AndroidForegroundServiceType, AndroidImportance, AndroidStyle, AndroidVisibility, EventType } from '@notifee/react-native';
import messaging from '@react-native-firebase/messaging';
import { router } from 'expo-router';
import { Alert, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import RNCallKeep from 'react-native-callkeep';
import VoipPushNotification from 'react-native-voip-push-notification';
import { SkoFyApi, TokenStore } from './api';

// Android-only native module (see CallStyleModule.kt/CallActionModule.kt) that
// shows the incoming-call notification using NotificationCompat.CallStyle —
// the only way to get real colored green/red Accept/Decline buttons; Notifee's
// generic notification actions can only ever render as plain text.
const { CallStyleModule, CallActionModule } = NativeModules;
const callActionEmitter = CallActionModule ? new NativeEventEmitter(CallActionModule) : null;

// v4: bumped because Android locks a channel's sound/audio-attributes forever
// once created — MainApplication.kt now pre-creates this exact id natively,
// using the phone's actual default ringtone (not a bundled custom tone) with
// USAGE_NOTIFICATION_RINGTONE so it follows the ring/vibrate/silent state like
// a real call. This JS-side createChannel() call below just becomes a no-op
// against that (Android ignores re-creating an existing id).
const CALL_CHANNEL_ID = 'incoming_calls_v5';
const ONGOING_CALL_CHANNEL_ID = 'ongoing_calls_v1';

interface IncomingCallData {
  jobId: string;
  callerId: string;
  callerName: string;
}

// Deterministic per-job id — without this, every push created a brand new
// notification with a random id, so multiple ring attempts (retries, re-offers)
// stacked up instead of replacing each other, and declining one left others behind.
function notificationIdFor(jobId: string) {
  return `incoming-call-${jobId}`;
}

/** Native events (CallStyle Accept/Decline, missed-call tap) can fire while
 * the app is still cold-starting — the JS engine reports itself as "active"
 * before Expo Router's Root Layout has actually finished mounting, so a
 * router.push() at that exact moment throws "Attempted to navigate before
 * mounting the Root Layout component" and the navigation is silently lost
 * (which, for an incoming call, meant the call never actually got answered
 * and the caller's side just kept re-ringing). Retrying past that brief
 * window fixes it without needing any deeper Expo Router API. */
function safeNavigate(fn: () => void, attempt = 0) {
  try {
    fn();
  } catch {
    if (attempt < 15) setTimeout(() => safeNavigate(fn, attempt + 1), 200);
  }
}

function navigateToCall(call: IncomingCallData, autoAnswer: boolean) {
  // Must happen before the push — see isCallScreenActive's comment (further
  // down this file) for why AppLockGate needs this signal immediately,
  // synchronously, rather than waiting for chat.tsx to actually mount:
  // every caller of navigateToCall is "the user is being taken to the call
  // screen right now" (Android's notification Accept tap, iOS's CallKit
  // answerCall, a cold-start call notification tap), and re-locking at
  // exactly that moment would unmount the Stack this push targets, silently
  // dropping the navigation once safeNavigate's retries run out.
  isAnsweringCall = true;
  onCallBecameActive?.();
  setTimeout(() => { isAnsweringCall = false; }, 8000);

  safeNavigate(() => router.push({
    pathname: '/chat',
    params: {
      jobId: call.jobId,
      id: call.callerId,
      name: call.callerName,
      profession: 'Incoming Call',
      autoAnswer: autoAnswer ? 'true' : 'false',
    },
  } as any));
}

// Fire-and-forget: opens a short-lived socket just to relay the decline,
// since the app may not otherwise have any active connection to this job
// right now (that's exactly why we needed the push in the first place).
async function sendDecline(jobId: string) {
  try {
    const url = await SkoFyApi.chat.getSocketUrl(jobId);
    const ws = new WebSocket(url);
    await new Promise<void>((resolve) => {
      const done = () => { try { ws.close(); } catch {} resolve(); };
      ws.onopen = async () => {
        const token = await TokenStore.getAccessToken();
        ws.send(JSON.stringify({ type: 'auth', token }));
        ws.send(JSON.stringify({ type: 'call_end' }));
        setTimeout(done, 300);
      };
      ws.onerror = done;
      setTimeout(done, 3000);
    });
  } catch (err) {
    // The caller's side gets no feedback either way if this fails (they'll
    // just keep ringing/retrying until their own timeout) — at minimum, log
    // it so a silent decline failure is visible during debugging.
    console.error('Failed to relay call decline:', err);
  }
}

async function ensureCallChannel() {
  await notifee.createChannel({
    id: CALL_CHANNEL_ID,
    name: 'Incoming Calls',
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PUBLIC,
    sound: 'ringtone',
  });
}

// Tracks which jobs currently have an incoming-call notification actually
// showing on this device — lets handleCallCancelled() decide for itself
// whether a "Missed call" notice makes sense (only if this device was the one
// ringing) without the backend needing to know who's ringing whom.
const ringingJobIds = new Set<string>();

async function showIncomingCallNotification(data: IncomingCallData) {
  ringingJobIds.add(data.jobId);
  // CallStyleModule gives real colored Accept/Decline buttons via Android's
  // native CallStyle template; falls back to Notifee's plain-action version
  // on iOS (practically unused there — iOS calls arrive via PushKit/CallKit,
  // never this path) or if the native module somehow isn't available.
  if (Platform.OS === 'android' && CallStyleModule) {
    await CallStyleModule.showIncoming(data.jobId, data.callerName);
    return;
  }
  await ensureCallChannel();
  await notifee.displayNotification({
    id: notificationIdFor(data.jobId),
    title: 'Incoming call',
    body: `${data.callerName} is calling…`,
    data: data as any,
    android: {
      channelId: CALL_CHANNEL_ID,
      importance: AndroidImportance.HIGH,
      category: 'call' as any,
      largeIcon: require('@/assets/images/icon-mark.png'),
      circularLargeIcon: true,
      fullScreenAction: { id: 'default' },
      pressAction: { id: 'default' },
      actions: [
        { title: 'Decline', pressAction: { id: 'decline' } },
        { title: 'Accept', pressAction: { id: 'accept' } },
      ],
      ongoing: true,
      autoCancel: false,
      loopSound: true,
    },
  });
}

/** Exported so chat.tsx can call this directly from handleAcceptCall/
 * handleDeclineCall as a safety net — answering or declining in-app should
 * always dismiss any matching incoming-call notification, even if the
 * activeChatJobId suppression below didn't catch it for some reason (e.g. a
 * push that slipped in before the mount effect ran). */
export function cancelIncomingCallNotification(jobId: string) {
  ringingJobIds.delete(jobId);
  if (Platform.OS === 'android' && CallStyleModule) {
    CallStyleModule.cancel(jobId);
    return;
  }
  notifee.cancelNotification(notificationIdFor(jobId));
}

// Tracks which job's chat screen is currently mounted in the foreground, so
// the foreground push handler (messaging().onMessage, below) knows not to
// ALSO show the incoming-call notification when the WS-driven in-app ringing
// UI for that exact call is already covering it — otherwise both showed up
// at once, and answering in-app never told the notification to go away.
let activeChatJobId: string | null = null;

// Set the instant an incoming call is answered (before the navigation to
// chat.tsx even happens), cleared once chat.tsx mounts and takes over via
// setActiveChatJob — see the 'answerCall' listener below for why this can't
// just wait for activeChatJobId: AppLockGate needs to know a call is
// becoming active in the same tick the app comes to foreground, not a few
// hundred ms later once the pushed route has actually mounted.
let isAnsweringCall = false;

// True only while chat.tsx's own callState is not 'idle' (ringing,
// connecting, or connected) — deliberately NOT tied to activeChatJobId
// above, which is set for EVERY chat screen open (a plain text
// conversation, not just a call) and exists purely to suppress duplicate
// incoming-call notifications. Conflating the two would mean opening any
// ordinary chat and backgrounding the app skips re-locking entirely — a
// real App Lock security regression, not just a call-handling nicety.
let chatCallActive = false;

/** True while a call/chat screen has an actual call in progress, or an
 * incoming call is in the process of being answered (see isAnsweringCall
 * above). AppLockGate checks this before re-locking on foreground —
 * re-locking mid-call would unmount the active call screen entirely (see
 * app-lock-gate.tsx's own comment on why it unmounts rather than
 * overlays), and if it fires exactly when an incoming call is answered,
 * the pending navigation to the call screen would be pushed against an
 * unmounted Stack and silently dropped once safeNavigate's retry budget
 * runs out. */
export function isCallScreenActive(): boolean {
  return chatCallActive || isAnsweringCall;
}

// AppLockGate registers itself here on mount so a call that becomes active
// while the app is ALREADY showing the lock screen (not just about to) can
// force it to dismiss immediately — otherwise the user would be stuck
// staring at "App Locked" with a connected call underneath it until they
// happened to unlock on their own.
let onCallBecameActive: (() => void) | null = null;
export function setCallActiveHandler(fn: (() => void) | null) {
  onCallBecameActive = fn;
}

/** Call from chat.tsx whenever its own callState changes (see the CallState
 * type there) — true for anything but 'idle'. This, not setActiveChatJob
 * below, is what AppLockGate's isCallScreenActive() actually reads. */
export function setChatCallActive(active: boolean) {
  chatCallActive = active;
  if (active) onCallBecameActive?.();
}

/** Call from chat.tsx on mount/unmount (with the screen's jobId, or null on
 * unmount) — see activeChatJobId above. */
export function setActiveChatJob(jobId: string | null) {
  activeChatJobId = jobId;
}

const MISSED_CALL_CHANNEL_ID = 'missed_calls_v1';

/** One-shot "Missed call" notice — replaces the incoming-call notification
 * once the caller hangs up (or times out) before this device ever answers. */
async function showMissedCallNotification(jobId: string, callerName: string) {
  await notifee.createChannel({
    id: MISSED_CALL_CHANNEL_ID,
    name: 'Missed Calls',
    importance: AndroidImportance.DEFAULT,
    visibility: AndroidVisibility.PUBLIC,
  });
  await notifee.displayNotification({
    id: `missed-call-${jobId}`,
    title: 'Missed call',
    body: `You missed a call from ${callerName}`,
    data: { missedCallJobId: jobId, callerName } as any,
    android: {
      channelId: MISSED_CALL_CHANNEL_ID,
      pressAction: { id: 'default' },
      autoCancel: true,
    },
  });
}

/** Tapping "Missed call" opens the chat for that job (not a call screen) —
 * the user sees the "Missed voice call" log bubble there and can choose to
 * call back themselves, same as WhatsApp/a real phone's missed-call notice.
 * Deliberately doesn't set autoAnswer, so chat.tsx renders its normal idle
 * view rather than the call overlay. */
function openChatForMissedCall(jobId: string, callerName: string) {
  safeNavigate(() => router.push({ pathname: '/chat', params: { jobId, name: callerName } } as any));
}

const JOB_STARTED_CHANNEL_ID = 'job_started_v1';

/** Fired when the provider's "Start Job" location check passes server-side —
 * a real visible notification has to be built explicitly here since the push
 * itself is a silent data-only message (see send_push_notification on the
 * backend). The actual "arrived and started" log lives in the job's chat
 * (same system-message mechanism as the call log) — this just alerts the
 * customer that it happened. */
async function showJobStartedNotification(jobId: string, providerName: string) {
  await notifee.createChannel({
    id: JOB_STARTED_CHANNEL_ID,
    name: 'Service Updates',
    importance: AndroidImportance.DEFAULT,
    visibility: AndroidVisibility.PUBLIC,
  });
  await notifee.displayNotification({
    id: `job-started-${jobId}`,
    title: 'Provider arrived',
    body: `${providerName} has arrived and started the job`,
    data: { jobStartedJobId: jobId, providerName } as any,
    android: {
      channelId: JOB_STARTED_CHANNEL_ID,
      pressAction: { id: 'default' },
      autoCancel: true,
    },
  });
}

function openChatForJobStarted(jobId: string, providerName: string) {
  safeNavigate(() => router.push({ pathname: '/chat', params: { jobId, name: providerName } } as any));
}

const JOB_UPDATE_CHANNEL_ID = 'job_updates_v1';

/** Fired on "job_cancelled" / "job_reopened" pushes — same silent
 * data-only-push + locally-built-notification pattern as
 * showJobStartedNotification above. These two used to have no handler at
 * all here, so a tap on either just opened the app with no route to land
 * on (Expo Router's "Unmatched Route" screen) instead of navigating
 * anywhere useful. route is where tapping should land: the applicants
 * list for job_reopened (so they can pick someone else), or just the jobs
 * list for a true job_cancelled (nothing left to do on this job). */
async function showJobUpdateNotification(jobId: string, title: string, body: string, route: '/applicants' | '/my-jobs' | '/track-provider' | '/chat' | '/edit-job') {
  await notifee.createChannel({
    id: JOB_UPDATE_CHANNEL_ID,
    name: 'Service Updates',
    importance: AndroidImportance.DEFAULT,
    visibility: AndroidVisibility.PUBLIC,
  });
  await notifee.displayNotification({
    id: `job-update-${jobId}`,
    title,
    body,
    data: { jobUpdateJobId: jobId, jobUpdateRoute: route } as any,
    android: {
      channelId: JOB_UPDATE_CHANNEL_ID,
      pressAction: { id: 'default' },
      autoCancel: true,
    },
  });
}

function openJobUpdate(jobId: string, route: string) {
  safeNavigate(() => router.push({ pathname: route, params: { jobId } } as any));
}

const ADMIN_BROADCAST_CHANNEL_ID = 'admin_broadcasts_v1';

/** Fired on "admin_broadcast" pushes (admin portal's Push Notifications
 * screen) — this type had no handler at all here, same class of bug as
 * job_expired/chat_message above: every `if` in both the background and
 * foreground listener fell through, parseIncomingCall didn't match either,
 * so admin broadcasts silently never produced a visible notification —
 * they only ever showed up if the customer happened to open the in-app
 * Notifications list. No jobId involved (not job-scoped), so this doesn't
 * reuse showJobUpdateNotification/openJobUpdate — pressing it just opens
 * the Notifications list instead of deep-linking to a specific job. */
async function showAdminBroadcastNotification(title: string, body: string, imageUrl?: string) {
  await notifee.createChannel({
    id: ADMIN_BROADCAST_CHANNEL_ID,
    name: 'Announcements',
    importance: AndroidImportance.DEFAULT,
    visibility: AndroidVisibility.PUBLIC,
  });
  // notifee's Android BigPictureStyle accepts a remote HTTP(S) URL directly,
  // but iOS notification attachments do NOT — UNNotificationAttachment only
  // takes a local file path, so a raw https:// URL there silently fails to
  // attach anything. Download it to a temp file first, iOS-only (Android
  // already handles the remote URL natively, no need to pay for the
  // download twice). Wrapped so a failed download (bad URL, no network)
  // just falls back to no image instead of losing the whole notification.
  let iosImagePath: string | undefined;
  if (imageUrl && Platform.OS === 'ios') {
    try {
      const { File, Paths } = await import('expo-file-system');
      const file = await File.downloadFileAsync(imageUrl, Paths.cache);
      iosImagePath = file.uri;
    } catch (err) {
      console.warn('Failed to download admin broadcast image for iOS attachment:', err);
    }
  }
  await notifee.displayNotification({
    title,
    body,
    data: { adminBroadcast: true } as any,
    android: {
      channelId: ADMIN_BROADCAST_CHANNEL_ID,
      pressAction: { id: 'default' },
      autoCancel: true,
      ...(imageUrl ? { style: { type: AndroidStyle.BIGPICTURE, picture: imageUrl } } : {}),
    },
    ios: iosImagePath ? { attachments: [{ url: iosImagePath }] } : undefined,
  });
}

function openAdminBroadcast() {
  safeNavigate(() => router.push('/notifications' as any));
}

/** Fired on receiving a "call_cancelled" push — the caller hung up (or the
 * no-answer timeout fired) before this device answered. Only shows a missed-
 * call notice if this device was actually the one ringing for that job;
 * otherwise (e.g. the caller's own device, told to clean up after a decline
 * it already knows about) this is a harmless no-op. */
function handleCallCancelled(jobId: string, callerName: string) {
  const wasRinging = ringingJobIds.has(jobId);
  cancelIncomingCallNotification(jobId);
  if (wasRinging) {
    showMissedCallNotification(jobId, callerName);
  }
}

function parseIncomingCall(remoteData: Record<string, any> | undefined): IncomingCallData | null {
  if (!remoteData || remoteData.type !== 'incoming_call') return null;
  return { jobId: remoteData.job_id, callerId: remoteData.caller_id, callerName: remoteData.caller_name };
}

function handlePress(data: IncomingCallData, actionId: string | undefined) {
  ringingJobIds.delete(data.jobId);
  if (actionId === 'decline') {
    sendDecline(data.jobId);
  } else if (actionId === 'accept') {
    navigateToCall(data, true);
  } else {
    // Tapped the notification body itself (not a dedicated action button) —
    // just open the ringing screen and let the user explicitly decide there,
    // rather than auto-joining the call on their behalf.
    navigateToCall(data, false);
  }
}

let hangupHandler: (() => void) | null = null;
let muteHandler: (() => void) | null = null;
let speakerHandler: (() => void) | null = null;

/** Lets chat.tsx plug its own handleEndCall in while a call is connected, so
 * the ongoing-call notification's Hang Up button can actually end the call
 * instead of just opening the app. Call with null when the call ends. */
export function registerHangupHandler(fn: (() => void) | null) {
  hangupHandler = fn;
}

/** Same idea as registerHangupHandler, for the notification's Mute/Speaker
 * actions — lets pressing them from the notification toggle the same
 * in-app mute/speaker state instead of requiring the app to be open. */
export function registerMuteHandler(fn: (() => void) | null) {
  muteHandler = fn;
}

export function registerSpeakerHandler(fn: (() => void) | null) {
  speakerHandler = fn;
}

function handleNotifeeEvent(type: EventType, detail: any) {
  const missedJobId = detail.notification?.data?.missedCallJobId as string | undefined;
  if (missedJobId && (type === EventType.PRESS || type === EventType.ACTION_PRESS)) {
    openChatForMissedCall(missedJobId, (detail.notification?.data?.callerName as string) || '');
    if (detail.notification?.id) notifee.cancelNotification(detail.notification.id);
    return;
  }

  const jobStartedJobId = detail.notification?.data?.jobStartedJobId as string | undefined;
  if (jobStartedJobId && (type === EventType.PRESS || type === EventType.ACTION_PRESS)) {
    openChatForJobStarted(jobStartedJobId, (detail.notification?.data?.providerName as string) || '');
    if (detail.notification?.id) notifee.cancelNotification(detail.notification.id);
    return;
  }

  const jobUpdateJobId = detail.notification?.data?.jobUpdateJobId as string | undefined;
  if (jobUpdateJobId && (type === EventType.PRESS || type === EventType.ACTION_PRESS)) {
    const route = (detail.notification?.data?.jobUpdateRoute as string) || '/my-jobs';
    openJobUpdate(jobUpdateJobId, route);
    if (detail.notification?.id) notifee.cancelNotification(detail.notification.id);
    return;
  }

  if (detail.notification?.data?.adminBroadcast && (type === EventType.PRESS || type === EventType.ACTION_PRESS)) {
    openAdminBroadcast();
    if (detail.notification?.id) notifee.cancelNotification(detail.notification.id);
    return;
  }

  const ongoingJobId = detail.notification?.data?.ongoingCallJobId as string | undefined;
  if (ongoingJobId && (type === EventType.PRESS || type === EventType.ACTION_PRESS)) {
    const actionId = detail.pressAction?.id;
    if (actionId === 'hangup') {
      // If chat.tsx is mounted and the call is live (foreground or backgrounded-but-alive),
      // use its real handleEndCall so duration/call-log bookkeeping happens correctly.
      // Otherwise (app fully killed, this came through the background handler with no
      // registered callback) fall back to just signaling call_end directly.
      if (hangupHandler) hangupHandler();
      else sendDecline(ongoingJobId);
      if (detail.notification?.id) notifee.cancelNotification(detail.notification.id);
      return;
    }
    if (actionId === 'mute') {
      muteHandler?.();
      return;
    }
    if (actionId === 'speaker') {
      speakerHandler?.();
      return;
    }
    // Body tap on the ongoing-call notification — the call screen is still
    // mounted (it's what showed this notification in the first place) and
    // Android's own Activity-resume brings it back into view on its own; no
    // JS-side navigation needed. Falling through to the incoming-call logic
    // below would be wrong anyway: this notification's data is just
    // { ongoingCallJobId }, not the { jobId, callerId, callerName } shape
    // that expects, and would push a broken /chat with no jobId.
    return;
  }

  const data = detail.notification?.data as IncomingCallData | undefined;

  // A swipe-dismiss without ever pressing Accept/Decline must still tell the
  // caller — otherwise their "Calling…" screen just hangs forever with no signal.
  if (type === EventType.DISMISSED) {
    if (data) {
      ringingJobIds.delete(data.jobId);
      sendDecline(data.jobId);
    }
    return;
  }

  // Notifee fires DELIVERED (and other lifecycle events) the instant the
  // notification is shown — not a user action. Only PRESS/ACTION_PRESS mean
  // the user actually tapped something; anything else must be ignored, or
  // the call gets auto-accepted before the user ever sees the notification.
  if (type !== EventType.PRESS && type !== EventType.ACTION_PRESS) return;
  if (!data) return;

  handlePress(data, detail.pressAction?.id);
  if (detail.notification?.id) notifee.cancelNotification(detail.notification.id);
}

/** Call from the splash/initial route, before deciding where to send the user.
 * If the app was cold-started by tapping the incoming-call notification (not
 * just reopened normally), this handles that navigation and returns true —
 * the caller must then skip its own login/home redirect, or it'll stomp on
 * top of the call screen a few seconds later. */
export async function handleInitialNotification(): Promise<boolean> {
  try {
    const initial = await notifee.getInitialNotification();
    if (!initial) return false;
    const missedJobId = initial.notification?.data?.missedCallJobId as string | undefined;
    if (missedJobId) {
      openChatForMissedCall(missedJobId, (initial.notification?.data?.callerName as string) || '');
      if (initial.notification?.id) notifee.cancelNotification(initial.notification.id);
      return true;
    }
    const jobStartedJobId = initial.notification?.data?.jobStartedJobId as string | undefined;
    if (jobStartedJobId) {
      openChatForJobStarted(jobStartedJobId, (initial.notification?.data?.providerName as string) || '');
      if (initial.notification?.id) notifee.cancelNotification(initial.notification.id);
      return true;
    }
    const jobUpdateJobId = initial.notification?.data?.jobUpdateJobId as string | undefined;
    if (jobUpdateJobId) {
      const route = (initial.notification?.data?.jobUpdateRoute as string) || '/my-jobs';
      openJobUpdate(jobUpdateJobId, route);
      if (initial.notification?.id) notifee.cancelNotification(initial.notification.id);
      return true;
    }
    const data = initial.notification?.data as IncomingCallData | undefined;
    if (!data) return false;
    handlePress(data, initial.pressAction?.id);
    if (initial.notification?.id) notifee.cancelNotification(initial.notification.id);
    return true;
  } catch {
    return false;
  }
}

function dispatchCallAction({ action, jobId, callerName }: { action: string; jobId: string; callerName: string }) {
  const data: IncomingCallData = { jobId, callerId: '', callerName };
  if (action.endsWith('ACCEPT_CALL')) {
    navigateToCall(data, true);
  } else if (action.endsWith('DECLINE_CALL')) {
    sendDecline(jobId);
  } else if (action.endsWith('OPEN_RINGING')) {
    navigateToCall(data, false);
  }
  cancelIncomingCallNotification(jobId);
}

/** Call once from initCallManager — listens for Accept/Decline taps on the
 * native CallStyle notification while the app is already running (foreground
 * or backgrounded-but-alive). */
export function initCallActionListener() {
  callActionEmitter?.addListener('CallAction', dispatchCallAction);
  // Tells the native side it's now safe to emit live "CallAction" events
  // instead of queuing them — see the comment on CallActionModule.kt for why
  // this has to be an explicit signal rather than inferred natively.
  CallActionModule?.markReady?.();
}

/** Call from the splash/initial route alongside handleInitialNotification —
 * covers the app being cold-started by tapping the native CallStyle
 * notification specifically (a separate bridge from Notifee's own). */
export async function handleInitialCallAction(): Promise<boolean> {
  if (!CallActionModule) return false;
  try {
    const initial = await CallActionModule.getInitialAction();
    if (!initial) return false;
    dispatchCallAction(initial);
    return true;
  } catch {
    return false;
  }
}

let ongoingTimer: ReturnType<typeof setInterval> | null = null;
let resolveOngoingService: (() => void) | null = null;

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Registers the long-running task notifee keeps the process alive for while
 * the "ongoing call" notification is showing — must be called at module load,
 * same as the background message handler. */
export function registerForegroundServiceTask() {
  notifee.registerForegroundService((notification) => {
    return new Promise<void>((resolve) => {
      resolveOngoingService = resolve;
    });
  });
}

/** Starts a persistent, ticking "ongoing call" notification once a call
 * connects — backed by a real foreground service, so it (and the JS timer
 * updating it) keeps running even if the app is backgrounded or the screen
 * that started it has been torn down. Call stopOngoingCallNotification() to end it. */
// Mute/Speaker state for whatever ongoing-call notification is currently
// showing — read by the per-second render tick below, so toggling either
// from the in-app UI shows up on the notification's labels within ~1s
// without needing to force an out-of-band re-render.
let currentOngoingControls = { isMuted: false, isSpeakerOn: false };

export async function startOngoingCallNotification(jobId: string, callerName: string) {
  await notifee.createChannel({
    id: ONGOING_CALL_CHANNEL_ID,
    name: 'Ongoing Calls',
    importance: AndroidImportance.LOW,
    visibility: AndroidVisibility.PUBLIC,
  });

  const id = `ongoing-call-${jobId}`;
  const startedAt = Date.now();
  currentOngoingControls = { isMuted: false, isSpeakerOn: false };

  const render = (elapsedSeconds: number) =>
    notifee.displayNotification({
      id,
      title: `Call with ${callerName}`,
      body: `Ongoing call · ${formatElapsed(elapsedSeconds)}`,
      data: { ongoingCallJobId: jobId } as any,
      android: {
        channelId: ONGOING_CALL_CHANNEL_ID,
        asForegroundService: true,
        foregroundServiceTypes: [AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_PHONE_CALL],
        ongoing: true,
        autoCancel: false,
        pressAction: { id: 'default' },
        actions: [
          { title: currentOngoingControls.isMuted ? 'Unmute' : 'Mute', pressAction: { id: 'mute' } },
          { title: currentOngoingControls.isSpeakerOn ? 'Speaker Off' : 'Speaker', pressAction: { id: 'speaker' } },
          { title: 'Hang Up', pressAction: { id: 'hangup' } },
        ],
        importance: AndroidImportance.LOW,
        color: '#FFCE48',
      },
    });

  await render(0);

  if (ongoingTimer) clearInterval(ongoingTimer);
  ongoingTimer = setInterval(() => {
    render(Math.floor((Date.now() - startedAt) / 1000));
  }, 1000);
}

/** Call from chat.tsx whenever mute/speaker changes (from the in-app buttons
 * or from the notification's own actions) so the notification's labels stay
 * in sync with whichever side last toggled them. */
export function updateOngoingCallControls(isMuted: boolean, isSpeakerOn: boolean) {
  currentOngoingControls = { isMuted, isSpeakerOn };
}

export async function stopOngoingCallNotification(jobId: string) {
  if (ongoingTimer) { clearInterval(ongoingTimer); ongoingTimer = null; }
  // notifee.stopForegroundService() is the actual sanctioned way to tear this
  // down — just resolving the task's own Promise (the old approach here) left
  // the notification stuck on screen, which also looked like "Hang Up doesn't
  // work" even though the call itself had genuinely ended.
  try { await notifee.stopForegroundService(); } catch {}
  try { await notifee.cancelNotification(`ongoing-call-${jobId}`); } catch {}
  if (resolveOngoingService) { resolveOngoingService(); resolveOngoingService = null; }
}

let callKeepReady = false;

// Cached so logout can send it back to the backend for precise deletion —
// react-native-voip-push-notification has no synchronous getToken(), only
// the async 'register' event below, so this is the only way to have it on
// hand at logout time without re-triggering registration.
let currentVoipToken: string | null = null;
export function getCurrentVoipToken(): string | null {
  return currentVoipToken;
}

function setupCallKeepForIOS() {
  if (callKeepReady || Platform.OS !== 'ios') return;
  callKeepReady = true;

  RNCallKeep.setup({
    ios: {
      appName: 'Dodorez',
      supportsVideo: false,
      maximumCallGroups: '1',
      maximumCallsPerCallGroup: '1',
    },
    android: { alertTitle: '', alertDescription: '', cancelButton: '', okButton: '' },
  }).catch((err) => console.warn('Failed to set up CallKeep (iOS):', err));

  const activeCalls = new Map<string, IncomingCallData>();

  RNCallKeep.addEventListener('didDisplayIncomingCall', ({ callUUID, payload }: any) => {
    const call = parseIncomingCall(payload);
    if (call) activeCalls.set(callUUID, call);
  });
  RNCallKeep.addEventListener('answerCall', ({ callUUID }: any) => {
    const call = activeCalls.get(callUUID);
    if (call) navigateToCall(call, true);
    RNCallKeep.endCall(callUUID);
    activeCalls.delete(callUUID);
  });
  RNCallKeep.addEventListener('endCall', ({ callUUID }: any) => {
    const call = activeCalls.get(callUUID);
    if (call) sendDecline(call.jobId);
    activeCalls.delete(callUUID);
  });

  // PKPushRegistry lives natively (AppDelegate.swift, plugins/with-pushkit-voip.js)
  // — Apple requires the app to report every VoIP push to CallKit from
  // inside that native delegate callback, before JS can possibly react, so
  // the actual incoming-call reporting already happened by the time this
  // event fires. This listener's only job is getting the VoIP device token
  // (distinct from the regular FCM token registered below in
  // registerFcmToken — see notification_tasks.py for why the backend keeps
  // them as separate rows) to the backend so send_call_push can reach this
  // device at all.
  VoipPushNotification.addEventListener('register', (token: string) => {
    currentVoipToken = token;
    SkoFyApi.fcm.registerToken(token, 'IOS', 'VOIP').catch((err) => console.warn('registerVoipToken failed', err));
  });
  VoipPushNotification.registerVoipToken();
}

/** Must be called as early as possible (before the app's component tree even
 * mounts) so Android's headless JS can run it when the app is killed. */
export function registerBackgroundHandler() {
  messaging().setBackgroundMessageHandler(async (remoteMessage) => {
    if (remoteMessage.data?.type === 'call_cancelled') {
      handleCallCancelled(remoteMessage.data.job_id as string, (remoteMessage.data.caller_name as string) || 'them');
      return;
    }
    if (remoteMessage.data?.type === 'job_started') {
      await showJobStartedNotification(
        remoteMessage.data.job_id as string,
        (remoteMessage.data.provider_name as string) || 'Your provider',
      );
      return;
    }
    if (remoteMessage.data?.type === 'job_cancelled') {
      await showJobUpdateNotification(
        remoteMessage.data.job_id as string,
        (remoteMessage.data.title as string) || 'Job Cancelled',
        (remoteMessage.data.body as string) || 'Your job was cancelled.',
        '/my-jobs',
      );
      return;
    }
    if (remoteMessage.data?.type === 'job_reopened') {
      await showJobUpdateNotification(
        remoteMessage.data.job_id as string,
        (remoteMessage.data.title as string) || 'Provider Cancelled',
        (remoteMessage.data.body as string) || 'Other applicants are still available — pick one to continue.',
        '/applicants',
      );
      return;
    }
    if (remoteMessage.data?.type === 'new_applicant') {
      await showJobUpdateNotification(
        remoteMessage.data.job_id as string,
        (remoteMessage.data.title as string) || 'New applicant',
        (remoteMessage.data.body as string) || 'Someone applied to your job.',
        '/applicants',
      );
      return;
    }
    if (remoteMessage.data?.type === 'direct_exhausted') {
      // The shortlist ran out with nobody accepting and the job auto-
      // broadcast to everyone nearby — previously this fired silently with
      // no visible notification at all, so the customer only found out by
      // happening to reopen the Home tab.
      await showJobUpdateNotification(
        remoteMessage.data.job_id as string,
        (remoteMessage.data.title as string) || 'Direct booking declined',
        (remoteMessage.data.body as string) || "No one in your shortlist accepted — we've broadcast it to nearby providers instead.",
        '/my-jobs',
      );
      return;
    }
    if (remoteMessage.data?.type === 'direct_request_hired') {
      // The provider accepting a direct request auto-hires them now (no
      // separate View Applicants → Hire step) — job's already ACCEPTED,
      // so land on track-provider instead of applicants.
      await showJobUpdateNotification(
        remoteMessage.data.job_id as string,
        (remoteMessage.data.title as string) || 'Provider confirmed!',
        (remoteMessage.data.body as string) || "You're booked — the provider is heading your way.",
        '/track-provider',
      );
      return;
    }
    // Regression: expire_deadline_passed_jobs on the backend fires this
    // exactly like every other type here, but nothing matched it — every
    // `if` above fell through and the handler silently did nothing. No
    // visible notification, ever, when a job's deadline passed with no hire.
    if (remoteMessage.data?.type === 'job_expired') {
      await showJobUpdateNotification(
        remoteMessage.data.job_id as string,
        (remoteMessage.data.title as string) || 'Job Deadline Passed',
        (remoteMessage.data.body as string) || 'No one was hired before your scheduled time. Open the app to edit and repost it.',
        '/edit-job',
      );
      return;
    }
    // On-site inspection + invoice — all land on track-provider, where the
    // OTP card / invoice card actually render. The OTP itself deliberately
    // isn't in this notification's visible text (see request_inspection_otp
    // on the backend) — it's meant to be ephemeral, not sitting in
    // notification history forever; track-provider fetches it live instead.
    if (
      remoteMessage.data?.type === 'inspection_otp' ||
      remoteMessage.data?.type === 'inspection_started' ||
      remoteMessage.data?.type === 'invoice_raised' ||
      remoteMessage.data?.type === 'counter_accepted' ||
      remoteMessage.data?.type === 'counter_rejected'
    ) {
      await showJobUpdateNotification(
        remoteMessage.data.job_id as string,
        (remoteMessage.data.title as string) || 'Job update',
        (remoteMessage.data.body as string) || 'Open the app to see what changed.',
        '/track-provider',
      );
      return;
    }
    // Regression: ChatService.send_message on the backend fires this exactly
    // like every other type here, but no branch matched it — every `if`
    // above fell through, parseIncomingCall below only matches
    // 'incoming_call', and the handler silently did nothing. No visible
    // notification, ever, in either direction, for any chat message sent
    // while the recipient's app was backgrounded or killed.
    if (remoteMessage.data?.type === 'chat_message') {
      await showJobUpdateNotification(
        remoteMessage.data.job_id as string,
        (remoteMessage.data.title as string) || 'New message',
        (remoteMessage.data.body as string) || 'You have a new message.',
        '/chat',
      );
      return;
    }
    if (remoteMessage.data?.type === 'admin_broadcast') {
      try {
        await showAdminBroadcastNotification(
          (remoteMessage.data.title as string) || 'Announcement',
          (remoteMessage.data.body as string) || '',
          remoteMessage.data.image_url as string | undefined,
        );
      } catch (err: any) {
        // TEMP DIAGNOSTIC — see the matching note at the top of onMessage.
        Alert.alert('DEBUG: showAdminBroadcastNotification threw', String(err?.message ?? err));
      }
      return;
    }
    const call = parseIncomingCall(remoteMessage.data);
    if (call) await showIncomingCallNotification(call);
  });
  notifee.onBackgroundEvent(async ({ type, detail }) => {
    handleNotifeeEvent(type, detail);
  });
  registerForegroundServiceTask();
}

/** Call once from the root layout — sets up CallKeep (iOS) and the
 * foreground push/notification-press listeners. */
export function initCallManager() {
  setupCallKeepForIOS();
  initCallActionListener();

  // Android 13+ blocks all notifications by default until the app explicitly
  // requests this at runtime — declaring POST_NOTIFICATIONS in the manifest
  // alone isn't enough. Without this, displayNotification() silently no-ops.
  notifee.requestPermission().catch((err) => console.error('Failed to request notification permission:', err));

  messaging().onMessage(async (remoteMessage) => {
    // TEMP DIAGNOSTIC — remove once admin_broadcast delivery is confirmed
    // working. Proves whether onMessage fires at all for a given push, and
    // exactly what shape its data arrives in, without needing adb/logcat.
    Alert.alert('DEBUG: onMessage fired', JSON.stringify(remoteMessage.data ?? {}));
    if (remoteMessage.data?.type === 'call_cancelled') {
      handleCallCancelled(remoteMessage.data.job_id as string, (remoteMessage.data.caller_name as string) || 'them');
      return;
    }
    if (remoteMessage.data?.type === 'job_started') {
      await showJobStartedNotification(
        remoteMessage.data.job_id as string,
        (remoteMessage.data.provider_name as string) || 'Your provider',
      );
      return;
    }
    if (remoteMessage.data?.type === 'job_cancelled') {
      await showJobUpdateNotification(
        remoteMessage.data.job_id as string,
        (remoteMessage.data.title as string) || 'Job Cancelled',
        (remoteMessage.data.body as string) || 'Your job was cancelled.',
        '/my-jobs',
      );
      return;
    }
    if (remoteMessage.data?.type === 'job_reopened') {
      await showJobUpdateNotification(
        remoteMessage.data.job_id as string,
        (remoteMessage.data.title as string) || 'Provider Cancelled',
        (remoteMessage.data.body as string) || 'Other applicants are still available — pick one to continue.',
        '/applicants',
      );
      return;
    }
    if (remoteMessage.data?.type === 'new_applicant') {
      await showJobUpdateNotification(
        remoteMessage.data.job_id as string,
        (remoteMessage.data.title as string) || 'New applicant',
        (remoteMessage.data.body as string) || 'Someone applied to your job.',
        '/applicants',
      );
      return;
    }
    if (remoteMessage.data?.type === 'direct_exhausted') {
      await showJobUpdateNotification(
        remoteMessage.data.job_id as string,
        (remoteMessage.data.title as string) || 'Direct booking declined',
        (remoteMessage.data.body as string) || "No one in your shortlist accepted — we've broadcast it to nearby providers instead.",
        '/my-jobs',
      );
      return;
    }
    if (remoteMessage.data?.type === 'direct_request_hired') {
      await showJobUpdateNotification(
        remoteMessage.data.job_id as string,
        (remoteMessage.data.title as string) || 'Provider confirmed!',
        (remoteMessage.data.body as string) || "You're booked — the provider is heading your way.",
        '/track-provider',
      );
      return;
    }
    if (remoteMessage.data?.type === 'job_expired') {
      await showJobUpdateNotification(
        remoteMessage.data.job_id as string,
        (remoteMessage.data.title as string) || 'Job Deadline Passed',
        (remoteMessage.data.body as string) || 'No one was hired before your scheduled time. Open the app to edit and repost it.',
        '/edit-job',
      );
      return;
    }
    // On-site inspection + invoice — all land on track-provider, where the
    // OTP card / invoice card actually render. The OTP itself deliberately
    // isn't in this notification's visible text — it's meant to be
    // ephemeral, not sitting in notification history forever; track-provider
    // fetches it live instead.
    if (
      remoteMessage.data?.type === 'inspection_otp' ||
      remoteMessage.data?.type === 'inspection_started' ||
      remoteMessage.data?.type === 'invoice_raised' ||
      remoteMessage.data?.type === 'counter_accepted' ||
      remoteMessage.data?.type === 'counter_rejected'
    ) {
      await showJobUpdateNotification(
        remoteMessage.data.job_id as string,
        (remoteMessage.data.title as string) || 'Job update',
        (remoteMessage.data.body as string) || 'Open the app to see what changed.',
        '/track-provider',
      );
      return;
    }
    if (remoteMessage.data?.type === 'chat_message') {
      // Same "already looking at this exact chat" suppression as the
      // incoming-call case just below — a foreground push for a message in
      // the thread you already have open would just be a redundant duplicate
      // of what chat.tsx's own WebSocket handler already renders live.
      if (remoteMessage.data.job_id === activeChatJobId) return;
      await showJobUpdateNotification(
        remoteMessage.data.job_id as string,
        (remoteMessage.data.title as string) || 'New message',
        (remoteMessage.data.body as string) || 'You have a new message.',
        '/chat',
      );
      return;
    }
    if (remoteMessage.data?.type === 'admin_broadcast') {
      try {
        await showAdminBroadcastNotification(
          (remoteMessage.data.title as string) || 'Announcement',
          (remoteMessage.data.body as string) || '',
          remoteMessage.data.image_url as string | undefined,
        );
      } catch (err: any) {
        // TEMP DIAGNOSTIC — see the matching note at the top of onMessage.
        Alert.alert('DEBUG: showAdminBroadcastNotification threw', String(err?.message ?? err));
      }
      return;
    }
    const call = parseIncomingCall(remoteMessage.data);
    if (!call) return;
    // Already looking at this exact call's chat screen — the WS-driven
    // ringing UI is handling it, showing the notification too would just be
    // a redundant, confusing second prompt for the same call.
    if (call.jobId === activeChatJobId) return;
    await showIncomingCallNotification(call);
  });

  notifee.onForegroundEvent(({ type, detail }) => {
    handleNotifeeEvent(type, detail);
  });
}

export async function registerFcmToken() {
  try {
    const token = await messaging().getToken();
    await SkoFyApi.fcm.registerToken(token, Platform.OS === 'ios' ? 'IOS' : 'ANDROID');
  } catch (e) {
    // Non-fatal — calling still works in foreground via the WebSocket either way.
    console.warn('registerFcmToken failed', e);
  }

  // Also re-arm VoIP token registration. setupCallKeepForIOS() (called once
  // from initCallManager() at app mount, unconditionally, before auth state
  // is known) already calls VoipPushNotification.registerVoipToken() once —
  // but on a cold launch to the logged-out state, PushKit typically already
  // has a cached token and fires 'register' almost immediately, well before
  // the user finishes logging in, so that first registration call 401s
  // against the backend and is silently dropped (see its own catch). This
  // function is the one already called right after every successful login
  // (see login.tsx) with a real access token now in place — registerVoipToken()
  // is documented as safe to call repeatedly and just re-fires the same
  // cached token to the 'register' listener, which re-sends it here with
  // valid auth this time.
  if (Platform.OS === 'ios') {
    VoipPushNotification.registerVoipToken();
  }
}
