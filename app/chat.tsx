import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Image } from 'expo-image';
import NetInfo from '@react-native-community/netinfo';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  CheckCheck,
  ChevronLeft,
  MapPin,
  Phone,
  Send,
  Star,
  XCircle
} from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, Keyboard, Linking, Modal, Platform, ScrollView, StyleSheet, TouchableOpacity, Vibration, View } from 'react-native';
import { Text, TextInput } from '@/components/scaled-text';
// The keyboard-controller version: works with KeyboardProvider (app/_layout.tsx)
// on Android — React Native's own one shifted the layout as the keyboard
// closed, so a tap meant for a button could miss it.
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useAppAlert } from '@/components/app-alert';
import Animated, { FadeInLeft, FadeInRight } from 'react-native-reanimated';
import { Audio } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isRatingSkipped, markRatingSkipped, markRatingSubmitted } from '@/services/ratingReminders';
import { SkoFyApi, TokenStore, getFreshAccessToken } from '@/services/api';
// The call's audio — through our own media server (docs/CALL_RECORDING_DESIGN.md).
import { CallMedia, CallMediaEnded } from '@/services/call/callMedia';
import type { TransportEvent } from '@/services/call/mediaTransport';
import { CallOverlay } from '@/components/call-overlay';
import InCallManager from 'react-native-incall-manager';
import { answerIosRing, claimOutgoingCall, markCallEnded, releaseOutgoingCall, startInAppRingtone, stopInAppRingtone, cancelIncomingCallNotification, endIosCallSession, forgetCallScreen, takeAcceptRequest, endIosRingForHangUp, markIosCallConnected, registerAcceptHandler, registerDeclineHandler, showIosIncomingCall, registerHangupHandler, registerMuteHandler, registerSpeakerHandler, setActiveChatJob, setChatCallActive, startIosOutgoingCall, startOngoingCallNotification, stopOngoingCallNotification, updateOngoingCallControls } from '@/services/callManager';
import { useOpenScreen } from '@/services/openScreens';

// No-answer cutoff — like a real phone call, ringing/calling shouldn't go on forever.
// The server ends an unanswered call after 45s and says why; this is only
// the fallback if that message never arrives.
const CALL_TIMEOUT_MS = 50000;
// How long "Declined" / "Busy" / "No answer" stays on screen.
const ENDED_SCREEN_MS = 1800;

// Matches the backend's default page size — used to tell whether a fetched
// page was "full" (there might be more behind it) or "short" (it's the end).
const MESSAGE_PAGE_SIZE = 50;

// Cutoff for the 'connecting' placeholder shown when this screen was opened
// via a notification action. Without this, a lost call_ready/resend round
// trip (caller already gave up, transient network blip, etc.) left the user
// stuck on "Connecting…" forever with no offer ever arriving and no way out
// (the back button is intentionally blocked while a call is active).
const CONNECTING_TIMEOUT_MS = 15000;
// How often "Connecting…" asks the caller again for the call (call_ready).
const CALL_READY_RETRY_MS = 3000;
// A dropped connection (often a Wi-Fi ↔ mobile switch) is restored by the
// media transport; it gets this long to come back before the call ends.
const DISCONNECT_GRACE_MS = 30000;

const newCallId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// Vibration alongside the real ringtone/ringback audio (belt-and-suspenders —
// some devices' media volume is down even when ringer isn't).
const RING_PATTERN = [0, 1000, 1000];

interface ChatMessage {
  id: string;
  sender_id: string;
  receiver_id: string;
  message: string;
  message_type?: string;
  sent_at: string;
}

function formatCallLogDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type CallState = 'idle' | 'connecting' | 'calling' | 'ringing' | 'connected' | 'ended';

// Chat and calls are open only while the job is being done — the server
// enforces the same rule (domain/job_contact.py). History stays readable.
const CONTACT_OPEN_STATUSES = new Set(['ACCEPTED', 'INSPECTING', 'INVOICE_PENDING', 'IN_PROGRESS']);
const CLOSED_TEXT = "This job is closed. Chat and calls are only available while a job is active — use Book again to work together again.";

/** What the caller sees when the other side didn't pick up. */
function endedLabelFor(reason: string | undefined, state: CallState): string | null {
  if (state !== 'calling') return null;
  if (reason === 'busy') return 'On another call';
  if (reason === 'declined') return 'Declined';
  if (reason === 'no_answer') return 'No answer';
  if (reason === 'job_closed') return 'This job is closed';
  return null;
}

