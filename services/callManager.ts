import notifee, { AndroidForegroundServiceType, AndroidImportance, AndroidStyle, AndroidVisibility, EventType } from '@notifee/react-native';
import messaging from '@react-native-firebase/messaging';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Alert, AppRegistry, AppState, Linking, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import RNCallKeep from 'react-native-callkeep';
import VoipPushNotification from 'react-native-voip-push-notification';
// LiveKit's WebRTC (our own media server): same CallKit audio-session hooks.
import { RTCAudioSession } from '@livekit/react-native-webrtc';
import { SkoFyApi, TokenStore, getFreshAccessToken } from './api';
import { AppLock } from './appLock';
import { openJobScreen } from './jobScreens';
import { isScreenInFront, openScreen } from './openScreens';

// Android-only native module (see CallStyleModule.kt/CallActionModule.kt) that
// shows the incoming-call notification using NotificationCompat.CallStyle —
// the only way to get real colored green/red Accept/Decline buttons; Notifee's
// generic notification actions can only ever render as plain text.
const { CallStyleModule, CallActionModule, CallScreenModule, OngoingCallModule } = NativeModules;
const callActionEmitter = CallActionModule ? new NativeEventEmitter(CallActionModule) : null;

// Created natively at app start (plugins/with-call-ringtone-channel.js — the
// ids must match) with the phone's own ringtone, following ring volume and
// silent/vibrate like a real call. Android fixes a channel's sound forever
// once created, so a sound change needs a new id; the createChannel() below
// is then a no-op against the native one.
const CALL_CHANNEL_ID = 'incoming_calls_v7';
const ONGOING_CALL_CHANNEL_ID = 'ongoing_calls_v1';

// The ring stops by itself even if the caller's "cancelled" push never
// arrives — it used to ring until touched. A little longer than the
// server's no-answer timeout (45s) and the apps' fallback (CALL_TIMEOUT_MS, 50s), so
// normally the caller ends it first and this is only the safety net.
const RING_TIMEOUT_MS = 55000;

interface IncomingCallData {
  jobId: string;
  callerId: string;
  callerName: string;
  /** Which call this is — the opened screen auto-answers only this one. */
  callId?: string;
  /** The caller's profile photo, for the call screens. */
  callerImage?: string;
}

// Support calls ring through this same path — full-screen call, ringtone,
// lock-screen Accept/Decline, CallKit — keyed "support:<ticket>" instead of a
// job id (backend: app/domain/support_calls.py phone_call_key). Everything
// below treats it like any call; only opening, declining and the missed-call
// tap go to the support chat instead of a job chat.
const SUPPORT_CALL_PREFIX = 'support:';

export function supportCallKey(ticketId: string): string {
  return `${SUPPORT_CALL_PREFIX}${ticketId}`;
}

export function supportTicketOf(key: string | null | undefined): string | null {
  return key && key.startsWith(SUPPORT_CALL_PREFIX) ? key.slice(SUPPORT_CALL_PREFIX.length) : null;
}

// Accept pressed for support's call: the support chat answers it — at once if
// it's open (its handler), or as soon as it opens and sees the call (the request).
let supportAnswerHandler: { ticketId: string; answer: () => void } | null = null;
let supportAnswerRequest: { ticketId: string; callId?: string; at: number } | null = null;
const SUPPORT_ANSWER_REQUEST_MS = 30000;

export function registerSupportAnswerHandler(ticketId: string | null, answer?: () => void): void {
  supportAnswerHandler = ticketId && answer ? { ticketId, answer } : null;
}

/** True (once) if Accept was pressed for this support call before its chat had it. */
export function takeSupportAnswerRequest(ticketId: string, callId: string): boolean {
  const r = supportAnswerRequest;
  if (!r || r.ticketId !== ticketId || (r.callId && r.callId !== callId) || Date.now() - r.at > SUPPORT_ANSWER_REQUEST_MS) {
    return false;
  }
  supportAnswerRequest = null;
  return true;
}

