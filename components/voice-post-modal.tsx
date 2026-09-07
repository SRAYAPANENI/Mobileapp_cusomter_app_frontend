import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated as RNAnimated,
  Easing as RNEasing,
  Image,
  Linking,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import Svg, { Circle, Defs, RadialGradient, Stop, G, Ellipse } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle, TriangleAlert as AlertTriangle, X, Mic, Square, Camera, ImageIcon, Play } from 'lucide-react-native';
import { Fonts } from '@/constants/theme';
import { SkoFyApi } from '@/services/api';

// Every AI call failure used to be shown as "Check your internet/connection"
// regardless of actual cause — including a real 429 rate limit (a very
// plausible thing to hit during an active back-and-forth voice
// conversation), which has nothing to do with connectivity and telling the
// customer to check their internet for it is actively misleading.
function describeVoiceError(err: any, fallbackPrefix: string): string {
  if (err?.error_code === 'RATE_LIMITED') {
    return "You've been using voice input a lot in the last few minutes — please wait a bit and try again.";
  }
  if (err?.message) return err.message;
  return `${fallbackPrefix} Check your connection and try again.`;
}

type ChatMessage = { role: 'user' | 'assistant'; content: string; isComingSoon?: boolean };
type Phase =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'confirm'
  | 'posting'
  | 'success'
  | 'error';

interface JobData {
  title: string;
  description: string;
  profession?: string;
  skills?: string[];
  skill_names?: string[];  // DB-matched display names (array)
  skill_name: string;      // primary (legacy compat)
  skill_id: string;
  skill_ids: string[];
  urgency: string;
  scheduled_at: string | null;
  notes: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  lat?: number | null;
  lng?: number | null;
  address?: string;
  onJobPosted?: () => void;
  onFallbackToManual?: () => void;
  // Fires when the customer's first utterance sounds like a pickup/delivery
  // request — the caller is expected to close this modal (already done here)
  // and open the dedicated Pickup & Drop flow with the same lat/lng/address
  // this modal was given, treating it as the dropoff point exactly like the
  // Home banner and "Book Now" paths do.
  onPickupDropoffDetected?: () => void;
  initialProfession?: string;
  targetProvider?: { id: string; name: string; profession: string | null };
  // Backup providers asked in order if targetProvider declines or doesn't
  // respond in time — the sequential shortlist dispatch.
  queuedProviders?: { id: string; name: string; profession: string | null }[];
  initialRadiusMi?: number;
}

const CHAR_SIZE = 104;
const BAR_MIN = 5, BAR_MAX = 32; // speaking waveform bar height range
const WAVE_BAR_COUNT = 13;

// Siri-icon-style rotating color blades inside the sphere: 3 elongated
// ellipses radiating from center, each spun continuously by its own G wrapper.
const AnimatedG = RNAnimated.createAnimatedComponent(G);
const BLADE_CENTER = CHAR_SIZE / 2;
const BLADE_RX = CHAR_SIZE * 0.13;
const BLADE_RY = CHAR_SIZE * 0.30;
const BLADE_CY = BLADE_CENTER - CHAR_SIZE * 0.16;

// Siri-waveform-style multi-color ribbon: blue -> violet -> pink -> orange,
// interpolated per bar position rather than one flat color.
const WAVE_COLOR_STOPS = ['#38BDF8', '#818CF8', '#C084FC', '#F472B6', '#FB923C'];
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function waveColorAt(t: number): string {
  const segs = WAVE_COLOR_STOPS.length - 1;
  const scaled = Math.min(Math.max(t, 0), 1) * segs;
  const idx = Math.min(Math.floor(scaled), segs - 1);
  const localT = scaled - idx;
  const [ar, ag, ab] = hexToRgb(WAVE_COLOR_STOPS[idx]);
  const [br, bg, bb] = hexToRgb(WAVE_COLOR_STOPS[idx + 1]);
  const r = Math.round(ar + (br - ar) * localT);
  const g = Math.round(ag + (bg - ag) * localT);
  const b = Math.round(ab + (bb - ab) * localT);
  return `rgb(${r},${g},${b})`;
}

// Voice detection thresholds
const SPEECH_THRESHOLD = -22;  // dB — must exceed this to count as real speech
const SILENCE_THRESHOLD = -38; // dB — below this after speech = silence
const MIN_SPEECH_FRAMES = 4;   // need ≥4 frames (~0.8s) of speech before listening for silence
const SILENCE_FRAMES = 10;     // 10 × 200ms = 2s silence after confirmed speech → stop

const GREETING = "Hey! I'm SkoFy. What problem can I help you fix today?";

// Client-side content gate — blocks transcribed text before it reaches the AI.
// Two passes: (1) phrase patterns for adult/illegal requests, (2) word-level profanity.
const ADULT_REQUEST_RE = /\b(sex\s*worker|sexual\s*worker|prostitut\w*|call\s*girl|escort\s*service|adult\s*service|adult\s*entertain|erotic\s*(?:service|massage)|happy\s*ending|hooker|stripper|onlyfan|porn\s*star|nude\s*model|sex\s*service|sexual\s*service|companionship\s*service|massage\s*with\s*extra|paid\s*sex)\b/gi;
const PROFANITY_RE = /\b(f+u+c+k|sh[i1]t|b[i1]+tch|c[u0]nt|d[i1]ck|p[u0]ss[yi]|[a4]ss\s*hole|wh[o0]re|sl[u0]t|p[o0]rn|r[a4]pe|nud[e3]|sex\s*[uy]|motherf|bastard|sexual|erotic|masturbat\w*|orgasm)\b/gi;

// Pickup & Drop intent detection — a heuristic, not exhaustive (same
// limitation as the moderation regexes above). This flow is genuinely
// different from the repair/service jobs this conversation is built around
// (two locations, a verified-business pickup, no diagnosis/photo prompts),
// so it's better handed off to the dedicated Pickup & Drop modal immediately
// than half-fit into this one. Only checked on the customer's very first
// utterance — a stray mention of "drop off" deep into an unrelated repair
// conversation shouldn't derail it.
const PICKUP_DROPOFF_PHRASE_RE = /\b(pick[\s-]?up\s+(?:and|&)\s+(?:drop|deliver)|grocery\s+run|pharmacy\s+run|pick\s+something\s+up\s+and\s+(?:bring|deliver|drop))\b/i;
const FETCH_WORD_RE = /\b(pick\s*up|grab|buy)\b/i;
const DELIVER_WORD_RE = /\b(bring\s+it|deliver\s+it|drop\s*(?:it|this|them)?\s*off)\b/i;
function isPickupDropoffIntent(text: string): boolean {
  return PICKUP_DROPOFF_PHRASE_RE.test(text) || (FETCH_WORD_RE.test(text) && DELIVER_WORD_RE.test(text));
}

// Must mirror the PROFESSIONS list in skofy-backend/app/api/v1/ai.py
const KNOWN_PROFESSIONS = new Set([
  'Plumber', 'Electrician', 'AC Technician', 'Carpenter', 'Painter',
  'Cleaner', 'Pest Control', 'Gardener', 'Security/CCTV', 'Mason',
  'Handyman', 'Appliance Repair', 'Welder', 'Interior Designer',
]);