export default function ChatScreen() {
  const { jobId, id, name: paramName, profileImage: paramProfileImage, profession: paramProfession, autoAnswer, autoCall, callId: callIdParam, returnOnEnd } = useLocalSearchParams<{
    jobId: string;
    id: string;
    name: string;
    profileImage: string;
    profession: string;
    autoAnswer?: string;
    callId?: string;
    returnOnEnd?: string;
    autoCall?: string;
  }>();
  // A tapped notification for this chat comes back here instead of opening a copy.
  useOpenScreen('/chat', jobId, useLocalSearchParams());
  // Notification-tap navigation (notifications.tsx) only passes jobId, not
  // name/profileImage/profession — without this the header name rendered
  // blank (no fallback at all) and call-log entries read "them called you"
  // instead of the actual provider's name. Backfilled here so every entry
  // point into this screen ends up correct, not just the ones that
  // remember to pass these params.
  const [name, setName] = useState(paramName || '');
  const [profileImage, setProfileImage] = useState(paramProfileImage || '');
  const [profession, setProfession] = useState(paramProfession || '');
  useEffect(() => {
    // The photo too: a call screen opened from a notification has the name
    // but often no photo.
    if ((paramName && paramProfession && paramProfileImage) || !jobId) return;
    SkoFyApi.jobs.get(jobId).then((job: any) => {
      const provider = job?.assigned_provider;
      if (!provider) return;
      if (!paramName && provider.name) setName(provider.name);
      if (!paramProfession && provider.profession) setProfession(provider.profession);
      if (!paramProfileImage && provider.profile_image_url) setProfileImage(provider.profile_image_url);
    }).catch(() => {});
  }, [jobId, paramName, paramProfession, paramProfileImage]);

  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const insets = useSafeAreaInsets();
  const appAlert = useAppAlert();
  const [inputText, setInputText] = useState('');
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const myUserIdRef = useRef<string | null>(null);
  useEffect(() => { myUserIdRef.current = myUserId; }, [myUserId]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isOtherOnline, setIsOtherOnline] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // onContentSizeChange fires for both "new message appended at the bottom"
  // (should scroll to end) and "older page prepended at the top" (should NOT
  // — maintainVisibleContentPosition already keeps the view stable, and
  // scrolling to end would yank the user back down right after they
  // scrolled up to load history). This ref tells the handler which case it is.
  const isPrependingRef = useRef(false);

  // Voice call state — signaling rides over the same job WebSocket as chat.
  // When opened via any incoming-call notification action (autoAnswer param
  // present at all — 'true' for Accept, 'false' for tapping the notification
  // body to just open the ringing screen) start in 'connecting' rather than
  // 'idle' so the full-screen call overlay covers the screen from the very
  // first render. Checking the param's *presence*, not just whether it's
  // 'true', matters: normal chat-opening never sets this param, but tapping
  // the notification body sets it to 'false' — checking only for 'true' left
  // that path showing the plain chat UI until the real call_offer arrived.
  const [callState, setCallState] = useState<CallState>(autoAnswer !== undefined ? 'connecting' : 'idle');
  // The WS onmessage handler is set up in an effect keyed only on [jobId], so
  // it only ever sees callState as it was on that first render — never the
  // current value. Without this ref, a duplicate/stray call_offer arriving
  // mid-call (e.g. from a reconnect re-triggering the call_ready handshake)
  // had no way to be recognized as "already in a call" and got processed as
  // a brand-new incoming call, disrupting the active one.
  const callStateRef = useRef<CallState>(callState);
  useEffect(() => { callStateRef.current = callState; }, [callState]);
  // The socket handler below is an effect keyed only on [jobId] — calling
  // handleAcceptCall directly from it would use the function (and the state
  // it closes over) from the render that set the handler up.
  const handleAcceptCallRef = useRef<() => void>(() => {});
  const handleDeclineCallRef = useRef<(reason?: string) => void>(() => {});
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  // The call's audio through our media server (services/call/callMedia.ts).
  const callMediaRef = useRef<CallMedia>(new CallMedia());
  // The call is being recorded — the screen shows the notice.
  const [recorded, setRecorded] = useState(false);
  // Answered (either side), audio still connecting: the overlay shows the
  // in-call "Connecting…" rather than an unanswered call.
  const [answered, setAnswered] = useState(false);
  // The incoming call being offered (who from), until answered or declined.
  const incomingOfferRef = useRef<{ from?: string } | null>(null);
  // Our outgoing call, not yet answered — offered again if the callee's app asks (call_ready).
  const outgoingCallRef = useRef(false);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoAnswerSentRef = useRef(false);
  const autoCallSentRef = useRef(false);
  // Identifies the current call in every signal (sendSignal adds it), so a
  // message from an earlier call — a late call_end, a call_ready from a
  // screen opened for a call that's already over, an old ICE candidate — is
  // ignored instead of ending, answering or re-ringing the current one.
  const callIdRef = useRef<string | null>(autoAnswer !== undefined ? (callIdParam ?? null) : null);
  // The notification's Accept answers ONE call — the one it was pressed for.
  // Read straight from the route param, it stayed 'true' for the screen's
  // whole life and every later call into this chat was answered automatically.
  const autoAnswerPendingRef = useRef(autoAnswer === 'true');
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ringtoneSoundRef = useRef<Audio.Sound | null>(null);
  const callTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // handleEndCall is redefined every render and reads callDuration/callState by
  // closure — but it gets invoked from the WS onmessage handler, which is set up
  // in an effect keyed only on [jobId] and so only ever sees the first render's
  // version. Dereferencing through this ref (kept current below) instead of
  // calling handleEndCall directly avoids logging a stale duration/connected state.
  const handleEndCallRef = useRef<(reason?: string) => void>(() => {});
  // Same staleness concern as handleEndCallRef above, for the notification's
  // Mute/Speaker actions.
  const toggleMuteRef = useRef<() => void>(() => {});
  const toggleSpeakerRef = useRef<() => void>(() => {});
  // callState !== 'idle' alone isn't a reliable re-entry guard for
  // handleStartCall: React state updates aren't visible until the next
  // render, so two taps fired close enough together (faster than a
  // re-render, e.g. an accidental double-tap) both see the same stale
  // 'idle' value and both place a call. This ref is updated synchronously.
  const callActionInFlightRef = useRef(false);
  // null until loaded — treated as open meanwhile (the server still checks).
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const contactOpen = jobStatus === null || CONTACT_OPEN_STATUSES.has(jobStatus);
  const refreshJobStatusRef = useRef<() => void>(() => {});
  // "Ringing…" on the caller's screen once the other phone reports it.
  const [remoteRinging, setRemoteRinging] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const reconnectingRef = useRef(false);
  const [endedLabel, setEndedLabel] = useState('');
  const endedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasConnectedRef = useRef(false);
  const outgoingClaimRef = useRef<string | null>(null);
  // Set while answering — a second copy of the call's offer is ignored.
  const answeringRef = useRef(false);
  const callReadyTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Rating modal — shown once per session when opening a COMPLETED job chat
  const [ratingVisible, setRatingVisible] = useState(false);
  const [ratings, setRatings] = useState({ behaviour: 0, skill: 0, punctuality: 0, communication: 0 });
  const [ratingComment, setRatingComment] = useState('');
  const [ratingSubmitting, setRatingSubmitting] = useState(false);

  // The other person's presence in the call's room (see onMediaEvent).
  const peerPresentRef = useRef(false);
  const peerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPeerTimer = () => {
    if (peerTimerRef.current) { clearTimeout(peerTimerRef.current); peerTimerRef.current = null; }
  };

  const clearDisconnectTimer = () => {
    if (disconnectTimerRef.current) { clearTimeout(disconnectTimerRef.current); disconnectTimerRef.current = null; }
  };

  const clearCallTimeout = () => {
    if (callTimeoutRef.current) { clearTimeout(callTimeoutRef.current); callTimeoutRef.current = null; }
  };

  useEffect(() => {
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: true }).catch((err) => {
      console.warn('Failed to set audio mode:', err);
    });
  }, []);

  // Lets the foreground push handler know this exact call is already being
  // handled by the in-app ringing UI, so it doesn't ALSO show the incoming-
  // call notification on top of it.
  //
  // Focus, not mount: another screen pushed on top (e.g. the map) keeps this
  // one mounted, and a mount-based flag kept treating the chat as "open" —
  // silently swallowing every message/call notification for this job while
  // the user was actually looking at something else.
  const [socketOpen, setSocketOpen] = useState(false);

  // Only while this screen's socket is actually connected: being the active
  // chat makes callManager skip the incoming-call notification, trusting
  // this socket to ring instead. With the socket down, that skipped the only
  // ring the user would have got.
  useFocusEffect(
    useCallback(() => {
      if (jobId && socketOpen) setActiveChatJob(jobId);
      registerAcceptHandler(() => handleAcceptCallRef.current());
      registerDeclineHandler(() => handleDeclineCallRef.current());
      return () => {
        setActiveChatJob(null);
        registerAcceptHandler(null);
        registerDeclineHandler(null);
      };
    }, [jobId, socketOpen])
  );

  // Opened from a call notification: give up if the call never arrives — the
  // timer used to start only once the socket opened, so a screen opened for
  // a call that had already ended could sit on "Connecting…" indefinitely.
  useEffect(() => {
    if (autoAnswer === undefined) return;
    const timer = setTimeout(() => {
      if (callStateRef.current === 'connecting' && !answeringRef.current) handleDeclineCallRef.current();
    }, CONNECTING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  // Leaving this screen mid-call must end the call for both people — not
  // leave the microphone and connection running with no screen to hang up
  // from. Declared before the socket effect so call_end is sent before the
  // socket closes (effect cleanups run in declaration order).
  useEffect(() => () => {
    if (callStateRef.current !== 'idle') handleEndCallRef.current();
    // Left while the call was still being set up (before 'calling'): the
    // one-call-at-a-time claim must not outlive this screen, or no call
    // could be placed again until the app restarted.
    releaseOutgoingCall(outgoingClaimRef.current);
  }, []);

  // AppLockGate must only skip re-locking (or force-dismiss an existing
  // lock) while an actual call is ringing/connecting/connected here — not
  // for every ordinary chat screen open, which is what activeChatJobId
  // above tracks. See setChatCallActive's own comment in callManager.ts.
  useEffect(() => {
    setChatCallActive(callState !== 'idle');
    return () => setChatCallActive(false);
  }, [callState]);

  // Pressing back while a call is ringing/connecting/active doesn't actually
  // unmount this screen — React Navigation just parks it in the stack — so
  // the ringtone/vibration cleanup never runs and the Accept/Decline UI is
  // gone with no way back to it, leaving the call ringing forever with no
  // way to answer or hang up. A real phone's incoming-call screen doesn't let
  // you back out of it either — force Accept/Decline/End instead.
  useEffect(() => {
    if (callState === 'idle') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [callState]);

  const playLoopingSound = async (ref: React.MutableRefObject<Audio.Sound | null>, asset: any) => {
    try {
      const { sound } = await Audio.Sound.createAsync(asset, { isLooping: true, volume: 1.0 });
      ref.current = sound;
      await sound.playAsync();
    } catch (err) {
      console.warn('Failed to play sound:', err);
    }
  };

  const stopSound = async (ref: React.MutableRefObject<Audio.Sound | null>) => {
    const sound = ref.current;
    ref.current = null;
    if (!sound) return;
    try {
      await sound.stopAsync();
      await sound.unloadAsync();
    } catch (err) {
      console.warn('Failed to stop sound:', err);
    }
  };

  /** False (nothing sent) while the socket is down or reconnecting. */
  const sendSignal = (payload: any): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ ...payload, call_id: payload.call_id ?? callIdRef.current }));
    return true;
  };

  const cleanupCall = () => {
    Vibration.cancel();
    InCallManager.stopRingtone();
    stopInAppRingtone();
    InCallManager.stopRingback();
    stopSound(ringtoneSoundRef);
    InCallManager.stop();
    clearCallTimeout();
    clearDisconnectTimer();
    callActionInFlightRef.current = false;
    answeringRef.current = false;
    releaseOutgoingCall(outgoingClaimRef.current);
    outgoingClaimRef.current = null;
    markCallEnded(callIdRef.current);
    callIdRef.current = null;
    autoAnswerPendingRef.current = false;
    if (endedTimerRef.current) { clearTimeout(endedTimerRef.current); endedTimerRef.current = null; }
    if (callReadyTimerRef.current) { clearInterval(callReadyTimerRef.current); callReadyTimerRef.current = null; }
    setRemoteRinging(false);
    setReconnecting(false);
    reconnectingRef.current = false;
    if (jobId) stopOngoingCallNotification(jobId);
    if (jobId) endIosCallSession(jobId);
    if (jobId) forgetCallScreen(jobId);
    registerHangupHandler(null);
    registerMuteHandler(null);
    registerSpeakerHandler(null);
    if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null; }
    callMediaRef.current.end();
    clearPeerTimer();
    peerPresentRef.current = false;
    incomingOfferRef.current = null;
    outgoingCallRef.current = false;
    setRecorded(false);
    setAnswered(false);
    autoAnswerSentRef.current = false;
    setIsMuted(false);
    setIsSpeakerOn(false);
    setCallDuration(0);
    setCallState('idle');
  };

  // The transport restores a dropped network itself; the call ends only if
  // it can't come back within the grace period (call_end tells the other phone).
  const onMediaEvent = (event: TransportEvent) => {
    if (event === 'peerJoined') {
      peerPresentRef.current = true;
      clearPeerTimer();
      if (!reconnectingRef.current) setReconnecting(false);
    } else if (event === 'peerLeft' || (event === 'connected' && !peerPresentRef.current)) {
      // The other person isn't in the room — not joined yet, or their app is
      // gone (crash, dead battery). Our own connection is fine, so nothing
      // else would ever end this call: give them the grace period.
      peerPresentRef.current = false;
      if (event === 'peerLeft') setReconnecting(true);
      if (!peerTimerRef.current) {
        peerTimerRef.current = setTimeout(() => handleEndCallRef.current(), DISCONNECT_GRACE_MS);
      }
    }
    if (event === 'connected' || event === 'reconnected') {
      clearDisconnectTimer();
      reconnectingRef.current = false;
      if (peerPresentRef.current) setReconnecting(false);
    } else if (event === 'reconnecting') {
      reconnectingRef.current = true;
      setReconnecting(true);
      if (!disconnectTimerRef.current) {
        disconnectTimerRef.current = setTimeout(() => handleEndCallRef.current(), DISCONNECT_GRACE_MS);
      }
    } else if (event === 'disconnected') {
      handleEndCallRef.current();
    }
  };

  /** Both sides, once the call is answered: join its audio on our media server. */
  const connectMedia = async () => {
    const callId = callIdRef.current;
    if (!callId) throw new Error('No call to connect');
    // The ringing phase used InCallManager; LiveKit's audio session takes over now.
    InCallManager.stop();
    const access = await callMediaRef.current.connect(callId, onMediaEvent);
    if (callIdRef.current !== callId) return; // ended while connecting
    setRecorded(access.recorded);
    wasConnectedRef.current = true;
    callStateRef.current = 'connected';
    setCallState('connected');
    if (jobId) startOngoingCallNotification(jobId, name || 'Provider');
    if (jobId) markIosCallConnected(jobId);
    registerHangupHandler(() => handleEndCallRef.current());
    registerMuteHandler(() => toggleMuteRef.current());
    registerSpeakerHandler(() => toggleSpeakerRef.current());
  };

  /** Shows the recording notice before answering, and makes answering faster. */
  const prepareMedia = (callId: string | null) => {
    if (!callId) return;
    callMediaRef.current.prepare(callId)
      .then(access => { if (callIdRef.current === callId) setRecorded(access.recorded); })
      .catch(() => { /* fetched again on connect */ });
  };

  const handleStartCall = async () => {
    if (!jobId || callState !== 'idle' || callActionInFlightRef.current) return;
    if (!contactOpen) {
      appAlert.show('info', 'Job closed', CLOSED_TEXT);
      return;
    }
    // The offer travels over the socket — without it the other phone never
    // hears about the call, so don't play ringback to nobody.
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      appAlert.show('info', 'Not connected', "You're offline right now. Check your internet and try again in a moment.");
      return;
    }
    // Another screen (a second copy of this chat) is already placing a call.
    const claim = claimOutgoingCall();
    if (!claim) return;
    outgoingClaimRef.current = claim;
    callActionInFlightRef.current = true;
    if (endedTimerRef.current) { clearTimeout(endedTimerRef.current); endedTimerRef.current = null; }
    wasConnectedRef.current = false;
    setRemoteRinging(false);
    callIdRef.current = newCallId();
    try {
      // The microphone is needed once answered — ask now, not mid-call.
      const mic = await Audio.requestPermissionsAsync();
      if (!mic.granted) throw new Error('Microphone permission denied');
      InCallManager.start({ media: 'audio' });
      outgoingCallRef.current = true;
      // No audio details: the call's audio connects through our media server once answered.
      sendSignal({ type: 'call_offer', media: 'sfu' });
      prepareMedia(callIdRef.current);
      setCallState('calling');
      // Now, not after the next render: the server's "busy" can arrive first.
      callStateRef.current = 'calling';
      // Ringback through the call's own audio route (it used to play as
      // media, quiet or from the wrong speaker once the phone was in call mode).
      InCallManager.startRingback('_DTMF_');
      // From the moment of dialing, not on connect: keeps Android from
      // pausing the app while the other phone rings, so the callee's
      // call_ready ("send me the call again") is still answered.
      if (jobId) startOngoingCallNotification(jobId, name || 'Provider', 'calling');
      registerHangupHandler(() => handleEndCallRef.current());
      if (jobId) startIosOutgoingCall(jobId, name || 'Provider');
      clearCallTimeout();
      callTimeoutRef.current = setTimeout(() => handleEndCallRef.current('no_answer'), CALL_TIMEOUT_MS);
    } catch (err) {
      console.error('Failed to start call:', err);
      // Used to just say "check app permissions" with no way to act on it —
      // if the mic permission was denied (especially permanently, after
      // repeated testing), the only path forward is Settings, so give a
      // direct way there instead of leaving the user to find it themselves.
      appAlert.show('error', 'Call Failed', "Could not access the microphone. Enable microphone access for Dodorez in your phone's settings and try again.", [
        { text: 'Cancel', variant: 'secondary' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]);
      cleanupCall();
    }
  };

  const handleAcceptCall = async () => {
    const offer = incomingOfferRef.current;
    if (!offer || answeringRef.current) return;
    if (jobId && answerIosRing(jobId)) return; // comes back here once CallKit has answered
    answeringRef.current = true;
    if (jobId) takeAcceptRequest(jobId);
    autoAnswerPendingRef.current = false;
    wasConnectedRef.current = true;
    Vibration.cancel();
    InCallManager.stopRingtone();
    stopInAppRingtone();
    stopSound(ringtoneSoundRef);
    clearCallTimeout();
    // Safety net: answering in-app should always dismiss a matching incoming-
    // call notification, even if the activeChatJobId suppression in
    // callManager.ts didn't catch it (e.g. a push that slipped in before the
    // mount effect ran).
    if (jobId) cancelIncomingCallNotification(jobId);
    try {
      const mic = await Audio.requestPermissionsAsync();
      if (!mic.granted) throw new Error('Microphone permission denied');
      // Answered first (the caller and the recorder start at once), then the audio.
      sendSignal({ type: 'call_answer' });
      setAnswered(true);
      callStateRef.current = 'connecting';
      setCallState('connecting');
      await connectMedia();
    } catch (err) {
      if (err instanceof CallMediaEnded) return;
      console.error('Failed to answer call:', err);
      appAlert.show('error', 'Call Failed', "Could not answer the call. Enable microphone access for Dodorez in your phone's settings and try again.", [
        { text: 'Cancel', variant: 'secondary' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]);
      sendSignal({ type: 'call_end' });
      cleanupCall();
    }
  };

  // reason: 'no_answer' when it's our own ring timeout, not a decline. Typed
  // loosely because the overlay's buttons pass their press event here.
  const handleDeclineCall = (reason?: unknown) => {
    clearCallTimeout();
    if (jobId) cancelIncomingCallNotification(jobId);
    sendSignal({ type: 'call_end', ...(typeof reason === 'string' ? { reason } : {}) });
    cleanupCall();
  };

  const refreshJobStatus = () => {
    if (!jobId) return;
    SkoFyApi.jobs.get(jobId)
      .then((job: any) => { if (job?.status) setJobStatus(job.status); })
      // No longer part of this job (e.g. it reopened to another provider).
      .catch((err: any) => { if (err?.error_code === 'FORBIDDEN') setJobStatus('CLOSED'); });
  };
  refreshJobStatusRef.current = refreshJobStatus;
  useEffect(() => { refreshJobStatus(); }, [jobId]);

  const handleEndCall = (reason?: unknown) => {
    clearCallTimeout();
    sendSignal({ type: 'call_end', ...(typeof reason === 'string' ? { reason } : {}) });
    cleanupCall();
  };
  handleEndCallRef.current = handleEndCall;

  // Opened automatically for an incoming call from another screen: an
  // unanswered call goes back to where the user was.
  const prevCallStateRef = useRef<CallState>(callState);
  useEffect(() => {
    const prev = prevCallStateRef.current;
    prevCallStateRef.current = callState;
    // Opened for a call (a notification, or automatically): when the call is
    // over, go back to where the user was — like a phone call. An unanswered
    // auto-opened one too. Cold-started into it (nothing behind): stay here.
    const openedForCall = autoAnswer !== undefined || returnOnEnd === 'true';
    if (openedForCall && callState === 'idle' && prev !== 'idle' && router.canGoBack()) {
      router.back();
    }
  }, [callState]);

  const toggleMute = () => {
    const next = !isMuted;
    callMediaRef.current.setMuted(next).catch(() => {});
    setIsMuted(next);
  };
  toggleMuteRef.current = toggleMute;

  const toggleSpeaker = () => {
    const next = !isSpeakerOn;
    callMediaRef.current.setSpeaker(next).catch(() => {});
    setIsSpeakerOn(next);
  };
  toggleSpeakerRef.current = toggleSpeaker;

  // Keeps the ongoing-call notification's Mute/Speaker labels in sync,
  // whichever side (in-app buttons or the notification's own actions) last
  // toggled them.
  useEffect(() => {
    if (callState === 'connected') updateOngoingCallControls(isMuted, isSpeakerOn);
  }, [isMuted, isSpeakerOn, callState]);

  useEffect(() => {
    if (callState !== 'connected') return;
    callTimerRef.current = setInterval(() => setCallDuration(d => d + 1), 1000);
    return () => { if (callTimerRef.current) clearInterval(callTimerRef.current); };
  }, [callState]);

  useEffect(() => () => cleanupCall(), []);

  handleAcceptCallRef.current = handleAcceptCall;
  handleDeclineCallRef.current = handleDeclineCall;

  useEffect(() => {
    TokenStore.getUser().then(u => setMyUserId(u?.user_id ?? null));
  }, []);

  useEffect(() => {
    if (!jobId) return;
    SkoFyApi.chat.getMessages(jobId).then((msgs: any) => {
      if (Array.isArray(msgs)) {
        setMessages(msgs);
        setHasMoreMessages(msgs.length === MESSAGE_PAGE_SIZE);
      }
    }).catch((err) => {
      console.error('Failed to fetch chat history:', err);
    });
    // Show rating modal if this is a completed job the customer hasn't rated yet
    SkoFyApi.ratingStatus.get(jobId).then(s => {
      // Not if they chose "Maybe later" this session — same rule as the home-screen reminder.
      if (!s.customer_has_rated && !isRatingSkipped(jobId)) setRatingVisible(true);
    }).catch(() => {});

    let socket: WebSocket | null = null;
    // Reconnects with backoff (1s→30s): a socket dropped by a network blip or
    // an expired token used to stay dead until the screen was reopened — no
    // chat updates and no calls in either direction in the meantime.
    let closedByScreen = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 1000;
    const scheduleReconnect = () => {
      if (closedByScreen) return;
      // During a call the socket carries the connection restart: no long backoff.
      reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, callStateRef.current === 'idle' ? reconnectDelay : Math.min(reconnectDelay, 2000));
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    };
    // Token fetched up front (in parallel with the URL) so onopen below can
    // send it synchronously — no await inside onopen. sendSignal (used for
    // mute/end-call/etc, triggerable straight from the UI) has no readiness
    // gate of its own, so any async gap between "socket is OPEN" and "auth
    // message actually sent" is a real window for a user tap to jump the
    // queue ahead of auth and get the connection rejected by the server.
    // Only the latest attempt may open a socket — an older one still
    // fetching its URL when a newer one started would open a second socket
    // (every message handled twice).
    let attempt = 0;
    const connect = () => { const mine = ++attempt; return Promise.all([SkoFyApi.chat.getSocketUrl(jobId), getFreshAccessToken()]).then(([url, token]) => {
      if (closedByScreen || mine !== attempt) return;
      const ws = new WebSocket(url);
      socket = ws;
      wsRef.current = ws;
      ws.onclose = (event) => {
        if (wsRef.current === ws) wsRef.current = null;
        setSocketOpen(false);
        setIsOtherOnline(false);
        // 4403/4404: not a party to this job / no such job — retrying can't help.
        // 4401: the server closed it because this account signed in on another
        // phone (or the login expired). Ask once: signed out → the app's
        // "Signed Out" flow takes over; still signed in → reconnect as usual.
        if (event.code === 4401) {
          SkoFyApi.auth.checkSession()
            .then(() => scheduleReconnect())
            .catch((err: any) => { if (err?.error_code !== 'SESSION_EXPIRED') scheduleReconnect(); });
          return;
        }
        if (event.code !== 4403 && event.code !== 4404) scheduleReconnect();
      };
      ws.onopen = () => {
        // Must be the first message — the server holds the connection
        // unauthenticated until this arrives (see ws.py).
        ws.send(JSON.stringify({ type: 'auth', token }));
        reconnectDelay = 1000;
        setSocketOpen(true);
        // autoAnswer being set AT ALL (true or false) means this screen was
        // opened via a call notification action — the original offer was
        // sent while we had no socket listening, so it was lost; the caller
        // needs to resend it regardless of whether we'll auto-answer or show
        // the full ringing UI first. Gating this on === 'true' only (the old
        // bug) meant tapping the notification body (autoAnswer 'false', meant
        // to show Accept/Decline) never asked for a resend at all — the
        // screen was stuck on "Connecting…" forever since no offer would
        // ever arrive.
        if (autoAnswer !== undefined && !autoAnswerSentRef.current) {
          autoAnswerSentRef.current = true;
          sendSignal({ type: 'call_ready' });
          // Asked again every few seconds: a caller whose app was briefly
          // paused, or whose socket was reconnecting, missed a single ask and
          // this screen sat on "Connecting…".
          if (callReadyTimerRef.current) clearInterval(callReadyTimerRef.current);
          callReadyTimerRef.current = setInterval(() => {
            if (callStateRef.current !== 'connecting' || incomingOfferRef.current || answeringRef.current) {
              if (callReadyTimerRef.current) clearInterval(callReadyTimerRef.current);
              callReadyTimerRef.current = null;
              return;
            }
            sendSignal({ type: 'call_ready' });
          }, CALL_READY_RETRY_MS);
          clearCallTimeout();
          callTimeoutRef.current = setTimeout(() => {
            if (callStateRef.current === 'connecting' && !answeringRef.current) handleDeclineCall();
          }, CONNECTING_TIMEOUT_MS);
        }
        // Tapping a phone icon elsewhere in the app (e.g. the tracking screen's
        // call button) used to open the device's native dialer with the
        // provider's raw phone number instead of starting an in-app VoIP call —
        // autoCall navigates here and starts the call once the socket needed
        // to send the offer is actually open.
        if (autoCall === 'true' && !autoCallSentRef.current) {
          autoCallSentRef.current = true;
          handleStartCall();
        }
      };
      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'chat_message') {
            setMessages(prev => [...prev, data.payload]);
            if (data.payload?.message_type === 'SYSTEM') refreshJobStatusRef.current();
            return;
          }
          if (data.type === 'call_offer') {
            const curState = callStateRef.current;
            // Already ringing, answering or connected — ignore duplicates/stray offers.
            if (curState === 'ringing' || curState === 'connected' || answeringRef.current) return;
            // Opened from a notification: auto-answer only the call that
            // notification was for (no id from an older backend: accept it).
            const expectedCallId = curState === 'connecting' ? callIdRef.current : null;
            const isNotifiedCall = !expectedCallId || !data.call_id || data.call_id === expectedCallId;
            // Simultaneous call: both sides sent an offer at the same time.
            // Resolve with a deterministic tiebreaker — lower user_id becomes
            // the callee and accepts the other's offer; higher user_id stays
            // as caller and waits for its own offer to be answered. The side
            // that yields answers at once instead of ringing: its user just
            // tapped Call themselves, so both people want to talk.
            let yieldedToTheirCall = false;
            if (curState === 'calling') {
              const myId = myUserIdRef.current;
              const theirId = data.from as string | undefined;
              if (!myId || !theirId || myId >= theirId) return;
              // We have the lower ID — become callee: drop our outgoing call
              outgoingCallRef.current = false;
              InCallManager.stopRingback();
              clearCallTimeout();
              callActionInFlightRef.current = false;
              yieldedToTheirCall = true;
            }
            if (endedTimerRef.current) { clearTimeout(endedTimerRef.current); endedTimerRef.current = null; }
            incomingOfferRef.current = { from: data.from };
            callIdRef.current = data.call_id ?? null;
            prepareMedia(callIdRef.current);
            const acceptPressed = autoAnswerPendingRef.current || (!!jobId && takeAcceptRequest(jobId));
            if ((acceptPressed && isNotifiedCall) || yieldedToTheirCall) {
              handleAcceptCallRef.current();
            } else {
              callStateRef.current = 'ringing';
              setCallState('ringing');
              // InCallManager.startRingtone plays on the actual ring audio
              // stream (same as the native notification's RingtoneManager
              // sound) so it respects the ring volume slider and is audible
              // even when media volume is muted/low — expo-av's Audio.Sound
              // (used previously) plays on the media stream, which is why
              // the in-app ring was silent while the notification's wasn't.
              // The phone's own ringtone: on Android '_DEFAULT_' is the ringtone
              // set for normal calls; on iOS only CallKit can play the user's
              // ringtone, so the call rings there.
              const ringingOnCallKit = showIosIncomingCall({
                jobId, callerId: data.from ?? '', callerName: paramName || 'Your provider', callId: data.call_id ?? undefined,
              });
              // Android: the phone's ringtone via Android's own player (the
              // library's player was silent on phones with a custom ringtone).
              if (!ringingOnCallKit && !startInAppRingtone()) InCallManager.startRingtone('_DEFAULT_', RING_PATTERN);
              sendSignal({ type: 'call_ring' });
              wasConnectedRef.current = false;
              clearCallTimeout();
              callTimeoutRef.current = setTimeout(() => handleDeclineCallRef.current('no_answer'), CALL_TIMEOUT_MS);
            }
            return;
          }
          // Every other call signal must belong to the current call.
          const isOtherCall = !!data.call_id && data.call_id !== callIdRef.current;
          if (data.type === 'call_answer') {
            if (isOtherCall || !outgoingCallRef.current) return;
            outgoingCallRef.current = false;
            InCallManager.stopRingback();
            clearCallTimeout();
            setAnswered(true);
            callStateRef.current = 'connecting';
            setCallState('connecting');
            try {
              await connectMedia();
            } catch (err) {
              if (err instanceof CallMediaEnded) return;
              console.error('Failed to connect the call:', err);
              appAlert.show('error', 'Call Failed', "Couldn't connect the call. Check your internet and try again.");
              handleEndCallRef.current();
            }
            return;
          }
          if (data.type === 'call_ring') {
            if (!isOtherCall && callStateRef.current === 'calling') {
              setRemoteRinging(true);
              // The pass fetched on dialing can beat the offer to the server;
              // the call surely exists now, so the recording notice shows while ringing.
              prepareMedia(callIdRef.current);
            }
            return;
          }
          if (data.type === 'call_ready') {
            if (outgoingCallRef.current && !isOtherCall) sendSignal({ type: 'call_offer', media: 'sfu' });
            return;
          }
          if (data.type === 'call_end') {
            if (isOtherCall) return;
            if (jobId) endIosRingForHangUp(jobId);
            const label = endedLabelFor(data.reason, callStateRef.current);
            cleanupCall();
            if (label) {
              setEndedLabel(label);
              setCallState('ended');
              endedTimerRef.current = setTimeout(() => { endedTimerRef.current = null; setCallState('idle'); }, ENDED_SCREEN_MS);
            }
            return;
          }
          if (data.type === 'job_status') {
            // The job just changed (completed, disputed…) — a closed job's
            // chat and calls shut at once.
            if (typeof data.status === 'string') setJobStatus(data.status);
            return;
          }
          if (data.type === 'presence_update') {
            setIsOtherOnline(!!data.online);
            return;
          }
        } catch (err) {
          console.error('Failed to handle WS message:', err);
        }
      };
    }).catch(() => { if (mine === attempt) scheduleReconnect(); }); };
    connect();

    // Network back: reconnect now instead of waiting out the backoff (it
    // grows to 30s — a call lost to a short network drop waited too long).
    // Back online, or moved to another network: the old socket is dead,
    // though it can take a long time to say so — start a new one now.
    let lastNetwork: string | null = null;
    const unsubscribeNet = NetInfo.addEventListener(state => {
      const network = state.isConnected ? `on:${state.type}` : 'off';
      const changed = lastNetwork !== null && network !== lastNetwork;
      lastNetwork = network;
      if (closedByScreen || !changed || !state.isConnected) return;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      const old = socket;
      socket = null;
      if (old) {
        old.onclose = null;
        old.onmessage = null;
        old.close();
        if (wsRef.current === old) wsRef.current = null;
      }
      setSocketOpen(false);
      reconnectDelay = 1000;
      connect();
    });

    return () => {
      closedByScreen = true;
      unsubscribeNet();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
      wsRef.current = null;
      setSocketOpen(false);
      // Our own socket is what tells us whether the other party is online —
      // once it's gone we can no longer know that, so don't keep showing a
      // (possibly stale) green dot.
      setIsOtherOnline(false);
    };
  }, [jobId]);

  const loadMoreMessages = async () => {
    if (!jobId || !hasMoreMessages || isLoadingMore || messages.length === 0) return;
    setIsLoadingMore(true);
    try {
      const oldest = messages[0];
      const older: any = await SkoFyApi.chat.getMessages(jobId, oldest.sent_at);
      if (Array.isArray(older) && older.length > 0) {
        isPrependingRef.current = true;
        setMessages(prev => [...older, ...prev]);
        setHasMoreMessages(older.length === MESSAGE_PAGE_SIZE);
      } else {
        setHasMoreMessages(false);
      }
    } catch (err) {
      console.error('Failed to load older messages:', err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleSendMessage = async () => {
    const text = inputText.trim();
    if (text === '' || !jobId) return;
    setInputText('');
    Keyboard.dismiss();
    try {
      const sent: any = await SkoFyApi.chat.send(jobId, text);
      setMessages(prev => [...prev, sent]);
    } catch (err) {
      console.error('Failed to send chat message:', err);
      // Restore what they typed instead of losing it — silently clearing on
      // failure meant a dropped network request looked identical to a
      // successful send, with no way to tell the message never went anywhere.
      setInputText(text);
      if ((err as any)?.error_code === 'JOB_CLOSED' || (err as any)?.error_code === 'FORBIDDEN') {
        refreshJobStatus();
        return;
      }
      appAlert.show('error', 'Message Not Sent', 'Check your connection and try again.');
    }
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    if (item.message_type === 'SYSTEM') {
      let log: { event?: string; duration_seconds?: number; connected?: boolean; reason?: string; outcome?: string } = {};
      try { log = JSON.parse(item.message); } catch {}
      const isMine = item.sender_id === myUserId;
      const otherName = name || 'them';
      let label = 'Voice call';
      let LogIcon = Phone;
      if (log.event === 'call') {
        // Written by the server, one per call; the sender is the caller.
        if (log.outcome === 'completed') label = `Voice call · ${formatCallLogDuration(log.duration_seconds ?? 0)}`;
        else if (log.outcome === 'declined') label = isMine ? `${otherName} declined your call` : `You declined a call from ${otherName}`;
        else if (log.outcome === 'busy') label = isMine ? `${otherName} was on another call` : `Missed call from ${otherName}`;
        else if (log.outcome === 'cancelled') label = isMine ? 'Call cancelled' : `Missed call from ${otherName}`;
        else label = isMine ? `${otherName} didn't answer` : `Missed call from ${otherName}`;
      } else if (log.event === 'call_started') {
        label = isMine ? `You called ${otherName}` : `${otherName} called you`;
      } else if (log.event === 'call_ended') {
        label = log.connected
          ? `Voice call · ${formatCallLogDuration(log.duration_seconds ?? 0)}`
          : `Missed call from ${otherName}`;
      } else if (log.event === 'job_started') {
        LogIcon = MapPin;
        label = isMine ? 'You arrived and started the job' : `${otherName} arrived and started the job`;
      } else if (log.event === 'job_cancelled') {
        LogIcon = XCircle;
        label = isMine
          ? `You cancelled the job${log.reason ? `: ${log.reason}` : ''}`
          : `${otherName} cancelled the job${log.reason ? `: ${log.reason}` : ''}`;
      } else if (log.event === 'job_reopened') {
        LogIcon = XCircle;
        label = isMine
          ? `You cancelled — other applicants are still available${log.reason ? `: ${log.reason}` : ''}`
          : `${otherName} cancelled, but other applicants are still available${log.reason ? `: ${log.reason}` : ''}`;
      }
      return (
        <Animated.View entering={FadeInLeft} style={styles.callLogWrapper}>
          <View style={styles.callLogBubble}>
            <LogIcon size={14} color="#6B7280" />
            <ThemedText style={styles.callLogText}>{label}</ThemedText>
            <ThemedText style={styles.callLogTime}>{formatTime(item.sent_at)}</ThemedText>
          </View>
        </Animated.View>
      );
    }

    const isUser = item.sender_id === myUserId;
    return (
      <Animated.View
        entering={isUser ? FadeInRight : FadeInLeft}
        style={[
          styles.messageWrapper,
          isUser ? styles.userMessageWrapper : styles.applicantMessageWrapper
        ]}
      >
        <View style={[
          styles.messageBubble,
          isUser ? styles.userBubble : styles.applicantBubble
        ]}>
          <ThemedText style={[
            styles.messageText,
            isUser ? styles.userMessageText : styles.applicantMessageText
          ]}>
            {item.message}
          </ThemedText>
          <View style={styles.messageFooter}>
            <ThemedText style={[
              styles.timestampText,
              isUser ? styles.userTimestamp : styles.applicantTimestamp
            ]}>
              {formatTime(item.sent_at)}
            </ThemedText>
            {isUser && <CheckCheck size={12} color="#fff" style={styles.statusIcon} />}
          </View>
        </View>
      </Animated.View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={24} color="#000" />
        </TouchableOpacity>

        <View style={styles.userInfo}>
          <View style={styles.avatarContainer}>
            <Image
              source={{ uri: profileImage }}
              style={styles.avatar}
            />
            {isOtherOnline && <View style={styles.onlineBadge} />}
          </View>
          <View>
            <ThemedText style={styles.userName}>{name}</ThemedText>
            <ThemedText style={[styles.userStatus, !isOtherOnline && styles.userStatusOffline]}>
              {isOtherOnline ? 'Online' : profession}
            </ThemedText>
          </View>
        </View>

        <TouchableOpacity style={styles.menuButton} onPress={handleStartCall} disabled={callState !== 'idle' || !contactOpen}>
          <Phone size={20} color={callState === 'idle' && contactOpen ? '#000' : '#9CA3AF'} />
        </TouchableOpacity>
      </View>

      <CallOverlay
          recorded={recorded}
        callState={callState}
        answered={answered || autoAnswer === 'true'}
        name={name || 'Provider'}
        profileImage={profileImage}
        isMuted={isMuted}
        isSpeakerOn={isSpeakerOn}
        callDuration={callDuration}
        remoteRinging={remoteRinging}
        reconnecting={reconnecting}
        endedLabel={endedLabel}
        themeColors={themeColors}
        onAccept={handleAcceptCall}
        onDecline={handleDeclineCall}
        onEnd={handleEndCall}
        onToggleMute={toggleMute}
        onToggleSpeaker={toggleSpeaker}
      />

      <FlatList keyboardShouldPersistTaps="handled"
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => {
          if (isPrependingRef.current) {
            isPrependingRef.current = false;
            return;
          }
          flatListRef.current?.scrollToEnd({ animated: true });
        }}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
        keyboardDismissMode="on-drag"
        onScroll={({ nativeEvent }) => {
          if (nativeEvent.contentOffset.y < 60) loadMoreMessages();
        }}
        scrollEventThrottle={200}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        ListHeaderComponent={isLoadingMore ? (
          <ActivityIndicator style={{ paddingVertical: 12 }} color={themeColors.textSecondary} />
        ) : null}
      />

      {contactOpen ? (
        <View style={[styles.inputContainer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <TextInput
            style={styles.input}
            placeholder="Type a message..."
            placeholderTextColor="#9CA3AF"
            value={inputText}
            onChangeText={setInputText}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendButton, inputText.trim() === '' && styles.sendButtonDisabled]}
            onPress={handleSendMessage}
            disabled={inputText.trim() === ''}
          >
            <Send size={20} color={inputText.trim() === '' ? '#9CA3AF' : '#fff'} />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[styles.closedBanner, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <ThemedText style={styles.closedBannerText}>{CLOSED_TEXT}</ThemedText>
        </View>
      )}
      {appAlert.element}

      {/* Mutual rating modal — shown once when opening a completed job chat */}
      <Modal visible={ratingVisible} transparent animationType="fade" onRequestClose={() => { markRatingSkipped(jobId); setRatingVisible(false); }}>
        <View style={styles.ratingOverlay}>
          <View style={styles.ratingSheet}>
            <Text style={styles.ratingTitle}>Rate your experience</Text>
            <Text style={styles.ratingSubtitle}>How did the service go?</Text>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ width: '100%' }}>
              {(['behaviour', 'skill', 'punctuality', 'communication'] as const).map((dim) => (
                <View key={dim} style={styles.ratingRow}>
                  <Text style={styles.ratingDimLabel}>{dim.charAt(0).toUpperCase() + dim.slice(1)}</Text>
                  <View style={styles.starsRow}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <TouchableOpacity key={star} onPress={() => setRatings(r => ({ ...r, [dim]: star }))} style={styles.starBtn}>
                        <Star size={28} color={ratings[dim] >= star ? '#FFCE48' : '#D1D5DB'} fill={ratings[dim] >= star ? '#FFCE48' : 'transparent'} />
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ))}
              <TextInput
                style={styles.ratingCommentInput}
                placeholder="Add a comment (optional)"
                placeholderTextColor="#9CA3AF"
                value={ratingComment}
                onChangeText={setRatingComment}
                multiline
                numberOfLines={3}
              />
            </ScrollView>
            <View style={styles.ratingActions}>
              <TouchableOpacity style={styles.ratingSkipBtn} onPress={() => { markRatingSkipped(jobId); setRatingVisible(false); }}>
                <Text style={styles.ratingSkipText}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.ratingSubmitBtn, ratingSubmitting && { opacity: 0.6 }]}
                disabled={ratingSubmitting}
                onPress={async () => {
                  if (Object.values(ratings).some(v => v === 0)) {
                    appAlert.show('info', 'Incomplete', 'Please rate all dimensions before submitting.');
                    return;
                  }
                  setRatingSubmitting(true);
                  try {
                    await SkoFyApi.jobs.submitReview(jobId, {
                      behaviour_rating: ratings.behaviour,
                      skill_rating: ratings.skill,
                      punctuality_rating: ratings.punctuality,
                      communication_rating: ratings.communication,
                      comment: ratingComment,
                    });
                    markRatingSubmitted(jobId);
                    setRatingVisible(false);
                  } catch {
                    appAlert.show('error', 'Error', 'Failed to submit rating. Please try again.');
                  } finally {
                    setRatingSubmitting(false);
                  }
                }}
              >
                <Text style={styles.ratingSubmitText}>{ratingSubmitting ? 'Submitting…' : 'Submit Rating'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function makeStyles(t: typeof Colors.light) { return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 16,
    backgroundColor: t.card,
    borderBottomWidth: 1,
    borderBottomColor: t.borderSubtle,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  userInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 4,
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E5E7EB',
  },
  onlineBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#10B981',
    borderWidth: 2,
    borderColor: t.card,
  },
  userName: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  userStatus: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: Fonts.poppins,
    color: '#10B981',
  },
  userStatusOffline: {
    color: t.textSecondary,
  },
  menuButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  messageList: {
    padding: 16,
    paddingBottom: 24,
  },
  callLogWrapper: {
    alignSelf: 'center',
    marginBottom: 16,
  },
  callLogBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.card,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
  },
  callLogText: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Fonts.poppins,
    color: '#6B7280',
  },
  callLogTime: {
    fontSize: 11,
    lineHeight: 17,
    fontFamily: Fonts.poppins,
    color: '#9CA3AF',
  },
  messageWrapper: {
    marginBottom: 16,
    maxWidth: '80%',
  },
  userMessageWrapper: {
    alignSelf: 'flex-end',
  },
  applicantMessageWrapper: {
    alignSelf: 'flex-start',
  },
  messageBubble: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
  },
  userBubble: {
    backgroundColor: t.textPrimary,
    borderBottomRightRadius: 4,
  },
  applicantBubble: {
    backgroundColor: t.card,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: t.borderSubtle,
  },
  messageText: {
    fontSize: 15,
    fontFamily: Fonts.poppins,
    lineHeight: 22,
  },
  userMessageText: {
    color: '#fff',
  },
  applicantMessageText: {
    color: t.textPrimary,
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  timestampText: {
    fontSize: 10,
    lineHeight: 16,
    fontFamily: Fonts.poppins,
  },
  userTimestamp: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  applicantTimestamp: {
    color: t.textMuted,
  },
  statusIcon: {
    marginLeft: 4,
  },
  closedBanner: {
    paddingHorizontal: 20,
    paddingTop: 14,
    backgroundColor: t.card,
    borderTopWidth: 1,
    borderTopColor: t.borderSubtle,
  },
  closedBannerText: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    color: '#6B7280',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: t.card,
    borderTopWidth: 1,
    borderTopColor: t.borderSubtle,
  },
  input: {
    flex: 1,
    backgroundColor: t.inputFilled,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    paddingTop: 10,
    maxHeight: 100,
    fontFamily: Fonts.poppins,
    fontSize: 15,
    color: t.textPrimary,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFCE48',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  sendButtonDisabled: {
    backgroundColor: t.inputFilled,
  },
  ratingOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end', alignItems: 'center',
  },
  ratingSheet: {
    width: '100%', backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40, alignItems: 'center', maxHeight: '85%',
  },
  ratingTitle: {
    fontSize: 20, fontFamily: Fonts.poppinsBold, color: '#111827', marginBottom: 4,
  },
  ratingSubtitle: {
    fontSize: 14, fontFamily: Fonts.poppins, color: '#6B7280', marginBottom: 20,
  },
  ratingRow: {
    width: '100%', flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 16,
  },
  ratingDimLabel: {
    fontSize: 14, fontFamily: Fonts.poppinsMedium, color: '#374151', width: 110,
  },
  starsRow: { flexDirection: 'row', gap: 4 },
  starBtn: { padding: 2 },
  ratingCommentInput: {
    width: '100%', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12,
    padding: 12, fontSize: 14, fontFamily: Fonts.poppins, color: '#111827',
    minHeight: 72, textAlignVertical: 'top', marginBottom: 20,
  },
  ratingActions: {
    flexDirection: 'row', gap: 12, width: '100%',
  },
  ratingSkipBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1,
    borderColor: '#E5E7EB', alignItems: 'center',
  },
  ratingSkipText: {
    fontSize: 15, fontFamily: Fonts.poppinsMedium, color: '#6B7280',
  },
  ratingSubmitBtn: {
    flex: 2, paddingVertical: 14, borderRadius: 12,
    backgroundColor: '#FFCE48', alignItems: 'center',
  },
  ratingSubmitText: {
    fontSize: 15, fontFamily: Fonts.poppinsBold, color: '#111827',
  },
}); }
