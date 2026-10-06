import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Image } from 'expo-image';
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
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View
} from 'react-native';
import { useAppAlert } from '@/components/app-alert';
import Animated, { FadeInLeft, FadeInRight } from 'react-native-reanimated';
import {
  mediaDevices,
  MediaStream,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
} from 'react-native-webrtc';
import { Audio } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isRatingSkipped, markRatingSkipped } from '@/services/ratingReminders';
import { RTCIceServerConfig, SkoFyApi, TokenStore, getFreshAccessToken } from '@/services/api';
import { CallOverlay } from '@/components/call-overlay';
import InCallManager from 'react-native-incall-manager';
import { cancelIncomingCallNotification, registerAcceptHandler, registerHangupHandler, registerMuteHandler, registerSpeakerHandler, setActiveChatJob, setChatCallActive, startOngoingCallNotification, stopOngoingCallNotification, updateOngoingCallControls } from '@/services/callManager';

// No-answer cutoff — like a real phone call, ringing/calling shouldn't go on forever.
const CALL_TIMEOUT_MS = 45000;

// Matches the backend's default page size — used to tell whether a fetched
// page was "full" (there might be more behind it) or "short" (it's the end).
const MESSAGE_PAGE_SIZE = 50;

// Cutoff for the 'connecting' placeholder shown when this screen was opened
// via a notification action. Without this, a lost call_ready/resend round
// trip (caller already gave up, transient network blip, etc.) left the user
// stuck on "Connecting…" forever with no offer ever arriving and no way out
// (the back button is intentionally blocked while a call is active).
const CONNECTING_TIMEOUT_MS = 15000;
// A dropped connection (often a Wi-Fi ↔ mobile data switch) gets this long to
// recover before the call is ended — it used to end on the first blip.
const DISCONNECT_GRACE_MS = 10000;
// Max wait for the TURN relay details before calling without them.
const ICE_SERVERS_WAIT_MS = 3000;

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

type CallState = 'idle' | 'connecting' | 'calling' | 'ringing' | 'connected';