export function VoicePostModal({
  visible, onClose, lat, lng, address,
  onJobPosted, onFallbackToManual, onPickupDropoffDetected,
  initialProfession, targetProvider, queuedProviders, initialRadiusMi,
}: Props) {
  // Locked to light mode app-wide (see hooks/use-color-scheme.ts) — this
  // file imports useColorScheme directly from react-native rather than that
  // wrapper, so it would otherwise still follow the device's real theme.
  const dark = false;
  const C = dark ? DARK : LIGHT;
  const insets = useSafeAreaInsets();

  const [phase, setPhase] = useState<Phase>('idle');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [jobData, setJobData] = useState<JobData | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isPermDenied, setIsPermDenied] = useState(false);
  const [showAlternativeActions, setShowAlternativeActions] = useState(false);
  const alternativeProfessionRef = useRef<string>('');
  // Quick-tap confirmation for the two mandatory checkpoints in the
  // conversation flow — reliable regardless of speech-recognition accuracy,
  // rather than depending purely on parsing a spoken yes/no.
  const [showDiagnosisConfirm, setShowDiagnosisConfirm] = useState(false);
  const [showPhotoPrompt, setShowPhotoPrompt] = useState(false);
  const [radiusMi, setRadiusMi] = useState(250);
  // Nothing in this voice flow ever asked for this — SkoFyApi.jobs.create()
  // was called with no inspection_fee field at all, which the backend
  // defaults to 0.0, so hiring from a voice-posted job always skipped the
  // PaymentSheet exactly like the (also-just-fixed) manual post-requirement
  // wizard did.
  const [inspectionFeeInput, setInspectionFeeInput] = useState('');
  const [photos, setPhotos] = useState<{ uri: string; type: 'image' | 'video' }[]>([]);
  const violationCountRef = useRef(0);

  // "ON_SITE" (default) or "REMOTE" — no physical location/distance matching
  // at all (e.g. hiring a developer/consultant). Pickup & Drop is handled by
  // a dedicated modal instead (see isPickupDropoffIntent/onPickupDropoffDetected
  // above) rather than as a toggle here — this conversation isn't well suited
  // to it (no diagnosis/photo prompts apply, and a verified-business pickup
  // search doesn't fit the confirm screen this flow already has).
  const [serviceMode, setServiceMode] = useState<'ON_SITE' | 'REMOTE'>('ON_SITE');

  const handleServiceModeChange = (mode: 'ON_SITE' | 'REMOTE') => {
    setServiceMode(mode);
  };

  const scrollRef = useRef<ScrollView>(null);
  // Separate from scrollRef (the chat conversation's own scroll view) — the
  // confirm-details screen is a different ScrollView, mutually exclusive
  // with the chat one, so it needs its own ref to scroll the inspection fee
  // input clear of the keyboard on focus.
  const confirmScrollRef = useRef<ScrollView>(null);
  const scrollConfirmToFocusedInput = () => {
    setTimeout(() => confirmScrollRef.current?.scrollToEnd({ animated: true }), 150);
  };
  const messagesRef = useRef<ChatMessage[]>([]);
  // Counts real customer utterances only — distinct from messagesRef's
  // user-role count, which the "service chip mic tap" open-reset effect
  // pollutes with a synthetic seed message (`I need a ${initialProfession}`)
  // that isn't something the customer actually said. Used to gate pickup/
  // dropoff intent detection to their genuine first utterance regardless of
  // which entry point opened this modal.
  const customerUtteranceCountRef = useRef(0);
  const phaseRef = useRef<Phase>('idle');
  const recordingRef = useRef<Audio.Recording | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const silenceCountRef = useRef(0);
  // Speech gate — prevents noise-only recordings from being transcribed
  const heardSpeechRef = useRef(false);
  const speechFramesRef = useRef(0);
  // Mic permission cached after first grant — avoids repeated system popups
  const micPermGrantedRef = useRef(false);
  // Whisper auto-detects language fresh on every clip when this is unset —
  // fine for the first utterance, but independent per-turn detection could
  // (and did) flip languages on later turns, since a few seconds of audio is
  // often genuinely ambiguous alone. Locked in from the first response and
  // echoed back on every later transcribe() call for the rest of this session.
  const detectedLanguageRef = useRef<string | undefined>(undefined);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // ── Character animations ───────────────────────────────────────────────────
  // Kept deliberately minimal — a single breathing sphere, no decorative
  // rings/arcs orbiting it (that read as visual clutter next to the clean
  // single-glow-sphere look of Siri/HomePod). Motion + color-shift + the
  // in-sphere wave bars/dots carry all the "alive" feeling now.
  const charScale = useRef(new RNAnimated.Value(1)).current;
  const charBreath = useRef<RNAnimated.CompositeAnimation | null>(null);

  // Speaking waveform (inside sphere) — many thin, multi-color bars centered
  // on a shared baseline, rippling outward from the middle bar, approximating
  // Apple's Siri waveform ribbon rather than a discrete 5-bar equalizer.
  const bars = useRef(Array.from({ length: WAVE_BAR_COUNT }, () => new RNAnimated.Value(BAR_MIN))).current;
  const barLoops = useRef<RNAnimated.CompositeAnimation[]>([]);

  // Rotating color blades inside the sphere — continuous motion regardless of
  // phase (Siri's blades keep turning even at rest), started once per modal
  // open/close rather than reset on every phase change like the other anims.
  const blade1Rot = useRef(new RNAnimated.Value(0)).current;
  const blade2Rot = useRef(new RNAnimated.Value(0)).current;
  const blade3Rot = useRef(new RNAnimated.Value(0)).current;
  const bladeLoops = useRef<RNAnimated.CompositeAnimation[]>([]);

  const startBladeSpin = () => {
    const spin = (val: RNAnimated.Value, duration: number) =>
      RNAnimated.loop(RNAnimated.timing(val, { toValue: 1, duration, easing: RNEasing.linear, useNativeDriver: false }));
    bladeLoops.current = [spin(blade1Rot, 7000), spin(blade2Rot, 9500), spin(blade3Rot, 6000)];
    bladeLoops.current.forEach(l => l.start());
  };
  const stopBladeSpin = () => {
    bladeLoops.current.forEach(l => l.stop());
    blade1Rot.setValue(0); blade2Rot.setValue(0); blade3Rot.setValue(0);
  };

  const stopAllAnims = () => {
    charBreath.current?.stop();
    barLoops.current.forEach(a => a.stop());
    charScale.setValue(1);
    bars.forEach(b => b.setValue(BAR_MIN));
  };

  const startBreathe = (peak: number, duration: number) => {
    charBreath.current = RNAnimated.loop(RNAnimated.sequence([
      RNAnimated.timing(charScale, { toValue: peak, duration, easing: RNEasing.inOut(RNEasing.ease), useNativeDriver: true }),
      RNAnimated.timing(charScale, { toValue: 1, duration, easing: RNEasing.inOut(RNEasing.ease), useNativeDriver: true }),
    ]));
    charBreath.current.start();
  };

  const startWaveBars = () => {
    // height animation can't use the native driver — fine here, only ~13 thin bars.
    // Delay scales with distance from the middle bar so the wave visibly
    // ripples outward from center, rather than each bar just doing its own thing.
    const mid = (bars.length - 1) / 2;
    barLoops.current = bars.map((bar, i) => {
      const dist = Math.abs(i - mid);
      const loop = RNAnimated.loop(RNAnimated.sequence([
        RNAnimated.delay(dist * 70),
        RNAnimated.timing(bar, { toValue: BAR_MAX - dist * 3, duration: 260 + dist * 40, easing: RNEasing.inOut(RNEasing.ease), useNativeDriver: false }),
        RNAnimated.timing(bar, { toValue: BAR_MIN, duration: 260 + dist * 40, easing: RNEasing.inOut(RNEasing.ease), useNativeDriver: false }),
      ]));
      loop.start();
      return loop;
    });
  };

  // ── Phase-driven animations ────────────────────────────────────────────────
  useEffect(() => {
    stopAllAnims();
    if (phase === 'listening')       startBreathe(1.09, 900);   // faster/bigger — feels alert
    else if (phase === 'speaking')   { startBreathe(1.05, 1100); startWaveBars(); }
    else                              startBreathe(1.04, 1400);  // idle / processing / confirm
  }, [phase]);

  // ── Open / close reset ─────────────────────────────────────────────────────
  useEffect(() => {
    if (visible) {
      // Pre-fetch permission so the system popup never interrupts a conversation
      Audio.getPermissionsAsync().then(({ status }) => {
        if (status === 'granted') micPermGrantedRef.current = true;
      });
      setMessages([]); messagesRef.current = [];
      setJobData(null); setErrorMsg(''); setIsPermDenied(false);
      setShowAlternativeActions(false);
      setShowDiagnosisConfirm(false);
      setShowPhotoPrompt(false);
      setPhotos([]);
      setRadiusMi(initialRadiusMi ?? 250);
      setServiceMode('ON_SITE');
      violationCountRef.current = 0;
      customerUtteranceCountRef.current = 0;
      stopAllAnims(); setPhase('idle');
      startBladeSpin();
      setTimeout(async () => {
        startBreathe(1.04, 1400);
        let openText: string;
        if (initialProfession) {
          // Service chip mic tap — AI already knows the service, skip generic question
          const seed: ChatMessage = { role: 'user', content: `I need a ${initialProfession}` };
          openText = `Got it — ${initialProfession}! Describe the issue briefly and I'll match you with the right pro.`;
          const greetMsg: ChatMessage = { role: 'assistant', content: openText };
          // Show only the targeted greeting; keep seed in ref for backend context
          setMessages([greetMsg]);
          messagesRef.current = [seed, greetMsg];
        } else {
          openText = GREETING;
          const greeting: ChatMessage = { role: 'assistant', content: GREETING };
          setMessages([greeting]); messagesRef.current = [greeting];
        }
        setPhase('speaking');
        await speakText(openText);
        setPhase('idle');
        // Auto-start listening right after greeting — no tap needed
        setTimeout(() => { if (phaseRef.current === 'idle') startListening(); }, 400);
      }, 350);
    } else {
      stopRecording();
      Speech.stop();
      stopBladeSpin();
    }
  }, [visible]);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, [messages]);

  // ── Recording helpers ──────────────────────────────────────────────────────
  const stopRecording = () => {
    if (silenceTimerRef.current) { clearInterval(silenceTimerRef.current); silenceTimerRef.current = null; }
    if (recordingRef.current) {
      recordingRef.current.stopAndUnloadAsync().catch(() => {});
      recordingRef.current = null;
    }
  };

  const startSilenceDetection = () => {
    heardSpeechRef.current = false;
    speechFramesRef.current = 0;
    silenceCountRef.current = 0;

    silenceTimerRef.current = setInterval(async () => {
      if (!recordingRef.current) return;
      try {
        const status = await recordingRef.current.getStatusAsync();
        if (!status.isRecording) return;
        const dB = status.metering ?? -160;

        if (dB >= SPEECH_THRESHOLD) {
          speechFramesRef.current++;
          silenceCountRef.current = 0;
          if (!heardSpeechRef.current && speechFramesRef.current >= MIN_SPEECH_FRAMES) {
            heardSpeechRef.current = true;
          }
        } else if (dB < SILENCE_THRESHOLD) {
          if (heardSpeechRef.current) {
            silenceCountRef.current++;
            if (silenceCountRef.current >= SILENCE_FRAMES) {
              clearInterval(silenceTimerRef.current!);
              silenceTimerRef.current = null;
              stopAndTranscribe();
            }
          } else {
            speechFramesRef.current = 0;
          }
        }
      } catch { /* ignore */ }
    }, 200);
  };

  // ── Start listening (uses phaseRef so it's safe to call from any closure) ──
  const startListening = async () => {
    if (phaseRef.current !== 'idle' && phaseRef.current !== 'error') return;

    if (!micPermGrantedRef.current) {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        setIsPermDenied(true);
        setPhase('error');
        setErrorMsg('Microphone access is required. Please enable it in Settings to use voice.');
        return;
      }
      micPermGrantedRef.current = true;
    }

    setIsPermDenied(false);
    setPhase('listening');

    // expo-speech's TTS engine and expo-av's recording session are two
    // separate native audio subsystems — right after speakText()'s onDone
    // fires, the OS hasn't always finished releasing the TTS engine's audio
    // focus yet, so the very next Recording.createAsync() call can lose that
    // race and fail with a generic (non-permission) error. A fixed delay
    // before calling startListening() can't reliably cover this since the
    // release time varies by device — retrying a couple of times here does.
    const ATTEMPTS = 3;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        // Release any held audio session before acquiring recording focus.
        // Include Android-specific keys so audio focus is properly handed over on all platforms.
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          shouldDuckAndroid: false,
        }).catch(() => {});
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
        const { recording } = await Audio.Recording.createAsync({
          ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
          isMeteringEnabled: true,
        });
        recordingRef.current = recording;
        startSilenceDetection();
        return;
      } catch (e: any) {
        const msg = (e?.message ?? '').toLowerCase();
        const permIssue = msg.includes('permission') || msg.includes('denied') || msg.includes('unauthorized');
        if (permIssue || attempt === ATTEMPTS) {
          setIsPermDenied(permIssue);
          setPhase('error');
          setErrorMsg(permIssue
            ? 'Microphone access is required. Please enable it in Settings to use voice.'
            : 'Could not access microphone. Please try again.');
          return;
        }
        // Not a permission problem — likely the audio-session race above.
        // Back off briefly and try again rather than failing on the first hiccup.
        await new Promise(resolve => setTimeout(resolve, 350 * attempt));
      }
    }
  };

  // ── Internal re-listen after noise (stays in listening phase) ─────────────
  const restartRecordingQuietly = async () => {
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, shouldDuckAndroid: false }).catch(() => {});
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true, shouldDuckAndroid: true, playThroughEarpieceAndroid: false });
      const { recording } = await Audio.Recording.createAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      });
      recordingRef.current = recording;
      startSilenceDetection();
    } catch {
      setPhase('idle');
    }
  };

  // ── Stop and transcribe (or restart quietly if only noise was captured) ────
  // `force` is set when the user manually taps "Tap to send" — that tap is
  // itself unambiguous confirmation they're done talking, so it must always
  // attempt to transcribe. Without it, a manual tap before heardSpeechRef
  // flips true (the dB-threshold heuristic meant for the *automatic*
  // silence-timeout path) silently restarted recording with zero feedback —
  // read as "the button doesn't work."
  const stopAndTranscribe = async (force = false) => {
    if (phaseRef.current !== 'listening') return;
    if (silenceTimerRef.current) { clearInterval(silenceTimerRef.current); silenceTimerRef.current = null; }
    const recording = recordingRef.current;
    if (!recording) { setPhase('idle'); return; }

    if (!heardSpeechRef.current && !force) {
      try { await recording.stopAndUnloadAsync(); } catch {}
      recordingRef.current = null;
      if (phaseRef.current === 'listening') restartRecordingQuietly();
      return;
    }

    setPhase('processing');
    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      recordingRef.current = null;
      const uri = recording.getURI();
      if (!uri) { setPhase('idle'); return; }

      const { text, language } = await SkoFyApi.ai.transcribe(uri, detectedLanguageRef.current);
      if (language && !detectedLanguageRef.current) detectedLanguageRef.current = language;
      if (!text?.trim()) {
        if (phaseRef.current === 'processing') setPhase('idle');
        setTimeout(() => { if (phaseRef.current === 'idle') startListening(); }, 300);
        return;
      }
      handleUserSpoke(text.trim());
    } catch (err: any) {
      setPhase('error');
      setErrorMsg(describeVoiceError(err, 'Could not transcribe.'));
    }
  };

  const handleUserSpoke = (text: string) => {
    // Captured before incrementing — true only for the very first thing the
    // customer has actually said this conversation (see
    // customerUtteranceCountRef's comment for why this isn't just "no
    // role:'user' message yet" — a chip-tap entry seeds one synthetically).
    const isFirstCustomerUtterance = customerUtteranceCountRef.current === 0;
    customerUtteranceCountRef.current += 1;

    // ── Content moderation ───────────────────────────────────────────────────
    // Pass 1: adult / illegal service request — immediate hard stop, no warnings
    if (ADULT_REQUEST_RE.test(text)) {
      ADULT_REQUEST_RE.lastIndex = 0;
      const blockMsg: ChatMessage = {
        role: 'assistant',
        content: "Dodorez is a home services platform and cannot assist with that request. This session has been ended.",
      };
      setMessages(prev => [...prev, blockMsg]);
      speakText(blockMsg.content);
      setTimeout(() => onClose(), 2800);
      return;
    }
    ADULT_REQUEST_RE.lastIndex = 0;

    // Pass 2: profanity — 3-strike warning system
    if (PROFANITY_RE.test(text)) {
      PROFANITY_RE.lastIndex = 0;
      violationCountRef.current += 1;
      const isFinal = violationCountRef.current >= 3;
      const warnMsg: ChatMessage = {
        role: 'assistant',
        content: isFinal
          ? 'Multiple inappropriate messages detected. Session ended.'
          : `Please keep it respectful — this is a home services app. (Warning ${violationCountRef.current}/3)`,
      };
      setMessages(prev => [...prev, warnMsg]);
      speakText(warnMsg.content);
      if (isFinal) setTimeout(() => onClose(), 2500);
      return;
    }
    PROFANITY_RE.lastIndex = 0;

    // Pass 3: pickup/delivery intent — only on the first thing the customer
    // says (see isPickupDropoffIntent's comment for why not later turns too),
    // and never for a direct booking (targetProvider set) — that's the
    // customer targeting one specific provider by name, which Pickup & Drop's
    // broadcast-to-any-available-provider model can't honor. Not relying on
    // onPickupDropoffDetected simply not being wired for that entry point
    // (provider-map.tsx) — this needs to hold even if that ever changes.
    if (isFirstCustomerUtterance && !targetProvider && onPickupDropoffDetected && isPickupDropoffIntent(text)) {
      const userMsg: ChatMessage = { role: 'user', content: text };
      const handoffMsg: ChatMessage = {
        role: 'assistant',
        content: "That sounds like a pickup and delivery job — let me take you to our quick Pickup & Drop flow instead.",
      };
      setMessages([userMsg, handoffMsg]);
      speakText(handoffMsg.content).then(() => setTimeout(() => {
        onClose();
        onPickupDropoffDetected();
      }, 400));
      return;
    }

    setShowAlternativeActions(false);
    setShowDiagnosisConfirm(false);
    setShowPhotoPrompt(false);
    const userMsg: ChatMessage = { role: 'user', content: text };
    const next = [...messagesRef.current, userMsg];
    setMessages(next);
    sendToBackend(next);
  };

  const handleBookAlternative = () => {
    setShowAlternativeActions(false);
    const alt = alternativeProfessionRef.current;
    alternativeProfessionRef.current = '';
    const msg = alt
      ? `Yes, please book a ${alt} for me.`
      : 'Yes, please book the service you just offered.';
    handleUserSpoke(msg);
  };

  const handleDeclineAlternative = () => {
    setShowAlternativeActions(false);
    const byeMsg: ChatMessage = { role: 'assistant', content: "No problem! We'll have more services soon. Come back anytime! 👋" };
    setMessages(prev => [...prev, byeMsg]);
    speakText(byeMsg.content).then(() => setTimeout(() => onClose(), 400));
  };

  // ── Diagnosis confirmation (mandatory checkpoint) ─────────────────────────
  const handleDiagnosisConfirm = () => {
    setShowDiagnosisConfirm(false);
    handleUserSpoke("Yes, that's correct.");
  };

  const handleDiagnosisClarify = () => {
    setShowDiagnosisConfirm(false);
    // A correction is easier to say than to tap out — just open the mic
    // straight away instead of sending a canned message.
    setTimeout(() => { if (phaseRef.current === 'idle') startListening(); }, 200);
  };

  // ── In-conversation photo prompt ──────────────────────────────────────────
  const handlePhotoPromptAdd = async () => {
    setShowPhotoPrompt(false);
    const added = await pickPhoto('gallery');
    handleUserSpoke(added ? "I've added a photo." : "Actually, I'll skip the photo.");
  };

  const handlePhotoPromptSkip = () => {
    setShowPhotoPrompt(false);
    handleUserSpoke("No thanks, let's continue.");
  };

  const sendToBackend = useCallback(async (history: ChatMessage[]) => {
    setPhase('processing');
    try {
      const res = await SkoFyApi.ai.voiceChat(history);
      if (res.is_complete && res.job_data && KNOWN_PROFESSIONS.has(res.job_data.profession ?? '')) {
        setJobData(res.job_data);
        const closing = getClosingLine(history);
        setPhase('speaking');
        await speakText(closing);
        setPhase('confirm');
      } else {
        // Treat an unrecognised profession the same as a coming-soon reply
        const effectiveReply = (res.is_complete && !KNOWN_PROFESSIONS.has(res.job_data?.profession ?? ''))
          ? `We're adding ${res.job_data?.profession ?? 'that service'} to Dodorez soon! Can I help you with something else?`
          : res.reply;
        const isComingSoon = /we'?re adding .+ to skofy soon|not yet available on skofy/i.test(effectiveReply);
        if (isComingSoon) {
          // Extract which alternative profession the AI offered so the Yes button can name it explicitly
          const mentioned = [...KNOWN_PROFESSIONS].find(p =>
            effectiveReply.toLowerCase().includes(p.toLowerCase())
          );
          alternativeProfessionRef.current = mentioned ?? '';
        }
        const aiMsg: ChatMessage = { role: 'assistant', content: effectiveReply, isComingSoon };
        setMessages(prev => [...prev, aiMsg]);
        setPhase('speaking');
        await speakText(effectiveReply);
        setPhase('idle');
        if (isComingSoon) {
          // Show Yes / No buttons — don't auto-listen, wait for the user's explicit choice
          setShowAlternativeActions(true);
        } else if (!res.is_complete && res.diagnosis_check) {
          // Mandatory accuracy checkpoint — offer a tap alongside the mic so
          // confirming doesn't depend on speech recognition getting a short
          // "yes" right, but they can still just say it if they prefer.
          setShowDiagnosisConfirm(true);
          setTimeout(() => { if (phaseRef.current === 'idle') startListening(); }, 600);
        } else if (!res.is_complete && res.ask_photo) {
          setShowPhotoPrompt(true);
          setTimeout(() => { if (phaseRef.current === 'idle') startListening(); }, 600);
        } else {
          // Auto-start listening — uses phaseRef so never stale regardless of closure age
          setTimeout(() => { if (phaseRef.current === 'idle') startListening(); }, 600);
        }
      }
    } catch (err: any) {
      setPhase('error');
      setErrorMsg(describeVoiceError(err, 'Connection problem.'));
    }
  }, []);

  const speakText = (text: string): Promise<void> =>
    new Promise(resolve => Speech.speak(text, { rate: 0.9, onDone: resolve, onError: () => resolve() }));

  // ── Post job ───────────────────────────────────────────────────────────────
  const doPostJob = async () => {
    if (!jobData) return;
    setPhase('posting');
    try {
      let imageUrls: string[] = [];
      if (photos.length > 0) {
        try {
          // MIME must match the actual file — this was previously hardcoded
          // to 'image/jpeg' for every file regardless of type, which is why
          // a video (once selectable at all) would upload mislabeled and
          // then get rendered as a broken image on the provider's side.
          const files = photos.map(p => {
            const ext = p.uri.split('.').pop()?.toLowerCase();
            const mime = p.type === 'video'
              ? (ext === 'mov' ? 'video/quicktime' : 'video/mp4')
              : 'image/jpeg';
            return { uri: p.uri, type: mime, name: p.uri.split('/').pop() || `media.${ext || (p.type === 'video' ? 'mp4' : 'jpg')}` };
          });
          imageUrls = await SkoFyApi.jobs.uploadMedia(files);
        } catch { /* non-fatal — job posts without photos */ }
      }

      await SkoFyApi.jobs.create({
        title: jobData.title,
        description: jobData.description,
        skill_id: jobData.skill_id || undefined,
        skill_ids: jobData.skill_ids?.length ? jobData.skill_ids : undefined,
        urgency: jobData.urgency as any,
        scheduled_at: jobData.scheduled_at ?? undefined,
        // See summary.tsx's identical guard — `|| 0` alone only catches NaN,
        // not a typed negative value like "-50", which would otherwise sail
        // through and only fail later as a confusing Stripe error at hire time.
        inspection_fee: Math.max(0, parseFloat(inspectionFeeInput) || 0),
        // REMOTE: no location at all. Otherwise, the customer's current lat/lng.
        lat: serviceMode === 'REMOTE' ? undefined : (lat ?? undefined),
        lng: serviceMode === 'REMOTE' ? undefined : (lng ?? undefined),
        search_radius_km: Math.round(radiusMi * 1.60934),
        images: imageUrls,
        target_provider_id: targetProvider?.id,
        direct_request_queue: queuedProviders?.length ? queuedProviders.map(p => p.id) : undefined,
        posted_via: 'VOICE',
        service_mode: serviceMode,
      });
      setPhase('success');
      setTimeout(() => { onJobPosted?.(); onClose(); }, 1600);
    } catch (err: any) {
      setPhase('error');
      // Previously misclassified by string-matching "skill" in the message —
      // the backend's same-skill-pending-direct-request guard (409 Conflict)
      // literally says "...pending direct request for this skill...", which
      // always matched, showing a wrong/confusing "Could not match a skill"
      // message for what's actually "you already have one of these open."
      // create_job() has no skill-verification check at all (only bid(), a
      // different screen, does) — error_code is the real signal to branch on.
      const detail = err?.message || err?.detail || '';
      setErrorMsg(err?.error_code === 'CONFLICT'
        ? (detail || 'You already have a pending direct request for this skill.')
        : 'Failed to post the job. Check your connection and try again.');
    }
  };

  // ── Photo/video picker — both camera and gallery support either media type ──
  // Returns whether media was actually added (vs. cancelled) — the in-
  // conversation photo prompt needs this to know which follow-up message
  // to send the assistant.
  const pickPhoto = async (source: 'camera' | 'gallery'): Promise<boolean> => {
    try {
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.8, allowsMultipleSelection: true });
      if (!result.canceled) {
        const picked = result.assets.map(a => ({
          uri: a.uri,
          type: (a.type === 'video' ? 'video' : 'image') as 'image' | 'video',
        }));
        setPhotos(prev => [...prev, ...picked].slice(0, 5));
        return true;
      }
      return false;
    } catch { return false; }
  };

  const cancelConfirm = () => {
    stopRecording();
    Speech.stop();
    Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: false }).catch(() => {});
    setJobData(null);
    setErrorMsg('');
    setPhotos([]);
    setMessages([]);
    messagesRef.current = [];
    setServiceMode('ON_SITE');
    customerUtteranceCountRef.current = 0;
    setPhase('idle');
    setTimeout(async () => {
      let openText: string;
      if (initialProfession) {
        const seed: ChatMessage = { role: 'user', content: `I need a ${initialProfession}` };
        openText = `Got it — ${initialProfession}! Describe the issue briefly and I'll match you with the right pro.`;
        const greetMsg: ChatMessage = { role: 'assistant', content: openText };
        setMessages([greetMsg]);
        messagesRef.current = [seed, greetMsg];
      } else {
        openText = GREETING;
        const greeting: ChatMessage = { role: 'assistant', content: GREETING };
        setMessages([greeting]);
        messagesRef.current = [greeting];
      }
      setPhase('speaking');
      await speakText(openText);
      setPhase('idle');
      setTimeout(() => { if (phaseRef.current === 'idle') startListening(); }, 400);
    }, 350);
  };

  const getClosingLine = (history: ChatMessage[]): string => {
    const first = history.find(m => m.role === 'user')?.content ?? '';
    if (/[ఀ-౿]/.test(first)) return 'అద్భుతం! వివరాలు confirm చేయండి.';
    if (/[ऀ-ॿ]/.test(first)) return 'बढ़िया! विवरण confirm करें।';
    if (/[஀-௿]/.test(first)) return 'சரி! விவரங்களை confirm செய்யுங்கள்.';
    return 'Got it! Please confirm your job details.';
  };

  const handleRetry = () => { setPhase('idle'); setErrorMsg(''); setTimeout(startListening, 400); };

  const displaySkillNames = (): string[] => {
    if (!jobData) return [];
    if (jobData.skill_names?.length) return jobData.skill_names;
    if (jobData.skill_name) return [jobData.skill_name];
    return [];
  };

  const s = makeStyles(C);
  const inConfirmFlow = (phase === 'confirm' || phase === 'posting' || phase === 'success') && !!jobData;
  // Classic Siri palette (blue/pink/teal) normally, shifted warm while
  // speaking — orange/red/magenta, deliberately no yellow/gold in the mix.
  const bladeColors = phase === 'speaking'
    ? ['#FB923C', '#F87171', '#EC4899']
    : ['#38BDF8', '#F472B6', '#34D399'];

  return (
    <Modal visible={visible} transparent={false} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <StatusBar backgroundColor={C.bg} barStyle={dark ? 'light-content' : 'dark-content'} />
      <View style={s.screen}>

        {/* Header — adapts to phase */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <View style={[s.headerDot, phase === 'success' && { backgroundColor: '#10B981' }]} />
            <Text style={s.headerTitle}>
              {phase === 'success' ? 'Job Posted!'
               : (phase === 'confirm' || phase === 'posting') ? 'Confirm Job'
               : 'Hey Dodorez'}
            </Text>
          </View>
          {phase !== 'posting' && phase !== 'success' && (
            <TouchableOpacity style={s.closeBtn} onPress={phase === 'confirm' ? cancelConfirm : onClose}>
              <X size={22} color={C.muted} />
            </TouchableOpacity>
          )}
        </View>

        {inConfirmFlow ? (
          // ── FULL-SCREEN CONFIRM FLOW ──────────────────────────────────────
          <>
            <ScrollView ref={confirmScrollRef} style={s.fullConfirmScroll} contentContainerStyle={s.fullConfirmContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              {/* Hero orb */}
              <View style={s.confirmHero}>
                <View style={[s.confirmOrbSmall, phase === 'success' && { borderColor: '#10B981', shadowColor: '#10B981' }]}>
                  {phase === 'success' ? (
                    <CheckCircle size={38} color="#10B981" />
                  ) : phase === 'posting' ? (
                    <View style={s.postSpinner} />
                  ) : (
                    <Svg width={96} height={96} style={StyleSheet.absoluteFillObject}>
                      <Defs>
                        <RadialGradient id="confirmBase" cx="38%" cy="34%" r="75%">
                          <Stop offset="0%" stopColor="#93C5FD" />
                          <Stop offset="100%" stopColor="#4C1D95" />
                        </RadialGradient>
                        <RadialGradient id="confirmAccent" cx="68%" cy="72%" r="55%">
                          <Stop offset="0%" stopColor="#F472B6" stopOpacity={0.8} />
                          <Stop offset="100%" stopColor="#F472B6" stopOpacity={0} />
                        </RadialGradient>
                        <RadialGradient id="confirmGlint" cx="30%" cy="24%" r="28%">
                          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.9} />
                          <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
                        </RadialGradient>
                      </Defs>
                      <Circle cx="50%" cy="50%" r="50%" fill="url(#confirmBase)" />
                      <Circle cx="50%" cy="50%" r="50%" fill="url(#confirmAccent)" />
                      <Circle cx="50%" cy="50%" r="50%" fill="url(#confirmGlint)" />
                    </Svg>
                  )}
                </View>
                <Text style={s.confirmHeroTitle}>
                  {phase === 'success' ? 'Job Posted!' : phase === 'posting' ? 'Posting…' : 'Ready to post!'}
                </Text>
                <Text style={s.confirmHeroSub}>
                  {phase === 'success'
                    ? (targetProvider
                        ? (queuedProviders?.length ? `Sent to ${targetProvider.name} first!` : `Sent to ${targetProvider.name}!`)
                        : "We'll match you with a nearby pro shortly")
                    : phase === 'posting'
                    ? 'Hang tight while we submit your job'
                    : 'Review the details below and confirm'}
                </Text>
              </View>

              {/* Details card */}
              <View style={s.confirmCard}>
                {!!targetProvider && (
                  <View style={s.directBanner}>
                    <Text style={s.directBannerText}>
                      {queuedProviders?.length
                        ? `Asking ${targetProvider.name} first. If they don't respond, we'll try ${queuedProviders.map(p => p.name).join(', ')} next — one at a time.`
                        : `Booking ${targetProvider.name} directly — only they'll receive this job`}
                    </Text>
                  </View>
                )}
                <View style={s.confirmRow}>
                  <Text style={s.confirmLabel}>Job</Text>
                  <Text style={s.confirmValue} numberOfLines={2}>{jobData!.title}</Text>
                </View>

                <View style={s.confirmRow}>
                  <Text style={s.confirmLabel}>Skills Needed</Text>
                  <View style={s.skillBadgesRow}>
                    {displaySkillNames().map((name, i) => (
                      <View key={i} style={s.skillBadge}>
                        <Text style={s.skillBadgeText}>{name}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                <View style={s.confirmRow}>
                  <Text style={s.confirmLabel}>Job Type</Text>
                  <View style={[s.typeBadge, { backgroundColor: jobTypeColor(jobData!.urgency, jobData!.scheduled_at) + '22' }]}>
                    <Text style={[s.typeBadgeText, { color: jobTypeColor(jobData!.urgency, jobData!.scheduled_at) }]}>
                      {jobTypeLabel(jobData!.urgency, jobData!.scheduled_at)}
                    </Text>
                  </View>
                </View>

                <View style={s.confirmRow}>
                  <Text style={s.confirmLabel}>When</Text>
                  <Text style={s.confirmValue}>{formatScheduledAt(jobData!.scheduled_at)}</Text>
                </View>

                {/* Service mode — On-site vs Remote (no physical location/
                    distance matching at all, e.g. hiring a developer). Hidden
                    for a direct booking (target provider already fixed by
                    location/profession before this modal ever opened). */}
                {!targetProvider && (
                  <>
                    <View style={s.confirmRow}>
                      <Text style={s.confirmLabel}>Service Type</Text>
                      <View style={s.radiusChips}>
                        <TouchableOpacity
                          style={[s.radiusChip, serviceMode === 'ON_SITE' && s.radiusChipActive]}
                          onPress={() => handleServiceModeChange('ON_SITE')}
                          disabled={phase !== 'confirm'}
                        >
                          <Text style={[s.radiusChipText, serviceMode === 'ON_SITE' && s.radiusChipTextActive]}>On-site</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[s.radiusChip, serviceMode === 'REMOTE' && s.radiusChipActive]}
                          onPress={() => handleServiceModeChange('REMOTE')}
                          disabled={phase !== 'confirm'}
                        >
                          <Text style={[s.radiusChipText, serviceMode === 'REMOTE' && s.radiusChipTextActive]}>Remote</Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    {serviceMode === 'REMOTE' && (
                      <Text style={s.confirmDesc}>No location needed — matched by skill and availability, wherever the provider is.</Text>
                    )}
                  </>
                )}

                {!!jobData!.description && (
                  <Text style={s.confirmDesc}>{jobData!.description}</Text>
                )}

                {/* Photos & videos */}
                <View style={s.photoSection}>
                  <Text style={s.confirmLabel}>Photos & videos (optional)</Text>
                  <View style={s.photoRow}>
                    {photos.map((p, i) => (
                      <View key={i} style={s.photoThumb}>
                        {p.type === 'video' ? (
                          // No thumbnail-generation library wired up — a plain
                          // Image can't render a video URI (would just show a
                          // broken-image icon), so a dark placeholder + play
                          // glyph reads as "video" instead of "broken photo."
                          <View style={[s.photoImg, s.photoVideoPlaceholder]}>
                            <Play size={20} color="#fff" fill="#fff" />
                          </View>
                        ) : (
                          <Image source={{ uri: p.uri }} style={s.photoImg} />
                        )}
                        <TouchableOpacity
                          style={s.photoRemove}
                          onPress={() => setPhotos(prev => prev.filter((_, idx) => idx !== i))}
                        >
                          <X size={12} color="#fff" />
                        </TouchableOpacity>
                      </View>
                    ))}
                    {photos.length < 5 && (
                      <>
                        <TouchableOpacity style={s.photoAdd} onPress={() => pickPhoto('camera')}>
                          <Camera size={18} color={C.muted} />
                        </TouchableOpacity>
                        <TouchableOpacity style={s.photoAdd} onPress={() => pickPhoto('gallery')}>
                          <ImageIcon size={18} color={C.muted} />
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                </View>

                {/* Inspection fee — held in escrow at hire, paid out once the
                    provider inspects on-site, before any invoice. Nothing in
                    this voice flow asked for this before, so every voice-
                    posted job silently defaulted to $0 and hiring always
                    skipped the PaymentSheet. */}
                <View style={s.radiusRow}>
                  <Text style={s.confirmLabel}>Inspection Fee</Text>
                  <View style={s.feeInputRow}>
                    <Text style={s.feeInputPrefix}>$</Text>
                    <TextInput
                      style={s.feeInput}
                      placeholder="0"
                      placeholderTextColor="#9CA3AF"
                      keyboardType="decimal-pad"
                      value={inspectionFeeInput}
                      onChangeText={setInspectionFeeInput}
                      editable={phase === 'confirm'}
                      onFocus={scrollConfirmToFocusedInput}
                    />
                  </View>
                </View>

                {/* Radius — hidden for direct bookings */}
                {!targetProvider && (
                  <View style={s.radiusRow}>
                    <Text style={s.confirmLabel}>Search Radius</Text>
                    <View style={s.radiusChips}>
                      {[25, 50, 100, 250].map(mi => (
                        <TouchableOpacity
                          key={mi}
                          style={[s.radiusChip, radiusMi === mi && s.radiusChipActive]}
                          onPress={() => setRadiusMi(mi)}
                          disabled={phase !== 'confirm'}
                        >
                          <Text style={[s.radiusChipText, radiusMi === mi && s.radiusChipTextActive]}>
                            {mi} mi
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}
              </View>

            </ScrollView>

            {/* Fixed footer */}
            {phase === 'confirm' && (
              <View style={s.confirmFooter}>
                <TouchableOpacity style={s.cancelBtn} onPress={cancelConfirm}>
                  <Text style={s.cancelBtnText}>Start over</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.postBtn} onPress={doPostJob}>
                  <Text style={s.postBtnText}>Post Job →</Text>
                </TouchableOpacity>
              </View>
            )}
            {(phase === 'posting' || phase === 'success') && (
              <View style={s.confirmFooterCenter}>
                {phase === 'posting' ? (
                  <Text style={s.postingText}>Posting your job…</Text>
                ) : (
                  <View style={s.successRow}>
                    <CheckCircle size={20} color="#10B981" />
                    <Text style={s.successText}>Matched with nearby pros!</Text>
                  </View>
                )}
              </View>
            )}
          </>
        ) : (
          // ── VOICE CONVERSATION UI ─────────────────────────────────────────
          <>
            {/* Address chip */}
            {address ? (
              <View style={s.addressChip}>
                <Text style={s.addressText} numberOfLines={1}>📍 {address}</Text>
              </View>
            ) : null}

            {/* Chat bubbles */}
            <ScrollView ref={scrollRef} style={s.chat} contentContainerStyle={s.chatContent} showsVerticalScrollIndicator={false}>
              {messages.map((m, i) => (
                <View key={i} style={m.role === 'user' ? s.bubbleWrapUser : s.bubbleWrapAI}>
                  <View style={[s.bubble, m.role === 'user' ? s.bubbleUser : s.bubbleAI]}>
                    <Text style={[s.bubbleText, m.role === 'user' ? s.bubbleTextUser : s.bubbleTextAI]}>
                      {m.content}
                    </Text>
                  </View>
                  {m.isComingSoon && (
                    <View style={s.comingSoonChip}>
                      <Text style={s.comingSoonText}>🔜 Coming Soon — try a similar service below!</Text>
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>

            {/* ── AI Character ─────────────────────────────────────────── */}
            <View style={s.charArea}>

              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => {
                  if (phase === 'speaking') {
                    Speech.stop();
                    setPhase('idle');
                    setTimeout(() => { if (phaseRef.current === 'idle') startListening(); }, 300);
                  }
                }}
              >
              <View style={s.charStack}>

                <RNAnimated.View style={[s.charFace, {
                  transform: [{ scale: charScale }],
                  // Shell (base/shadow/border/glow) stays the same blue-lavender
                  // tint across every phase — only the rotating blades and
                  // speaking-state equalizer bars carry the warm color shift.
                  shadowColor: '#7C3AED',
                  shadowOpacity: 0.7,
                  // A near-white fill needs a defined edge against this
                  // modal's own white background — the colored glow shadow
                  // alone isn't a crisp enough boundary on every device.
                  borderWidth: 1,
                  borderColor: 'rgba(124,58,237,0.2)',
                }]}>
                  {/* Ghost-white glass sphere — light, airy base (matches the
                      rest of this modal's white chrome instead of sitting as
                      a dark hole in it) with genuine depth via a soft radial
                      shade + a lower-right form shadow, 3 color blades
                      rotating around center, a warm core glow at the
                      convergence point, and a crisp specular highlight
                      upper-left for the lit-pearl read. */}
                  <Svg width={CHAR_SIZE} height={CHAR_SIZE} style={StyleSheet.absoluteFillObject}>
                    <Defs>
                      <RadialGradient id="charBase" cx="50%" cy="50%" r="72%">
                        <Stop offset="0%" stopColor="#FFFFFF" />
                        <Stop offset="60%" stopColor="#F5F4FB" />
                        <Stop offset="100%" stopColor="#E8E6F5" />
                      </RadialGradient>
                      <RadialGradient id="charFormShadow" cx="72%" cy="76%" r="55%">
                        <Stop offset="0%" stopColor="#8B86B8" stopOpacity={0.35} />
                        <Stop offset="100%" stopColor="#8B86B8" stopOpacity={0} />
                      </RadialGradient>
                      <RadialGradient id="blade1" cx="50%" cy="85%" r="90%">
                        <Stop offset="0%" stopColor={bladeColors[0]} stopOpacity={0.85} />
                        <Stop offset="100%" stopColor={bladeColors[0]} stopOpacity={0} />
                      </RadialGradient>
                      <RadialGradient id="blade2" cx="50%" cy="85%" r="90%">
                        <Stop offset="0%" stopColor={bladeColors[1]} stopOpacity={0.85} />
                        <Stop offset="100%" stopColor={bladeColors[1]} stopOpacity={0} />
                      </RadialGradient>
                      <RadialGradient id="blade3" cx="50%" cy="85%" r="90%">
                        <Stop offset="0%" stopColor={bladeColors[2]} stopOpacity={0.85} />
                        <Stop offset="100%" stopColor={bladeColors[2]} stopOpacity={0} />
                      </RadialGradient>
                      <RadialGradient id="charSpark" cx="50%" cy="50%" r="55%">
                        <Stop offset="0%" stopColor="#FFF8E1" stopOpacity={0.9} />
                        <Stop offset="100%" stopColor="#FFF8E1" stopOpacity={0} />
                      </RadialGradient>
                      <RadialGradient id="charGlassHighlight" cx="30%" cy="22%" r="22%">
                        <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.95} />
                        <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
                      </RadialGradient>
                    </Defs>

                    <Circle cx="50%" cy="50%" r="50%" fill="url(#charBase)" />
                    <Circle cx="50%" cy="50%" r="50%" fill="url(#charFormShadow)" />

                    <AnimatedG origin={`${BLADE_CENTER}, ${BLADE_CENTER}`} rotation={blade1Rot.interpolate({ inputRange: [0, 1], outputRange: [0, 360] })}>
                      <Ellipse cx={BLADE_CENTER} cy={BLADE_CY} rx={BLADE_RX} ry={BLADE_RY} fill="url(#blade1)" />
                    </AnimatedG>
                    <AnimatedG origin={`${BLADE_CENTER}, ${BLADE_CENTER}`} rotation={blade2Rot.interpolate({ inputRange: [0, 1], outputRange: [120, 480] })}>
                      <Ellipse cx={BLADE_CENTER} cy={BLADE_CY} rx={BLADE_RX} ry={BLADE_RY} fill="url(#blade2)" />
                    </AnimatedG>
                    <AnimatedG origin={`${BLADE_CENTER}, ${BLADE_CENTER}`} rotation={blade3Rot.interpolate({ inputRange: [0, 1], outputRange: [240, 600] })}>
                      <Ellipse cx={BLADE_CENTER} cy={BLADE_CY} rx={BLADE_RX} ry={BLADE_RY} fill="url(#blade3)" />
                    </AnimatedG>

                    <Circle cx="50%" cy="50%" r="18%" fill="url(#charSpark)" />
                    <Circle cx="50%" cy="50%" r="50%" fill="url(#charGlassHighlight)" />
                  </Svg>

                  {phase === 'speaking' && (
                    <View style={s.faceWave}>
                      {bars.map((bar, i) => (
                        <RNAnimated.View
                          key={i}
                          style={[s.waveBar, { height: bar, backgroundColor: waveColorAt(i / (bars.length - 1)) }]}
                        />
                      ))}
                    </View>
                  )}

                  {phase === 'processing' && (
                    <View style={s.thinkDots}>
                      {[0, 1, 2].map(i => (
                        <View key={i} style={[s.thinkDot, { opacity: 0.4 + i * 0.3 }]} />
                      ))}
                    </View>
                  )}
                </RNAnimated.View>

              </View>
              </TouchableOpacity>

              <Text style={s.statusText}>
                {phase === 'idle'       && 'Tap mic to speak'}
                {phase === 'listening'  && 'Listening… pause to send'}
                {phase === 'processing' && 'Thinking…'}
                {phase === 'speaking'   && 'Dodorez is speaking…'}
              </Text>
              {phase === 'speaking' && (
                <Text style={s.interruptHint}>Tap the orb to interrupt</Text>
              )}
            </View>

            {/* ── Error box ──────────────────────────────────────────────── */}
            {phase === 'error' && (
              <View style={s.errorBox}>
                <View style={s.errorIconWrap}>
                  <AlertTriangle size={22} color="#FFCE48" />
                </View>
                <Text style={s.errorText}>{errorMsg}</Text>
                <View style={s.errorActions}>
                  {isPermDenied ? (
                    <TouchableOpacity style={s.retryBtn} onPress={() => Linking.openSettings()}>
                      <Text style={s.retryText}>Open Settings</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={s.retryBtn} onPress={handleRetry}>
                      <Text style={s.retryText}>Try Again</Text>
                    </TouchableOpacity>
                  )}
                  {onFallbackToManual && (
                    <TouchableOpacity style={s.typeBtn}
                      onPress={() => { onClose(); setTimeout(onFallbackToManual!, 300); }}>
                      <Text style={s.typeText}>Fill Manually</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}

            {/* ── Coming-soon decision buttons ────────────────────────────── */}
            {showAlternativeActions && phase === 'idle' && (
              <View style={s.altActionsRow}>
                <TouchableOpacity style={s.altYesBtn} onPress={handleBookAlternative} activeOpacity={0.85}>
                  <Text style={s.altYesBtnText}>✅ Yes, book it!</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.altNoBtn} onPress={handleDeclineAlternative} activeOpacity={0.85}>
                  <Text style={s.altNoBtnText}>❌ No thanks</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Diagnosis confirmation — mandatory accuracy checkpoint ──── */}
            {showDiagnosisConfirm && (phase === 'idle' || phase === 'listening') && (
              <View style={s.altActionsRow}>
                <TouchableOpacity style={s.altYesBtn} onPress={handleDiagnosisConfirm} activeOpacity={0.85}>
                  <Text style={s.altYesBtnText}>✅ Yes, that's right</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.altNoBtn} onPress={handleDiagnosisClarify} activeOpacity={0.85}>
                  <Text style={s.altNoBtnText}>🔄 Let me clarify</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── In-conversation photo prompt ─────────────────────────────── */}
            {showPhotoPrompt && (phase === 'idle' || phase === 'listening') && (
              <View style={s.altActionsRow}>
                <TouchableOpacity style={s.altYesBtn} onPress={handlePhotoPromptAdd} activeOpacity={0.85}>
                  <Text style={s.altYesBtnText}>📷 Add a photo</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.altNoBtn} onPress={handlePhotoPromptSkip} activeOpacity={0.85}>
                  <Text style={s.altNoBtnText}>⏭ Skip for now</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Bottom mic controls ─────────────────────────────────────── */}
            {(phase === 'idle' || phase === 'listening') && (
              <View style={[s.bottomRow, { paddingBottom: Math.max(insets.bottom, 12) + 24 }]}>
                <TouchableOpacity
                  style={[s.micBtn, phase === 'listening' && s.micBtnActive]}
                  onPress={phase === 'listening' ? () => stopAndTranscribe(true) : startListening}
                  activeOpacity={0.8}
                >
                  {phase === 'listening'
                    ? <Square size={16} color="#fff" fill="#fff" />
                    : <Mic size={16} color="#000" />}
                  <Text style={[s.micLabel, phase === 'listening' && s.micLabelActive]}>
                    {phase === 'listening' ? 'Tap to send' : 'Tap to speak'}
                  </Text>
                </TouchableOpacity>

                {onFallbackToManual && (
                  <TouchableOpacity style={s.manualFallback}
                    onPress={() => { onClose(); setTimeout(onFallbackToManual!, 300); }}>
                    <Text style={s.manualFallbackText}>Type instead →</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </>
        )}

      </View>
    </Modal>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
function formatScheduledAt(iso: string | null): string {
  if (!iso) return 'ASAP';
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
  } catch { return iso; }
}

function jobTypeLabel(urgency: string, scheduledAt: string | null): string {
  if (urgency === 'EMERGENCY' || urgency === 'HIGH') return 'Urgent';
  if (scheduledAt) return 'Book Slot';
  return 'Normal';
}

function jobTypeColor(urgency: string, scheduledAt: string | null): string {
  if (urgency === 'EMERGENCY') return '#EF4444';
  if (urgency === 'HIGH') return '#F97316';
  if (scheduledAt) return '#6366F1';
  return '#10B981';
}

// ── Theme tokens ───────────────────────────────────────────────────────────
const DARK = {
  bg: '#0A0A0A', surface: '#111827', surface2: '#1F2937', border: '#374151',
  text: '#F9FAFB', muted: '#9CA3AF',
  userBubbleBg: '#FFCE48', userBubbleText: '#111827',
  aiBubbleBg: '#1F2937', aiBubbleText: '#F9FAFB',
  charFace: '#0F1020', charBorder: '#2D2D50',
  eyeColor: '#FFCE48', rippleColor: '#FFCE48',
};
const LIGHT = {
  bg: '#FFFFFF', surface: '#F9FAFB', surface2: '#F3F4F6', border: '#E5E7EB',
  text: '#111827', muted: '#6B7280',
  userBubbleBg: '#FFCE48', userBubbleText: '#111827',
  aiBubbleBg: '#F3F4F6', aiBubbleText: '#111827',
  charFace: '#1A1A2E', charBorder: '#3D3D6B',
  eyeColor: '#FFCE48', rippleColor: '#6366F1',
};
type Colors = typeof DARK;

function makeStyles(C: Colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: C.bg, paddingTop: 48 },

    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 10 },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    headerDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFCE48' },
    headerTitle: { fontSize: 20, fontFamily: Fonts.poppinsBold, color: C.text },
    closeBtn: { padding: 8 },

    addressChip: { marginHorizontal: 20, marginBottom: 8, backgroundColor: C.surface2, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, alignSelf: 'flex-start' },
    addressText: { fontSize: 12, fontFamily: Fonts.poppins, color: C.muted },

    chat: { flex: 1, paddingHorizontal: 20 },
    chatContent: { paddingVertical: 8, gap: 10 },

    bubbleWrapAI: { alignItems: 'flex-start', gap: 4 },
    bubbleWrapUser: { alignItems: 'flex-end', gap: 4 },
    bubble: { maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
    bubbleAI: { backgroundColor: C.aiBubbleBg, borderBottomLeftRadius: 4 },
    bubbleUser: { backgroundColor: C.userBubbleBg, borderBottomRightRadius: 4 },
    bubbleText: { fontSize: 15, fontFamily: Fonts.poppins, lineHeight: 22 },
    bubbleTextAI: { color: C.aiBubbleText },
    bubbleTextUser: { color: C.userBubbleText },
    comingSoonChip: {
      flexDirection: 'row' as const, alignItems: 'center' as const,
      backgroundColor: '#FEF3C7', borderRadius: 12,
      paddingHorizontal: 10, paddingVertical: 5,
      borderWidth: 1, borderColor: '#FDE68A',
    },
    comingSoonText: { fontSize: 12, fontFamily: Fonts.poppinsSemiBold, color: '#92400E' },

    // ── Character ─────────────────────────────────────────────────────────
    charArea: { alignItems: 'center', justifyContent: 'center', paddingVertical: 24, gap: 14 },
    // Just the sphere — no decorative rings/arcs around it (Siri/HomePod
    // reference is a single clean glowing orb, nothing orbiting it).
    charStack: {
      width: CHAR_SIZE, height: CHAR_SIZE,
      alignItems: 'center', justifyContent: 'center',
    },
    charFace: {
      width: CHAR_SIZE, height: CHAR_SIZE, borderRadius: CHAR_SIZE / 2,
      overflow: 'hidden',
      alignItems: 'center', justifyContent: 'center',
      shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.7, shadowRadius: 32, elevation: 16, gap: 10,
    },
    faceWave: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, height: BAR_MAX },
    waveBar: { width: 4, borderRadius: 2 },
    thinkDots: { flexDirection: 'row', gap: 10 },
    thinkDot: { width: 11, height: 11, borderRadius: 5.5, backgroundColor: 'rgba(124,58,237,0.6)' },
    postSpinner: { width: 36, height: 36, borderRadius: 18, borderWidth: 3, borderColor: '#FFCE48', borderTopColor: 'transparent' },
    statusText: { fontSize: 13, fontFamily: Fonts.poppins, color: C.muted, textAlign: 'center' },
    interruptHint: { fontSize: 11, fontFamily: Fonts.poppins, color: C.muted, textAlign: 'center', opacity: 0.6, marginTop: -8 },

    // ── Full-screen confirm ───────────────────────────────────────────────
    fullConfirmScroll: { flex: 1 },
    fullConfirmContent: { paddingHorizontal: 20, paddingBottom: 20 },
    confirmHero: { alignItems: 'center', paddingVertical: 32, gap: 10 },
    confirmOrbSmall: {
      width: 96, height: 96, borderRadius: 48,
      overflow: 'hidden',
      backgroundColor: '#F8F8FF', borderWidth: 1, borderColor: 'rgba(124,58,237,0.2)',
      alignItems: 'center', justifyContent: 'center',
      shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.35, shadowRadius: 18, elevation: 10,
    },
    confirmHeroTitle: { fontSize: 22, fontFamily: Fonts.poppinsBold, color: C.text },
    confirmHeroSub: { fontSize: 14, fontFamily: Fonts.poppins, color: C.muted, textAlign: 'center', paddingHorizontal: 24 },
    confirmCard: { backgroundColor: C.surface, borderRadius: 20, padding: 18, borderWidth: 1, borderColor: C.border, gap: 12 },
    confirmRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
    confirmFooter: {
      flexDirection: 'row', gap: 12,
      paddingHorizontal: 20, paddingBottom: 36, paddingTop: 14,
      borderTopWidth: 1, borderTopColor: C.border,
      backgroundColor: C.bg,
    },
    confirmFooterCenter: {
      alignItems: 'center', justifyContent: 'center',
      paddingVertical: 20, paddingBottom: 36,
      borderTopWidth: 1, borderTopColor: C.border,
    },
    postingText: { fontSize: 15, fontFamily: Fonts.poppins, color: C.muted },
    successRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
    successText: { fontSize: 15, fontFamily: Fonts.poppinsBold, color: '#10B981' },
    confirmLabel: { fontSize: 13, fontFamily: Fonts.poppins, color: C.muted },
    confirmValue: { fontSize: 14, fontFamily: Fonts.poppinsBold, color: C.text, flexShrink: 1, textAlign: 'right' },
    confirmDesc: { fontSize: 13, fontFamily: Fonts.poppins, color: C.muted, fontStyle: 'italic' },

    directBanner: { backgroundColor: '#FFF3CD', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#FFCE48' },
    directBannerText: { fontSize: 13, fontFamily: Fonts.poppinsSemiBold, color: '#92400E', textAlign: 'center' },
    skillBadgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end', flex: 1 },
    skillBadge: { backgroundColor: '#EFF6FF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
    skillBadgeText: { fontSize: 12, fontFamily: Fonts.poppinsBold, color: '#1D4ED8' },
    typeBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
    typeBadgeText: { fontSize: 13, fontFamily: Fonts.poppinsBold },

    // Photos
    photoSection: { gap: 8 },
    photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    photoThumb: { width: 64, height: 64, borderRadius: 10, overflow: 'hidden' },
    photoImg: { width: '100%', height: '100%' },
    photoVideoPlaceholder: { backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
    photoRemove: { position: 'absolute', top: 2, right: 2, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, padding: 2 },
    photoAdd: { width: 64, height: 64, borderRadius: 10, borderWidth: 1.5, borderColor: C.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2 },

    radiusRow: { gap: 8 },
    feeInputRow: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: C.surface2, borderRadius: 12,
      borderWidth: 1, borderColor: C.border,
      paddingHorizontal: 14, height: 44,
    },
    feeInputPrefix: { fontSize: 15, fontFamily: Fonts.poppinsBold, color: C.text, marginRight: 4 },
    feeInput: {
      flex: 1, fontSize: 15, fontFamily: Fonts.poppinsBold, color: C.text, height: '100%',
      textAlignVertical: 'center', paddingVertical: 0, includeFontPadding: false,
    },
    radiusChips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    radiusChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2 },
    radiusChipActive: { borderColor: '#FFCE48', backgroundColor: '#FFCE48' },
    radiusChipText: { fontSize: 13, fontFamily: Fonts.poppins, color: C.muted },
    radiusChipTextActive: { color: '#111827', fontFamily: Fonts.poppinsBold },

    cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
    cancelBtnText: { fontSize: 14, fontFamily: Fonts.poppins, color: C.muted },
    postBtn: { flex: 2, paddingVertical: 12, borderRadius: 14, backgroundColor: '#FFCE48', alignItems: 'center' },
    postBtnDisabled: { opacity: 0.4 },
    postBtnText: { fontSize: 14, fontFamily: Fonts.poppinsBold, color: '#111827' },

    // ── Error ─────────────────────────────────────────────────────────────
    errorBox: { marginHorizontal: 20, marginBottom: 10, backgroundColor: '#1A1A2E', borderRadius: 20, padding: 20, alignItems: 'center', gap: 12, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 12, elevation: 8 },
    errorIconWrap: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#2A2A42', justifyContent: 'center', alignItems: 'center' },
    errorText: { fontSize: 13.5, fontFamily: Fonts.poppins, color: '#CBD5E1', textAlign: 'center', lineHeight: 20 },
    errorActions: { flexDirection: 'row', gap: 10, marginTop: 2 },
    retryBtn: { backgroundColor: '#FFCE48', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 24 },
    retryText: { fontSize: 14, fontFamily: Fonts.poppinsBold, color: '#111827' },
    typeBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 24, borderWidth: 1, borderColor: '#334155' },
    typeText: { fontSize: 14, fontFamily: Fonts.poppins, color: '#94A3B8' },
    // Coming-soon Yes / No decision row
    altActionsRow: { flexDirection: 'row' as const, gap: 10, marginHorizontal: 20, marginBottom: 10 },
    altYesBtn: { flex: 1, backgroundColor: '#10B981', paddingVertical: 12, borderRadius: 16, alignItems: 'center' as const },
    altYesBtnText: { fontSize: 15, fontFamily: Fonts.poppinsBold, color: '#fff' },
    altNoBtn: { flex: 1, backgroundColor: C.surface2, paddingVertical: 12, borderRadius: 16, alignItems: 'center' as const, borderWidth: 1, borderColor: C.border },
    altNoBtnText: { fontSize: 15, fontFamily: Fonts.poppinsBold, color: C.text },

    // ── Bottom ────────────────────────────────────────────────────────────
    bottomRow: { paddingHorizontal: 20, paddingBottom: 36, paddingTop: 8, gap: 10, alignItems: 'center' },
    micBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFCE48', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 24, elevation: 4, shadowColor: '#FFCE48', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 8 },
    micBtnActive: { backgroundColor: '#4338CA', shadowColor: '#4338CA' },
    micLabel: { fontSize: 14, fontFamily: Fonts.poppinsBold, color: '#000' },
    micLabelActive: { color: '#fff' },
    manualFallback: { paddingVertical: 6 },
    manualFallbackText: { fontSize: 13, fontFamily: Fonts.poppins, color: C.muted },
  });
}