function openSupportCall(ticketId: string, callId: string | undefined, autoAnswer: boolean) {
  if (autoAnswer) {
    markAnswering();
    if (supportAnswerHandler?.ticketId === ticketId) {
      supportAnswerHandler.answer();
      return;
    }
    supportAnswerRequest = { ticketId, callId, at: Date.now() };
  }
  safeNavigate(() => openScreen('/support-chat', ticketId, { ticketId }));
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

// An accepted/tapped call whose screen can only open once the app is in the
// foreground. Opening it while the app was in the background stacked a
// hidden call screen that surfaced later — after the user had already taken
// the call another way — and tried to join a call that was over (no voice).
let pendingCall: { call: IncomingCallData; autoAnswer: boolean; at: number } | null = null;
const PENDING_CALL_MAX_AGE_MS = 30000;

AppState.addEventListener('change', (state) => {
  if (state !== 'active') return;
  if (!pendingCall) {
    // Back from settings, or a lock-screen call that came as a banner only:
    // check again whether full-screen calls are allowed.
    setTimeout(() => { checkFullScreenCallPermission().catch(() => {}); }, 1500);
    return;
  }
  const { call, autoAnswer, at } = pendingCall;
  pendingCall = null;
  if (Date.now() - at < PENDING_CALL_MAX_AGE_MS) openCallScreen(call, autoAnswer);
});

function navigateToCall(call: IncomingCallData, autoAnswer: boolean) {
  markAnswering();
  // iOS answers through CallKit, which legitimately runs the call with the
  // app in the background (e.g. answered from the lock screen) — only
  // Android's notification Accept needs to wait for the foreground.
  if (Platform.OS === 'ios' || AppState.currentState === 'active') {
    openCallScreen(call, autoAnswer);
  } else {
    pendingCall = { call, autoAnswer, at: Date.now() };
  }
}

function markAnswering() {
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
}

// Call screens already opened, by call — one Accept can reach the app by
// several routes on a cold start (the notification library's background and
// startup handlers, the native call notification, the pending call below).
// Each used to push its own copy of the call screen: one got the call, the
// other sat on "Connecting…" and came back when the user pressed back.
// By job; the same call when the ids match or either route had no id.
const openedCallScreens = new Map<string, { callId?: string; at: number }>();
const CALL_SCREEN_DEDUPE_MS = 60000;

// Accept pressed for a call whose screen is open but hasn't got the call yet
// (still fetching it): answered as soon as it arrives instead of ringing.
let acceptRequest: { jobId: string; at: number } | null = null;
const ACCEPT_REQUEST_MS = 30000;

/** True (once) if Accept was pressed for this job's call before its screen
 * had the call. Answering clears it either way. */
export function takeAcceptRequest(jobId: string): boolean {
  const req = acceptRequest;
  if (req?.jobId !== jobId) return false;
  acceptRequest = null;
  return Date.now() - req.at < ACCEPT_REQUEST_MS;
}

/** The chat screen's call is over: a call that had no id can't be told
 * apart from the next one, so forget it — the next call opens normally. */
export function forgetCallScreen(jobId: string) {
  if (!openedCallScreens.get(jobId)?.callId) openedCallScreens.delete(jobId);
}

// Calls that ended on this phone. A late route (a notification tap, the
// pending call, the native screen) must not open a screen for one of them —
// it sat on "Incoming call…" for a call that was over.
const endedCallIds = new Map<string, number>();
const ENDED_CALL_MEMORY_MS = 10 * 60 * 1000;

/** chat.tsx: this call is over on this phone. */
export function markCallEnded(callId: string | null | undefined) {
  if (!callId) return;
  const now = Date.now();
  for (const [id, at] of endedCallIds) if (now - at > ENDED_CALL_MEMORY_MS) endedCallIds.delete(id);
  endedCallIds.set(callId, now);
}

function openCallScreen(call: IncomingCallData, autoAnswer: boolean, returnOnEnd = false) {
  // Not a call (no job), or one that already ended here: nothing to open.
  if (!call.jobId || (call.callId && endedCallIds.has(call.callId))) {
    if (pendingCall?.call.jobId === call.jobId) pendingCall = null;
    return;
  }
  const supportTicket = supportTicketOf(call.jobId);
  if (supportTicket) {
    if (pendingCall?.call.jobId === call.jobId) pendingCall = null;
    openSupportCall(supportTicket, call.callId, autoAnswer);
    return;
  }
  if (autoAnswer) markAnswering();
  const now = Date.now();
  for (const [k, v] of openedCallScreens) if (now - v.at > CALL_SCREEN_DEDUPE_MS) openedCallScreens.delete(k);
  if (pendingCall?.call.jobId === call.jobId) pendingCall = null;
  const opened = openedCallScreens.get(call.jobId);
  const sameCall = !!opened && (!opened.callId || !call.callId || opened.callId === call.callId);
  // This job's chat is already on screen (ringing in place or in the call),
  // or this call's screen was just opened: answer there, never a second copy.
  if (call.jobId === activeChatJobId || sameCall) {
    if (autoAnswer) {
      acceptRequest = { jobId: call.jobId, at: now };
      acceptHandler?.();
    }
    return;
  }
  openedCallScreens.set(call.jobId, { callId: call.callId, at: now });
  safeNavigate(() => router.push({
    pathname: '/chat',
    params: {
      jobId: call.jobId,
      id: call.callerId,
      name: call.callerName,
      profession: 'Incoming Call',
      autoAnswer: autoAnswer ? 'true' : 'false',
      ...(call.callId ? { callId: call.callId } : {}),
      ...(call.callerImage ? { profileImage: call.callerImage } : {}),
      ...(returnOnEnd ? { returnOnEnd: 'true' } : {}),
    },
  } as any));
}

// Fire-and-forget: opens a short-lived socket just to relay the decline,
// since the app may not otherwise have any active connection to this job
// right now (that's exactly why we needed the push in the first place).
// With the call id, a late decline can't end a newer call on the caller's side.
async function sendDecline(jobId: string, callId?: string) {
  // Support's call: declined through its own endpoint (no job socket).
  if (supportTicketOf(jobId)) {
    if (callId) await SkoFyApi.supportCalls.end(callId).catch(() => {});
    return;
  }
  try {
    const url = await SkoFyApi.chat.getSocketUrl(jobId);
    const ws = new WebSocket(url);
    await new Promise<void>((resolve) => {
      const done = () => { try { ws.close(); } catch {} resolve(); };
      ws.onopen = async () => {
        const token = await getFreshAccessToken();
        ws.send(JSON.stringify({ type: 'auth', token }));
        ws.send(JSON.stringify({ type: 'call_end', ...(callId ? { call_id: callId } : {}) }));
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

// The one call this phone is placing — a second chat screen (two quick taps
// on a Call button on a slow network) used to place a second call.
let outgoingCallToken: string | null = null;

/** A token if no other screen is placing a call, else null. */
export function claimOutgoingCall(): string | null {
  if (outgoingCallToken) return null;
  outgoingCallToken = `${Date.now()}-${Math.random()}`;
  return outgoingCallToken;
}

export function releaseOutgoingCall(token: string | null) {
  if (token && outgoingCallToken === token) outgoingCallToken = null;
}

let lastCallTapAt = 0;
/** Call buttons that open the chat to call: ignore a repeat tap for 2s. */
export function callTapAllowed(): boolean {
  const now = Date.now();
  if (now - lastCallTapAt < 2000) return false;
  lastCallTapAt = now;
  return true;
}

/** Rings for a call shown on the app's own call screen. Android: the phone's
 * ringtone through Android's ringtone player (false if this build lacks the
 * native module — the caller falls back). */
export function startInAppRingtone(): boolean {
  if (Platform.OS !== 'android' || !CallStyleModule?.startRingtone) return false;
  CallStyleModule.startRingtone();
  return true;
}

export function stopInAppRingtone() {
  if (Platform.OS === 'android') CallStyleModule?.stopRingtone?.();
}

function reportRinging(call: IncomingCallData) {
  if (supportTicketOf(call.jobId)) return; // job calls only ("Ringing…" on the caller's screen)
  if (call.callId) SkoFyApi.calls.ringing(call.jobId, call.callId).catch(() => {});
}

async function showIncomingCallNotification(data: IncomingCallData) {
  ringingJobIds.add(data.jobId);
  reportRinging(data);
  // CallStyleModule gives real colored Accept/Decline buttons via Android's
  // native CallStyle template; falls back to Notifee's plain-action version
  // on iOS (practically unused there — iOS calls arrive via PushKit/CallKit,
  // never this path) or if the native module somehow isn't available.
  if (Platform.OS === 'android' && CallStyleModule) {
    await CallStyleModule.showIncoming(data.jobId, data.callerName, data.callerId || '', data.callId || '', data.callerImage || '');
    return;
  }
  await ensureCallChannel();
  await notifee.displayNotification({
    id: notificationIdFor(data.jobId),
    title: 'Incoming call',
    body: `${data.callerName} is calling…`,
    // Notifee accepts only string values — a call without a photo or id
    // (undefined) would make it refuse the whole notification.
    data: Object.fromEntries(Object.entries(data).filter(([, v]) => typeof v === 'string')) as any,
    android: {
      channelId: CALL_CHANNEL_ID,
      importance: AndroidImportance.HIGH,
      category: 'call' as any,
      largeIcon: require('@/assets/images/icon-mark.png'),
      circularLargeIcon: true,
      fullScreenAction: { id: 'default', launchActivity: 'default' },
      pressAction: { id: 'default', launchActivity: 'default' },
      actions: [
        { title: 'Decline', pressAction: { id: 'decline' } },
        { title: 'Accept', pressAction: { id: 'accept', launchActivity: 'default' } },
      ],
      ongoing: true,
      autoCancel: false,
      loopSound: true,
      timeoutAfter: RING_TIMEOUT_MS,
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
  endIosCallKitCalls(jobId, CXEndedReason.AnsweredElsewhere);
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

// Whether the App Lock screen is showing (AppLockGate keeps this current).
// A ringing call opens the full-screen incoming call only when it isn't —
// otherwise it rings as a notification, and answering is what unlocks.
// null until AppLockGate has decided (a cold start from a call notification
// gets here before it has) — then the App Lock setting itself decides.
let appLocked: boolean | null = null;
export function setAppLocked(locked: boolean) {
  appLocked = locked;
}

async function isAppLocked(): Promise<boolean> {
  if (appLocked !== null) return appLocked;
  try {
    return await AppLock.isEnabled();
  } catch {
    return true;
  }
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

const MISSED_CALL_CHANNEL_ID = 'missed_calls_v2';

/** One-shot "Missed call" notice — replaces the incoming-call notification
 * once the caller hangs up (or times out) before this device ever answers. */
async function showMissedCallNotification(jobId: string, callerName: string) {
  await notifee.createChannel({
    id: MISSED_CALL_CHANNEL_ID,
    name: 'Missed Calls',
    importance: AndroidImportance.HIGH,
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
  const supportTicket = supportTicketOf(jobId);
  if (supportTicket) {
    safeNavigate(() => openScreen('/support-chat', supportTicket, { ticketId: supportTicket }));
    return;
  }
  safeNavigate(() => openScreen('/chat', jobId, { jobId, name: callerName }));
}

const JOB_STARTED_CHANNEL_ID = 'job_started_v2';

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
    importance: AndroidImportance.HIGH,
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
  safeNavigate(() => openScreen('/chat', jobId, { jobId, name: providerName }));
}

const JOB_UPDATE_CHANNEL_ID = 'job_updates_v2';

/** Fired on "job_cancelled" / "job_reopened" pushes — same silent
 * data-only-push + locally-built-notification pattern as
 * showJobStartedNotification above. These two used to have no handler at
 * all here, so a tap on either just opened the app with no route to land
 * on (Expo Router's "Unmatched Route" screen) instead of navigating
 * anywhere useful. route is where tapping should land: the applicants
 * list for job_reopened (so they can pick someone else), or just the jobs
 * list for a true job_cancelled (nothing left to do on this job). */

// Chat messages get their own channel at HIGH importance — they used to go
// through the "Job Updates" channel (DEFAULT importance: no heads-up banner)
// and shared its per-job notification id, so each message silently replaced
// the last one AND earlier job alerts like "You've been hired!". One
// notification per conversation (like WhatsApp), updated per message, and
// re-alerting each time. A new channel id is required: Android never lets an
// existing channel's importance be raised after it's created.
const CHAT_MESSAGES_CHANNEL_ID = 'chat_messages_v1';

async function showChatMessageNotification(jobId: string, title: string, body: string) {
  await notifee.createChannel({
    id: CHAT_MESSAGES_CHANNEL_ID,
    name: 'Messages',
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PRIVATE,
  });
  await notifee.displayNotification({
    id: `chat-${jobId}`,
    title,
    body,
    // Same tap handling as job updates — opens this job's chat.
    data: { jobUpdateJobId: jobId, jobUpdateRoute: '/chat' },
    android: {
      channelId: CHAT_MESSAGES_CHANNEL_ID,
      pressAction: { id: 'default' },
      autoCancel: true,
      onlyAlertOnce: false,
    },
    ios: { sound: 'default' },
  });
}

type JobUpdateRoute = '/applicants' | '/my-jobs' | '/track-provider' | '/chat' | '/edit-job' | '/account-standing' | '/job-history' | '/regular-bookings';

/** Pushes that update a job the customer is following, and where a tap
 * opens — one list for the background and foreground listeners. */
const JOB_UPDATE_ROUTES: Record<string, JobUpdateRoute> = {
  inspection_otp: '/track-provider',
  inspection_started: '/track-provider',
  invoice_raised: '/track-provider',
  counter_accepted: '/track-provider',
  counter_rejected: '/track-provider',
  // Proving the inspection, and the provider at the door (MONEY_RULES_DESIGN §3–4).
  inspection_report: '/track-provider',
  provider_arrived: '/track-provider',
  // A strike from a dispute decision — where to read it and appeal (§5).
  strike: '/account-standing',
  // The provider asks to add work mid-job — approve it there (§11).
  extra_work_proposed: '/track-provider',
  // A guarantee claim moved on — the customer's history shows it (§12).
  guarantee_claim: '/job-history',
  // Repeat bookings: answered or ended, and a visit to pay for (§13).
  series_answered: '/regular-bookings',
  series_pay: '/track-provider',
  // A held visiting fee decided on the evidence, a dispute past its deadline (§5).
  visit_decided: '/track-provider',
  dispute_overdue: '/track-provider',
  // Priced up front / in care (JOB_SHAPE_DESIGN phase 4): the code to show,
  // check-in and hand-over, and each update from the provider.
  checkin_code: '/track-provider',
  delivery_code: '/track-provider',
  job_update: '/track-provider',
  care_update: '/track-provider',
  // Hired but not paid: book before the provider is freed (MONEY_RULES §14).
  booking_pay: '/track-provider',
};

async function showJobUpdateNotification(jobId: string, title: string, body: string, route: JobUpdateRoute) {
  await notifee.createChannel({
    id: JOB_UPDATE_CHANNEL_ID,
    name: 'Service Updates',
    importance: AndroidImportance.HIGH,
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
  safeNavigate(() => openJobScreen(route, jobId));
}

const ADMIN_BROADCAST_CHANNEL_ID = 'admin_broadcasts_v2';

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
    importance: AndroidImportance.HIGH,
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
    // notifee requires every data value to be a string — a boolean here made
    // displayNotification() throw, so admin broadcasts never appeared.
    data: { adminBroadcast: 'true' },
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
  safeNavigate(() => openScreen('/notifications', 'list', {}));
}

/** Fired on receiving a "call_cancelled" push — the caller hung up (or the
 * no-answer timeout fired) before this device answered. Only shows a missed-
 * call notice if this device was actually the one ringing for that job;
 * otherwise (e.g. the caller's own device, told to clean up after a decline
 * it already knows about) this is a harmless no-op. */
function handleCallCancelled(jobId: string, callerName: string) {
  if (pendingCall?.call.jobId === jobId) pendingCall = null;
  endIosCallKitCalls(jobId, CXEndedReason.RemoteEnded);
  const wasRinging = ringingJobIds.has(jobId);
  cancelIncomingCallNotification(jobId);
  if (wasRinging) {
    showMissedCallNotification(jobId, callerName);
  }
}

function parseIncomingCall(remoteData: Record<string, any> | undefined): IncomingCallData | null {
  if (!remoteData || remoteData.type !== 'incoming_call') return null;
  return {
    jobId: remoteData.job_id,
    callerId: remoteData.caller_id,
    callerName: remoteData.caller_name,
    callId: remoteData.call_id || undefined,
    callerImage: remoteData.caller_image || undefined,
  };
}

function handlePress(data: IncomingCallData, actionId: string | undefined) {
  ringingJobIds.delete(data.jobId);
  if (actionId === 'decline') {
    sendDecline(data.jobId, data.callId);
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

// The open chat screen's accept — used when the notification's Accept is
// pressed for the call that chat is already ringing for.
let acceptHandler: (() => void) | null = null;

export function registerAcceptHandler(fn: (() => void) | null) {
  acceptHandler = fn;
}

// The open chat screen's decline — used when the CallKit screen's Decline is
// pressed for the call that chat is ringing for (see showIosIncomingCall).
let declineHandler: (() => void) | null = null;

export function registerDeclineHandler(fn: (() => void) | null) {
  declineHandler = fn;
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

  const generalType = detail.notification?.data?.generalType as string | undefined;
  if (generalType && (type === EventType.PRESS || type === EventType.ACTION_PRESS)) {
    openGeneralNotification(
      generalType,
      detail.notification?.data?.ticketId as string | undefined,
      detail.notification?.data?.jobId as string | undefined,
    );
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
  // Only an incoming call's own notification reaches the call handling
  // below — anything else (no job on it) used to open an empty call screen.
  if (!data?.jobId) return;

  // A swipe-dismiss without ever pressing Accept/Decline must still tell the
  // caller — otherwise their "Calling…" screen just hangs forever with no signal.
  if (type === EventType.DISMISSED) {
    if (data) {
      ringingJobIds.delete(data.jobId);
      sendDecline(data.jobId, data.callId);
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
    // Support replies and announcements: the same as tapping one with the app
    // open. They used to fall through to the call handling below, which left
    // the splash thinking nothing had opened — Back from the support chat then
    // landed on a splash that never moved on.
    const tapped = initial.notification?.data ?? {};
    if (tapped.generalType || tapped.adminBroadcast) {
      handleNotifeeEvent(EventType.PRESS, { notification: initial.notification, pressAction: initial.pressAction });
      return true;
    }
    const data = initial.notification?.data as IncomingCallData | undefined;
    // Only an incoming call's own notification is a call (same rule as handleNotifeeEvent).
    if (!data?.jobId) return false;
    handlePress(data, initial.pressAction?.id);
    if (initial.notification?.id) notifee.cancelNotification(initial.notification.id);
    return true;
  } catch {
    return false;
  }
}

/** True if it opened the call screen (the splash route then skips its own redirect). */
async function dispatchCallAction({ action, jobId, callerName, callerId, callId, callerImage }: {
  action: string; jobId: string; callerName: string; callerId?: string; callId?: string; callerImage?: string;
}): Promise<boolean> {
  if (action.endsWith('ONGOING_HANGUP')) {
    if (hangupHandler) hangupHandler();
    else sendDecline(jobId);
    OngoingCallModule?.stop?.();
    return true;
  }
  if (action.endsWith('ONGOING_MUTE')) { muteHandler?.(); return true; }
  if (action.endsWith('ONGOING_SPEAKER')) { speakerHandler?.(); return true; }
  if (action.endsWith('ONGOING_FAILED')) {
    // The phone refused the native call service: use the previous notification.
    // Remembered too, in case this arrives before start() has resolved.
    nativeFailedJobId = jobId;
    if (nativeOngoing && ongoingCall?.jobId === jobId) {
      nativeOngoing = false;
      await renderOngoingCall(true);
    }
    return true;
  }
  const data: IncomingCallData = { jobId, callerId: callerId || '', callerName, callId: callId || undefined, callerImage: callerImage || undefined };
  if (action.endsWith('OPEN_RINGING') && await isAppLocked()) {
    // The full-screen call (locked phone) or a tap, with App Lock on: keep
    // ringing as a notification — only Answer may open the app.
    return false;
  }
  ringingJobIds.delete(jobId);
  cancelIncomingCallNotification(jobId);
  if (action.endsWith('ACCEPT_CALL')) {
    navigateToCall(data, true);
    return true;
  }
  if (action.endsWith('OPEN_RINGING')) {
    navigateToCall(data, false);
    return true;
  }
  if (action.endsWith('DECLINE_CALL')) sendDecline(jobId, callId || undefined);
  return false;
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
    return await dispatchCallAction(initial);
  } catch {
    return false;
  }
}

let resolveOngoingService: (() => void) | null = null;

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

/** `phase` 'calling' starts it the moment the caller dials ("Calling…", Hang
 * Up only) so Android doesn't pause the app while the other phone rings —
 * the callee's "send me the call again" request would otherwise go
 * unanswered. 'connected' switches it to the timer with Mute/Speaker.
 * Android only: on iOS the CallKit call is the system's call UI. */
export async function startOngoingCallNotification(jobId: string, callerName: string, phase: 'calling' | 'connected' = 'connected') {
  if (Platform.OS !== 'android') return;
  // Already showing for this call (dialing → connected): update it in place.
  // Restarting the foreground service instead — from the background, where a
  // call often connects — is something Android refuses for a microphone
  // service, and the call's audio went with it.
  if (ongoingCall?.jobId === jobId) {
    if (phase === 'connected' && ongoingCall.phase !== 'connected') {
      ongoingCall = { ...ongoingCall, phase, connectedAt: Date.now() };
      await renderOngoingCall(false);
    }
    return;
  }
  await notifee.createChannel({
    id: ONGOING_CALL_CHANNEL_ID,
    name: 'Ongoing Calls',
    importance: AndroidImportance.LOW,
    visibility: AndroidVisibility.PUBLIC,
  });
  currentOngoingControls = { isMuted: false, isSpeakerOn: false };
  ongoingCall = { jobId, callerName, phase, connectedAt: phase === 'connected' ? Date.now() : null };
  // Android's call-style notification on a native phone-call service — what
  // puts the green call chip in the status bar, like WhatsApp. Notifee can't
  // build that style, so it's only the fallback now.
  if (OngoingCallModule) {
    nativeFailedJobId = null;
    nativeOngoing = await OngoingCallModule.start(
      jobId, callerName, phase === 'connected', ongoingCall.connectedAt ?? 0,
    ).catch(() => false);
    if (nativeOngoing && nativeFailedJobId !== jobId) return;
    nativeOngoing = false;
  }
  // Started once, while the app is on screen (dialing or answering).
  await renderOngoingCall(true);
}

// The call shown in the ongoing-call notification. Its timer is Android's own
// chronometer — no per-second re-render, which restarted the foreground
// service every second.
let ongoingCall: { jobId: string; callerName: string; phase: 'calling' | 'connected'; connectedAt: number | null } | null = null;
// True while the native call-style notification is the one showing.
let nativeOngoing = false;
// The call whose native service the phone refused (see ONGOING_FAILED).
let nativeFailedJobId: string | null = null;

async function renderOngoingCall(startService: boolean) {
  const call = ongoingCall;
  if (!call) return;
  const connected = call.phase === 'connected';
  if (nativeOngoing) {
    OngoingCallModule.update(
      connected, call.connectedAt ?? 0, currentOngoingControls.isMuted, currentOngoingControls.isSpeakerOn,
    );
    return;
  }
  try {
    await notifee.displayNotification({
      id: `ongoing-call-${call.jobId}`,
      title: `Call with ${call.callerName}`,
      body: connected ? 'Ongoing call' : 'Calling…',
      data: { ongoingCallJobId: call.jobId } as any,
      android: {
        channelId: ONGOING_CALL_CHANNEL_ID,
        // Only the first display starts the service; later ones update the
        // same notification, which keeps the service running.
        asForegroundService: startService,
        // Microphone too: Android silences the mic of an app in the
        // background unless its foreground service declares it — the other
        // person heard nothing until the app was reopened.
        foregroundServiceTypes: startService ? [
          AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_PHONE_CALL,
          AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MICROPHONE,
        ] : undefined,
        ongoing: true,
        autoCancel: false,
        onlyAlertOnce: true,
        ...(connected && call.connectedAt ? { showChronometer: true, timestamp: call.connectedAt } : {}),
        pressAction: { id: 'default', launchActivity: 'default' },
        actions: connected
          ? [
            { title: currentOngoingControls.isMuted ? 'Unmute' : 'Mute', pressAction: { id: 'mute' } },
            { title: currentOngoingControls.isSpeakerOn ? 'Speaker Off' : 'Speaker', pressAction: { id: 'speaker' } },
            { title: 'Hang Up', pressAction: { id: 'hangup' } },
          ]
          : [{ title: 'Hang Up', pressAction: { id: 'hangup' } }],
        importance: AndroidImportance.LOW,
        color: '#FFCE48',
      },
    });
  } catch (err) {
    console.warn('Ongoing call notification failed:', err);
  }
}

/** Call from chat.tsx whenever mute/speaker changes (from the in-app buttons
 * or from the notification's own actions) so the notification's labels stay
 * in sync with whichever side last toggled them. */
export function updateOngoingCallControls(isMuted: boolean, isSpeakerOn: boolean) {
  if (currentOngoingControls.isMuted === isMuted && currentOngoingControls.isSpeakerOn === isSpeakerOn) return;
  currentOngoingControls = { isMuted, isSpeakerOn };
  // The Mute/Speaker labels change now — they used to wait for the next
  // once-a-second re-render.
  if (ongoingCall?.phase === 'connected') renderOngoingCall(false);
}

export async function stopOngoingCallNotification(jobId: string) {
  if (nativeOngoing && (!ongoingCall || ongoingCall.jobId === jobId)) {
    OngoingCallModule?.stop?.();
    nativeOngoing = false;
  }
  if (ongoingCall?.jobId === jobId) ongoingCall = null;
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

// CallKit's CXCallEndedReason values.
const CXEndedReason = { Failed: 1, RemoteEnded: 2, Unanswered: 3, AnsweredElsewhere: 4 } as const;
// Matches the caller's own no-answer timeout (CALL_TIMEOUT_MS in chat.tsx).
const IOS_UNANSWERED_TIMEOUT_MS = 60000;

// iOS incoming calls currently showing on the CallKit screen, by CallKit UUID.
const iosCallKitCalls = new Map<string, { call: IncomingCallData; timer: ReturnType<typeof setTimeout> }>();

function takeIosCallKitCall(callUUID: string) {
  const entry = iosCallKitCalls.get(callUUID);
  if (!entry) return undefined;
  clearTimeout(entry.timer);
  iosCallKitCalls.delete(callUUID);
  return entry;
}

/** Stops the CallKit ringing screen for this job's call (the caller hung up). */
function endIosCallKitCalls(jobId: string, reason: number) {
  if (Platform.OS !== 'ios') return;
  for (const [callUUID, { call }] of [...iosCallKitCalls]) {
    if (call.jobId !== jobId) continue;
    takeIosCallKitCall(callUUID);
    RNCallKeep.reportEndCallWithUUID(callUUID, reason);
  }
}

// The call CallKit is showing for the call in progress — kept for the whole
// call, not ended on answer: ending it straight away made iOS shut the call's
// audio session, so a call answered from the lock screen had no audio.
let iosCallSession: { uuid: string; jobId: string; outgoing: boolean } | null = null;

function newCallUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** iOS: rings a call that arrived over the open chat's socket through
 * CallKit, so it uses the iPhone's own ringtone — iOS doesn't let an app
 * read or play the ringtone the user picked. Answer/Decline on that screen
 * go back to the open chat (acceptHandler / declineHandler). False on Android
 * or if CallKit isn't set up — the caller then rings in-app instead. */
export function showIosIncomingCall(call: IncomingCallData): boolean {
  if (Platform.OS !== 'ios' || !callKeepReady) return false;
  const uuid = newCallUuid();
  const timer = setTimeout(() => {
    if (iosCallKitCalls.delete(uuid)) RNCallKeep.reportEndCallWithUUID(uuid, CXEndedReason.Unanswered);
  }, IOS_UNANSWERED_TIMEOUT_MS);
  iosCallKitCalls.set(uuid, { call, timer });
  RNCallKeep.displayIncomingCall(uuid, call.callerName, call.callerName, 'generic', false);
  return true;
}

/** The open chat's Accept, while CallKit is also ringing for this job:
 * answer through CallKit so it keeps holding the call (audio keeps flowing
 * if the phone is then locked). Its 'answerCall' event comes back to the
 * chat's accept handler, which then finds no ring left and answers. True if
 * it handed the answer to CallKit — the caller must stop there. */
export function answerIosRing(jobId: string): boolean {
  if (Platform.OS !== 'ios') return false;
  for (const [uuid, { call }] of iosCallKitCalls) {
    if (call.jobId !== jobId) continue;
    RNCallKeep.answerIncomingCall(uuid);
    return true;
  }
  return false;
}

/** The caller hung up while CallKit was ringing for it — stop that ring
 * only (not the Android notification or other jobs' rings). */
export function endIosRingForHangUp(jobId: string) {
  endIosCallKitCalls(jobId, CXEndedReason.RemoteEnded);
}

/** Reports the caller's own outgoing call to CallKit — the system then knows
 * a call is in progress (green status bar, a cellular call goes to hold). */
export function startIosOutgoingCall(jobId: string, calleeName: string) {
  if (Platform.OS !== 'ios' || !callKeepReady) return;
  const uuid = newCallUuid();
  iosCallSession = { uuid, jobId, outgoing: true };
  RNCallKeep.startCall(uuid, calleeName, calleeName, 'generic', false);
}

export function markIosCallConnected(jobId: string) {
  if (Platform.OS !== 'ios' || iosCallSession?.jobId !== jobId) return;
  if (iosCallSession.outgoing) RNCallKeep.reportConnectedOutgoingCallWithUUID(iosCallSession.uuid);
}

/** Call when the call ends in the app — closes the CallKit call too. */
export function endIosCallSession(jobId: string) {
  if (Platform.OS !== 'ios' || iosCallSession?.jobId !== jobId) return;
  const { uuid } = iosCallSession;
  iosCallSession = null; // first, so the 'endCall' event this triggers is ignored
  RNCallKeep.endCall(uuid);
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

  RNCallKeep.addEventListener('didDisplayIncomingCall', async ({ callUUID, payload }: any) => {
    const call = parseIncomingCall(payload);
    if (!call) return;
    // Apple requires every VoIP push to show as a call; for a logged-out
    // phone, end it at once.
    if (!(await hasSession())) {
      RNCallKeep.reportEndCallWithUUID(callUUID, CXEndedReason.Failed);
      return;
    }
    // AppDelegate must report every VoIP push to CallKit, even for a call
    // this job's open chat is already ringing for in-app — end that
    // duplicate straight away instead of showing two incoming-call screens.
    const supportTicket = supportTicketOf(call.jobId);
    const ringingInOpenSupportChat = !!supportTicket && AppState.currentState === 'active'
      && isScreenInFront('/support-chat', supportTicket);
    if (call.jobId === activeChatJobId || ringingInOpenSupportChat) {
      RNCallKeep.reportEndCallWithUUID(callUUID, CXEndedReason.AnsweredElsewhere);
      return;
    }
    // CallKit never stops ringing on its own, and the caller's hang-up may
    // not reach a backgrounded app — give up when the caller's side does.
    const timer = setTimeout(() => {
      if (iosCallKitCalls.delete(callUUID)) RNCallKeep.reportEndCallWithUUID(callUUID, CXEndedReason.Unanswered);
    }, IOS_UNANSWERED_TIMEOUT_MS);
    iosCallKitCalls.set(callUUID, { call, timer });
    reportRinging(call);
  });
  RNCallKeep.addEventListener('answerCall', ({ callUUID }: any) => {
    const entry = takeIosCallKitCall(callUUID);
    if (!entry) { RNCallKeep.endCall(callUUID); return; }
    iosCallSession = { uuid: callUUID, jobId: entry.call.jobId, outgoing: false };
    navigateToCall(entry.call, true);
  });
  RNCallKeep.addEventListener('endCall', ({ callUUID }: any) => {
    // Declined on the CallKit ringing screen.
    const entry = takeIosCallKitCall(callUUID);
    if (entry) {
      // Ringing in the open chat: decline there, so it hangs up its own call.
      if (entry.call.jobId === activeChatJobId && declineHandler) declineHandler();
      else sendDecline(entry.call.jobId, entry.call.callId);
      return;
    }
    // Hung up from the system call UI (lock screen, Dynamic Island) during
    // the call — end it in the app too.
    const session = iosCallSession;
    if (session && session.uuid === callUUID) {
      const { jobId } = session;
      iosCallSession = null;
      if (hangupHandler) hangupHandler();
      else if (declineHandler) declineHandler(); // still connecting in the open chat
      else sendDecline(jobId);
    }
  });
  // CallKit owns the audio session during a call: hand it to WebRTC when the
  // system activates it, and take it back when it's released.
  RNCallKeep.addEventListener('didActivateAudioSession', () => RTCAudioSession.audioSessionDidActivate());
  RNCallKeep.addEventListener('didDeactivateAudioSession', () => RTCAudioSession.audioSessionDidDeactivate());
  RNCallKeep.addEventListener('didPerformSetMutedCallAction', ({ muted, callUUID }: any) => {
    if (iosCallSession?.uuid === callUUID && muted !== currentOngoingControls.isMuted) muteHandler?.();
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

/** Decline pressed on the native call notification while the app isn't
 * running — CallActionReceiver starts this as a headless JS task. */
export function registerCallDeclineTask() {
  AppRegistry.registerHeadlessTask('DodorezCallDecline', () => async (data: any) => {
    if (data?.jobId) await sendDecline(data.jobId, data.callId || undefined);
  });
}

/** Must be called as early as possible (before the app's component tree even
 * mounts) so Android's headless JS can run it when the app is killed. */
// Any push the app has no special handling for — a support reply, a pickup
// code, a job status change — still shows as a normal pop-up notification.
// Unhandled types used to be dropped silently: these pushes are data-only,
// so nothing appears unless the app shows it itself.
/** Support stopped ringing (answered, ended, missed): its "is calling"
 * notification goes from the tray (same id showGeneralNotification gives it). */
export function dismissSupportCallNotification(ticketId: string): void {
  notifee.cancelNotification(`general-support_call-${ticketId}`).catch(() => {});
  cancelIncomingCallNotification(supportCallKey(ticketId)); // the native ringing screen / CallKit
}

async function showGeneralNotification(data: Record<string, any> | undefined) {
  const type = String(data?.type ?? 'general');
  // Support's call stopped ringing unanswered (silent message): clear its notification.
  if (type === 'support_call_over') {
    if (data?.ticket_id) dismissSupportCallNotification(String(data.ticket_id));
    return;
  }
  const title = data?.title as string | undefined;
  const body = data?.body as string | undefined;
  if (!title || !body) return;
  // Support calling while that ticket's chat is on screen: it rings right there.
  if (type === 'support_call' && isScreenInFront('/support-chat', data?.ticket_id as string | undefined)) return;
  const key = (data?.ticket_id as string) || (data?.job_id as string) || String(Date.now());
  await notifee.createChannel({
    id: JOB_UPDATE_CHANNEL_ID,
    name: 'Service Updates',
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PUBLIC,
  });
  await notifee.displayNotification({
    id: `general-${type}-${key}`,
    title,
    body,
    data: {
      generalType: type,
      ...(data?.ticket_id ? { ticketId: String(data.ticket_id) } : {}),
      ...(data?.job_id ? { jobId: String(data.job_id) } : {}),
    } as any,
    android: {
      channelId: JOB_UPDATE_CHANNEL_ID,
      pressAction: { id: 'default' },
      autoCancel: true,
    },
  });
}

/** A tapped notification opens what it's about: the support conversation, or
 * the job's own screen — the Notifications list only when it's about neither. */
function openGeneralNotification(type: string, ticketId?: string, jobId?: string) {
  // A support reply, or support calling: that ticket's chat (where the call rings).
  if (type === 'support_ticket' || type === 'support_call') {
    safeNavigate(() => (ticketId ? openScreen('/support-chat', ticketId, { ticketId }) : router.push('/support-chat' as any)));
    return;
  }
  if (jobId) {
    safeNavigate(() => openJobScreen('/track-provider', jobId));
    return;
  }
  safeNavigate(() => openScreen('/notifications', 'list', {}));
}

// Android never lets an app raise a channel's importance once it exists on a
// phone, so the quiet ones are replaced by new high-importance channels.
const RETIRED_CHANNEL_IDS = ['missed_calls_v1', 'job_started_v1', 'job_updates_v1', 'admin_broadcasts_v1'];

// ── Signing this phone out of push ──────────────────────────────────────────
// A logged-out phone used to keep ringing: logout only asked the server to
// forget the token, and if that request failed (no network, an expired
// login) or the session simply expired, the token stayed registered.

/** False only when the phone definitely has no login. A failed read counts as
 * logged in, so a storage hiccup can never silence a real call. */
async function hasSession(): Promise<boolean> {
  try {
    return !!(await TokenStore.getAccessToken()) || !!(await TokenStore.getRefreshToken());
  } catch {
    return true;
  }
}

/** Stops any ringing, removes every notification, and has Firebase forget
 * this phone's push token — after that no push can reach it, whatever the
 * server still holds. Login registers a fresh token. */
export async function clearPushForSignOut(): Promise<void> {
  pendingCall = null;
  for (const jobId of Array.from(ringingJobIds)) cancelIncomingCallNotification(jobId);
  if (Platform.OS === 'android') {
    CallStyleModule?.cancelAll?.();
    OngoingCallModule?.stop?.();
  }
  nativeOngoing = false;
  ongoingCall = null;
  stopInAppRingtone();
  await notifee.cancelAllNotifications().catch(() => {});
  await notifee.stopForegroundService().catch(() => {});
  await messaging().deleteToken().catch((err) => console.warn('FCM deleteToken failed', err));
}

/** Logout: the server drops this phone's tokens and the login, then the
 * phone clears its own push state — either alone is enough to stop calls. */
export async function signOutDevice(): Promise<void> {
  const fcmToken = await messaging().getToken().catch(() => undefined);
  const voipToken = getCurrentVoipToken() ?? undefined;
  await SkoFyApi.auth.logout(fcmToken, voipToken).catch((err) => {
    console.error('Server-side logout failed:', err);
  });
  await clearPushForSignOut();
}

export function registerBackgroundHandler() {
  messaging().setBackgroundMessageHandler(async (remoteMessage) => {
    // Nobody logged in: never ring or notify, and stop this token for good.
    if (!(await hasSession())) {
      await messaging().deleteToken().catch(() => {});
      return;
    }
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
    const updateRoute = JOB_UPDATE_ROUTES[remoteMessage.data?.type as string];
    if (updateRoute) {
      await showJobUpdateNotification(
        (remoteMessage.data?.job_id as string) || '',
        (remoteMessage.data?.title as string) || 'Job update',
        (remoteMessage.data?.body as string) || 'Open the app to see what changed.',
        updateRoute,
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
      await showChatMessageNotification(
        remoteMessage.data.job_id as string,
        (remoteMessage.data.title as string) || 'New message',
        (remoteMessage.data.body as string) || 'You have a new message.',
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
      } catch (err) {
        console.error('Failed to show admin broadcast notification:', err);
      }
      return;
    }
    const call = parseIncomingCall(remoteMessage.data);
    if (call) {
      await showIncomingCallNotification(call);
      return;
    }
    await showGeneralNotification(remoteMessage.data);
  });
  notifee.onBackgroundEvent(async ({ type, detail }) => {
    handleNotifeeEvent(type, detail);
  });
  registerForegroundServiceTask();
}

const FULL_SCREEN_PROMPTED_KEY = 'dodorez_full_screen_calls_prompted_at';
// Once a day while it's off: a week was too long — tapping "Not now" once
// left a Samsung ringing as a banner only, with nothing to explain why.
const FULL_SCREEN_REPROMPT_MS = 24 * 60 * 60 * 1000;

/** Android 14+ doesn't let apps that aren't dialers show a full-screen call
 * over the lock screen until the user turns it on — without it an incoming
 * call is only a small banner. Samsung often has it off for apps installed
 * outside the Play Store. Checked on launch and whenever the app comes back
 * to the front; asks at most once a day, never during a call. */
async function checkFullScreenCallPermission(): Promise<boolean> {
  if (Platform.OS !== 'android' || !CallScreenModule) return false;
  if (pendingCall || ongoingCall || isAnsweringCall || chatCallActive) return false;
  try {
    if (await CallScreenModule.canUseFullScreenIntent()) return false;
    const last = Number(await SecureStore.getItemAsync(FULL_SCREEN_PROMPTED_KEY)) || 0;
    if (Date.now() - last < FULL_SCREEN_REPROMPT_MS) return false;
    await SecureStore.setItemAsync(FULL_SCREEN_PROMPTED_KEY, String(Date.now()));
    Alert.alert(
      'Show calls on your lock screen',
      "Calls to Dodorez only show as a small notification while your phone is locked. Turn on \u201cFull screen notifications\u201d (\u201cAllow full screen notifications\u201d on Samsung) so they ring like a phone call.",
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: () => CallScreenModule.openFullScreenIntentSettings() },
      ],
    );
    return true;
  } catch (err) {
    console.warn('Full-screen call permission check failed:', err);
    return false;
  }
}

// Phone makers whose settings stop a call from showing on the lock screen,
// or from ringing at all with the app closed, until the user allows it —
// WhatsApp is allowed by default there, other apps aren't.
const STRICT_MAKERS = ['xiaomi', 'redmi', 'poco', 'oppo', 'realme', 'oneplus', 'vivo', 'iqoo', 'huawei', 'honor'];
const MAKER_PROMPTED_KEY = 'dodorez_maker_call_settings_prompted';

/** Once per install, on those phones: where to allow calls to ring and show. */
async function checkMakerCallSettings() {
  if (Platform.OS !== 'android') return;
  const maker = String((Platform.constants as any)?.Manufacturer ?? '').toLowerCase();
  if (!STRICT_MAKERS.some((name) => maker.includes(name))) return;
  try {
    if (await SecureStore.getItemAsync(MAKER_PROMPTED_KEY)) return;
    await SecureStore.setItemAsync(MAKER_PROMPTED_KEY, String(Date.now()));
    Alert.alert(
      'Let calls ring when your phone is locked',
      'This phone limits apps by default. In Dodorez’s settings, turn on “Show on lock screen”, “Pop-up windows” (or “Display over other apps”) and “Auto-start”, and set battery to “No restrictions”.',
      [
        { text: 'Later', style: 'cancel' },
        { text: 'Open settings', onPress: () => Linking.openSettings() },
      ],
    );
  } catch (err) {
    console.warn('Call settings prompt failed:', err);
  }
}

/** Call once from the root layout — sets up CallKeep (iOS) and the
 * foreground push/notification-press listeners. */
export function initCallManager() {
  setupCallKeepForIOS();
  if (Platform.OS === 'android') {
    RETIRED_CHANNEL_IDS.forEach((id) => { notifee.deleteChannel(id).catch(() => {}); });
  }
  initCallActionListener();
  // One prompt per launch at most.
  checkFullScreenCallPermission().then((asked) => { if (!asked) checkMakerCallSettings(); });

  // Android 13+ blocks all notifications by default until the app explicitly
  // requests this at runtime — declaring POST_NOTIFICATIONS in the manifest
  // alone isn't enough. Without this, displayNotification() silently no-ops.
  notifee.requestPermission().catch((err) => console.error('Failed to request notification permission:', err));

  messaging().onMessage(async (remoteMessage) => {
    if (!(await hasSession())) return;
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
    const updateRoute = JOB_UPDATE_ROUTES[remoteMessage.data?.type as string];
    if (updateRoute) {
      await showJobUpdateNotification(
        (remoteMessage.data?.job_id as string) || '',
        (remoteMessage.data?.title as string) || 'Job update',
        (remoteMessage.data?.body as string) || 'Open the app to see what changed.',
        updateRoute,
      );
      return;
    }
    if (remoteMessage.data?.type === 'chat_message') {
      // Same "already looking at this exact chat" suppression as the
      // incoming-call case just below — a foreground push for a message in
      // the thread you already have open would just be a redundant duplicate
      // of what chat.tsx's own WebSocket handler already renders live.
      if (remoteMessage.data.job_id === activeChatJobId) return;
      await showChatMessageNotification(
        remoteMessage.data.job_id as string,
        (remoteMessage.data.title as string) || 'New message',
        (remoteMessage.data.body as string) || 'You have a new message.',
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
      } catch (err) {
        console.error('Failed to show admin broadcast notification:', err);
      }
      return;
    }
    const call = parseIncomingCall(remoteMessage.data);
    if (!call) {
      await showGeneralNotification(remoteMessage.data);
      return;
    }
    // Already looking at this exact call's chat screen — the WS-driven
    // ringing UI is handling it, showing the notification too would just be
    // a redundant, confusing second prompt for the same call.
    if (call.jobId === activeChatJobId) return;
    const supportTicket = supportTicketOf(call.jobId);
    if (supportTicket && isScreenInFront('/support-chat', supportTicket)) return;
    // App open on another screen: show the full-screen incoming call right
    // away, like a phone call — it used to be only a small banner. It rings
    // in-app once the screen has fetched the call (call_ready).
    if (Platform.OS === 'android' && AppState.currentState === 'active' && appLocked === false && !isCallScreenActive()) {
      openCallScreen(call, false, true);
      return;
    }
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