// STUN alone failed for real cross-network testing (two different mobile
// carriers, different cities) — calls rang/answered fine since that's just
// signaling, but no audio flowed, because direct peer-to-peer couldn't
// traverse carrier-grade NAT on one or both sides. TURN relays the media in
// that case. Metered's openrelay is a free, no-signup public TURN service —
// fine for testing, but it's shared/rate-limited and not something to rely
// on long-term; swap in a real TURN deployment (self-hosted coturn, or a
// paid service like Twilio/Xirsys) before this goes anywhere near production.
// The real STUN/TURN list (with short-lived credentials for Dodorez's own
// relay) comes from the server — see iceServersRef below. This is only the
// fallback if that request fails: a public STUN server, which still connects
// most calls directly but can't relay through strict networks. The app used
// to ship a shared TURN password here.
const FALLBACK_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export default function ChatScreen() {
  const { jobId, id, name: paramName, profileImage: paramProfileImage, profession: paramProfession, autoAnswer, autoCall, callId: callIdParam } = useLocalSearchParams<{
    jobId: string;
    id: string;
    name: string;
    profileImage: string;
    profession: string;
    autoAnswer?: string;
    callId?: string;
    autoCall?: string;
  }>();
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
    if ((paramName && paramProfession) || !jobId) return;
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
  const handleDeclineCallRef = useRef<() => void>(() => {});
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingIceRef = useRef<any[]>([]);
  const incomingOfferRef = useRef<{ sdp: string; type: string } | null>(null);
  const outgoingOfferRef = useRef<{ sdp: string; type: string } | null>(null);
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
  // ICE candidates sent for the current outgoing call. Replayed after the
  // offer is re-sent to a callee who opened the app from the notification:
  // the originals went out while nobody was listening, and without them the
  // call "connected" with no audio.
  const sentIceRef = useRef<any[]>([]);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ringbackSoundRef = useRef<Audio.Sound | null>(null);
  const ringtoneSoundRef = useRef<Audio.Sound | null>(null);
  const callTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // handleEndCall is redefined every render and reads callDuration/callState by
  // closure — but it gets invoked from the WS onmessage handler, which is set up
  // in an effect keyed only on [jobId] and so only ever sees the first render's
  // version. Dereferencing through this ref (kept current below) instead of
  // calling handleEndCall directly avoids logging a stale duration/connected state.
  const handleEndCallRef = useRef<() => void>(() => {});
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

  // Rating modal — shown once per session when opening a COMPLETED job chat
  const [ratingVisible, setRatingVisible] = useState(false);
  const [ratings, setRatings] = useState({ behaviour: 0, skill: 0, punctuality: 0, communication: 0 });
  const [ratingComment, setRatingComment] = useState('');
  const [ratingSubmitting, setRatingSubmitting] = useState(false);

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
  const iceServersRef = useRef<RTCIceServerConfig[]>(FALLBACK_ICE_SERVERS);
  const [socketOpen, setSocketOpen] = useState(false);
  const iceServersReadyRef = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    iceServersReadyRef.current = SkoFyApi.calls.iceServers()
      .then(servers => { if (Array.isArray(servers) && servers.length) iceServersRef.current = servers; })
      .catch(() => { /* keep the STUN fallback */ });
  }, []);
  // A call answered straight from the notification used to build its
  // connection before the relay details had loaded — STUN only, which fails
  // on most mobile networks.
  const waitForIceServers = () =>
    Promise.race([iceServersReadyRef.current, new Promise<void>(resolve => setTimeout(resolve, ICE_SERVERS_WAIT_MS))]);

  // Only while this screen's socket is actually connected: being the active
  // chat makes callManager skip the incoming-call notification, trusting
  // this socket to ring instead. With the socket down, that skipped the only
  // ring the user would have got.
  useFocusEffect(
    useCallback(() => {
      if (jobId && socketOpen) setActiveChatJob(jobId);
      registerAcceptHandler(() => handleAcceptCallRef.current());
      return () => {
        setActiveChatJob(null);
        registerAcceptHandler(null);
      };
    }, [jobId, socketOpen])
  );

  // Opened from a call notification: give up if the call never arrives — the
  // timer used to start only once the socket opened, so a screen opened for
  // a call that had already ended could sit on "Connecting…" indefinitely.
  useEffect(() => {
    if (autoAnswer === undefined) return;
    const timer = setTimeout(() => {
      if (callStateRef.current === 'connecting') handleDeclineCallRef.current();
    }, CONNECTING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  // Leaving this screen mid-call must end the call for both people — not
  // leave the microphone and connection running with no screen to hang up
  // from. Declared before the socket effect so call_end is sent before the
  // socket closes (effect cleanups run in declaration order).
  useEffect(() => () => {
    if (callStateRef.current !== 'idle') handleEndCallRef.current();
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

  const sendCallLogMessage = async (event: string, extra: Record<string, any> = {}) => {
    if (!jobId) return;
    try {
      const sent: any = await SkoFyApi.chat.send(jobId, JSON.stringify({ event, ...extra }), 'SYSTEM');
      setMessages(prev => [...prev, sent]);
    } catch (err) {
      console.error('Failed to send call log message:', err);
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
    stopSound(ringbackSoundRef);
    stopSound(ringtoneSoundRef);
    InCallManager.stop();
    clearCallTimeout();
    clearDisconnectTimer();
    callActionInFlightRef.current = false;
    callIdRef.current = null;
    autoAnswerPendingRef.current = false;
    sentIceRef.current = [];
    if (jobId) stopOngoingCallNotification(jobId);
    registerHangupHandler(null);
    registerMuteHandler(null);
    registerSpeakerHandler(null);
    if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null; }
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    pendingIceRef.current = [];
    incomingOfferRef.current = null;
    outgoingOfferRef.current = null;
    autoAnswerSentRef.current = false;
    setIsMuted(false);
    setIsSpeakerOn(false);
    setCallDuration(0);
    setCallState('idle');
  };

  const makePeerConnection = () => {
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    // react-native-webrtc's RTCPeerConnection implements EventTarget at runtime,
    // but its published .d.ts doesn't surface addEventListener — cast around it.
    (pc as any).addEventListener('icecandidate', (event: any) => {
      if (!event.candidate) return;
      sentIceRef.current.push(event.candidate);
      sendSignal({ type: 'ice_candidate', candidate: event.candidate });
    });
    (pc as any).addEventListener('connectionstatechange', () => {
      if (peerConnectionRef.current !== pc) return; // an earlier call's connection
      const state = pc.connectionState;
      if (state === 'connected') {
        clearDisconnectTimer();
      } else if (state === 'disconnected') {
        clearDisconnectTimer();
        disconnectTimerRef.current = setTimeout(() => handleEndCallRef.current(), DISCONNECT_GRACE_MS);
      } else if (state === 'failed') {
        // End it properly — call_end tells the other phone, which used to
        // keep showing the call until its own connection noticed.
        handleEndCallRef.current();
      }
    });
    return pc;
  };

  const handleStartCall = async () => {
    if (!jobId || callState !== 'idle' || callActionInFlightRef.current) return;
    // The offer travels over the socket — without it the other phone never
    // hears about the call, so don't play ringback to nobody.
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      appAlert.show('info', 'Not connected', "You're offline right now. Check your internet and try again in a moment.");
      return;
    }
    callActionInFlightRef.current = true;
    callIdRef.current = newCallId();
    sentIceRef.current = [];
    try {
      InCallManager.start({ media: 'audio' });
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      await waitForIceServers();
      const pc = makePeerConnection();
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      peerConnectionRef.current = pc;

      const offer = await pc.createOffer({});
      await pc.setLocalDescription(offer);
      outgoingOfferRef.current = { sdp: offer.sdp!, type: offer.type };
      sendSignal({ type: 'call_offer', sdp: offer.sdp, sdpType: offer.type });
      setCallState('calling');
      playLoopingSound(ringbackSoundRef, require('@/assets/sounds/ringback.wav'));
      sendCallLogMessage('call_started');
      clearCallTimeout();
      callTimeoutRef.current = setTimeout(() => handleEndCall(), CALL_TIMEOUT_MS);
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
    if (!offer) return;
    autoAnswerPendingRef.current = false;
    Vibration.cancel();
    InCallManager.stopRingtone();
    stopSound(ringtoneSoundRef);
    clearCallTimeout();
    // Safety net: answering in-app should always dismiss a matching incoming-
    // call notification, even if the activeChatJobId suppression in
    // callManager.ts didn't catch it (e.g. a push that slipped in before the
    // mount effect ran).
    if (jobId) cancelIncomingCallNotification(jobId);
    try {
      InCallManager.start({ media: 'audio' });
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      await waitForIceServers();
      const pc = makePeerConnection();
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      peerConnectionRef.current = pc;

      await pc.setRemoteDescription(new RTCSessionDescription({ sdp: offer.sdp, type: offer.type as any }));
      for (const candidate of pendingIceRef.current) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      pendingIceRef.current = [];

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal({ type: 'call_answer', sdp: answer.sdp, sdpType: answer.type });
      setCallState('connected');
      if (jobId) startOngoingCallNotification(jobId, name || 'Provider');
      registerHangupHandler(() => handleEndCallRef.current());
      registerMuteHandler(() => toggleMuteRef.current());
      registerSpeakerHandler(() => toggleSpeakerRef.current());
    } catch (err) {
      console.error('Failed to answer call:', err);
      appAlert.show('error', 'Call Failed', "Could not answer the call. Enable microphone access for Dodorez in your phone's settings and try again.", [
        { text: 'Cancel', variant: 'secondary' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]);
      sendSignal({ type: 'call_end' });
      cleanupCall();
    }
  };

  const handleDeclineCall = () => {
    clearCallTimeout();
    if (jobId) cancelIncomingCallNotification(jobId);
    sendSignal({ type: 'call_end' });
    sendCallLogMessage('call_ended', { duration_seconds: 0, connected: false });
    cleanupCall();
  };

  const handleEndCall = () => {
    clearCallTimeout();
    sendSignal({ type: 'call_end' });
    sendCallLogMessage('call_ended', { duration_seconds: callDuration, connected: callState === 'connected' });
    cleanupCall();
  };
  handleEndCallRef.current = handleEndCall;

  const toggleMute = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = isMuted;
      setIsMuted(!isMuted);
    }
  };
  toggleMuteRef.current = toggleMute;

  const toggleSpeaker = () => {
    InCallManager.setForceSpeakerphoneOn(!isSpeakerOn);
    setIsSpeakerOn(!isSpeakerOn);
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
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    };
    // Token fetched up front (in parallel with the URL) so onopen below can
    // send it synchronously — no await inside onopen. sendSignal (used for
    // mute/end-call/etc, triggerable straight from the UI) has no readiness
    // gate of its own, so any async gap between "socket is OPEN" and "auth
    // message actually sent" is a real window for a user tap to jump the
    // queue ahead of auth and get the connection rejected by the server.
    const connect = () => Promise.all([SkoFyApi.chat.getSocketUrl(jobId), getFreshAccessToken()]).then(([url, token]) => {
      if (closedByScreen) return;
      const ws = new WebSocket(url);
      socket = ws;
      wsRef.current = ws;
      ws.onclose = (event) => {
        if (wsRef.current === ws) wsRef.current = null;
        setSocketOpen(false);
        setIsOtherOnline(false);
        // 4403/4404: not a party to this job / no such job — retrying can't help.
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
          clearCallTimeout();
          callTimeoutRef.current = setTimeout(() => {
            if (callStateRef.current === 'connecting') handleDeclineCall();
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
            return;
          }
          if (data.type === 'call_offer') {
            const curState = callStateRef.current;
            // Already ringing or connected — ignore duplicates/stray offers.
            if (curState === 'ringing' || curState === 'connected') return;
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
              // We have the lower ID — become callee: tear down our outgoing call
              peerConnectionRef.current?.close();
              peerConnectionRef.current = null;
              localStreamRef.current?.getTracks().forEach(t => t.stop());
              localStreamRef.current = null;
              outgoingOfferRef.current = null;
              stopSound(ringbackSoundRef);
              clearCallTimeout();
              callActionInFlightRef.current = false;
              yieldedToTheirCall = true;
            }
            incomingOfferRef.current = { sdp: data.sdp, type: data.sdpType };
            callIdRef.current = data.call_id ?? null;
            if ((autoAnswerPendingRef.current && isNotifiedCall) || yieldedToTheirCall) {
              handleAcceptCallRef.current();
            } else {
              setCallState('ringing');
              // InCallManager.startRingtone plays on the actual ring audio
              // stream (same as the native notification's RingtoneManager
              // sound) so it respects the ring volume slider and is audible
              // even when media volume is muted/low — expo-av's Audio.Sound
              // (used previously) plays on the media stream, which is why
              // the in-app ring was silent while the notification's wasn't.
              InCallManager.startRingtone('_DEFAULT_', RING_PATTERN);
              clearCallTimeout();
              callTimeoutRef.current = setTimeout(() => handleDeclineCall(), CALL_TIMEOUT_MS);
            }
            return;
          }
          // Every other call signal must belong to the current call.
          const isOtherCall = !!data.call_id && data.call_id !== callIdRef.current;
          if (data.type === 'call_answer') {
            if (isOtherCall) return;
            const pc = peerConnectionRef.current;
            if (!pc) return;
            stopSound(ringbackSoundRef);
            clearCallTimeout();
            await pc.setRemoteDescription(new RTCSessionDescription({ sdp: data.sdp, type: data.sdpType }));
            for (const candidate of pendingIceRef.current) {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
            pendingIceRef.current = [];
            outgoingOfferRef.current = null;
            setCallState('connected');
            if (jobId) startOngoingCallNotification(jobId, name || 'Provider');
            registerHangupHandler(() => handleEndCallRef.current());
            registerMuteHandler(() => toggleMuteRef.current());
            registerSpeakerHandler(() => toggleSpeakerRef.current());
            return;
          }
          if (data.type === 'ice_candidate') {
            if (isOtherCall) return;
            const pc = peerConnectionRef.current;
            if (pc && pc.remoteDescription) {
              await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } else {
              pendingIceRef.current.push(data.candidate);
            }
            return;
          }
          if (data.type === 'call_ready') {
            if (outgoingOfferRef.current && !isOtherCall) {
              sendSignal({ type: 'call_offer', sdp: outgoingOfferRef.current.sdp, sdpType: outgoingOfferRef.current.type });
              for (const candidate of sentIceRef.current) sendSignal({ type: 'ice_candidate', candidate });
            }
            return;
          }
          if (data.type === 'call_end') {
            if (isOtherCall) return;
            cleanupCall();
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
    }).catch(scheduleReconnect);
    connect();

    return () => {
      closedByScreen = true;
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
      appAlert.show('error', 'Message Not Sent', 'Check your connection and try again.');
    }
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    if (item.message_type === 'SYSTEM') {
      let log: { event?: string; duration_seconds?: number; connected?: boolean; reason?: string } = {};
      try { log = JSON.parse(item.message); } catch {}
      const isMine = item.sender_id === myUserId;
      const otherName = name || 'them';
      let label = 'Voice call';
      let LogIcon = Phone;
      if (log.event === 'call_started') {
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
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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

        <TouchableOpacity style={styles.menuButton} onPress={handleStartCall} disabled={callState !== 'idle'}>
          <Phone size={20} color={callState === 'idle' ? '#000' : '#9CA3AF'} />
        </TouchableOpacity>
      </View>

      <CallOverlay
        callState={callState}
        name={name || 'Provider'}
        profileImage={profileImage}
        isMuted={isMuted}
        isSpeakerOn={isSpeakerOn}
        callDuration={callDuration}
        themeColors={themeColors}
        onAccept={handleAcceptCall}
        onDecline={handleDeclineCall}
        onEnd={handleEndCall}
        onToggleMute={toggleMute}
        onToggleSpeaker={toggleSpeaker}
      />

      <FlatList
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
      {appAlert.element}

      {/* Mutual rating modal — shown once when opening a completed job chat */}
      <Modal visible={ratingVisible} transparent animationType="fade" onRequestClose={() => { markRatingSkipped(jobId); setRatingVisible(false); }}>
        <View style={styles.ratingOverlay}>
          <View style={styles.ratingSheet}>
            <Text style={styles.ratingTitle}>Rate your experience</Text>
            <Text style={styles.ratingSubtitle}>How did the service go?</Text>
            <ScrollView showsVerticalScrollIndicator={false} style={{ width: '100%' }}>
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
