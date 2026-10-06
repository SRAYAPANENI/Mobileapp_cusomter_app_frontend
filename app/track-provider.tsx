import { useAppAlert } from '@/components/app-alert';
import { CancelJobModal } from '@/components/cancel-job-modal';
import { DisputeModal } from '@/components/dispute-modal';
import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SkoFyApi, BASE_URL, TokenStore, getFreshAccessToken } from '@/services/api';
import { kmToMiles } from '@/services/units';
import { GOOGLE_PLACES_API_KEY } from '@/services/google-places';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ChevronLeft,
  LocateFixed,
  MessageCircle,
  Phone,
  ShieldCheck,
  Star,
  Trash2,
  Navigation
} from 'lucide-react-native';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Dimensions,
  Linking,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, { SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RatingModal, RatingDimensions } from '@/components/ui/rating-modal';
import { markRatingSkipped } from '@/services/ratingReminders';
import { CheckoutSheet } from '@/components/checkout-sheet';
import { useHirePayment } from '@/hooks/use-hire-payment';

// Map imports handled dynamically to prevent crashes and web errors
let MapView: any;
let Marker: any;
let Polyline: any;
let PROVIDER_GOOGLE: any;

if (Platform.OS !== 'web') {
  try {
    const maps = require('react-native-maps');
    MapView = maps.default;
    Marker = maps.Marker;
    Polyline = maps.Polyline;
    PROVIDER_GOOGLE = maps.PROVIDER_GOOGLE;
  } catch (e) {
    console.log('Maps library not found or failed to load');
  }
}

const { width, height } = Dimensions.get('window');

const TRACK_POLL_INTERVAL_MS = 2000;
const ANIM_TICK_MS = 50; // ~20fps — smooth enough for a slow-moving marker, cheap on battery
const ROUTE_REFETCH_KM = 0.3; // only re-fetch route when provider moves this far

const WS_BASE = BASE_URL
  .replace(/^https:\/\//, 'wss://')
  .replace(/^http:\/\//, 'ws://');

type LatLng = { latitude: number; longitude: number };

function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = (b.latitude - a.latitude) * Math.PI / 180;
  const dLon = (b.longitude - a.longitude) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * Math.PI / 180) * Math.cos(b.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function decodePolyline(encoded: string): LatLng[] {
  const coords: LatLng[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b: number, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;
    shift = result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;
    coords.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return coords;
}

function routeDistanceMi(coords: LatLng[]): number {
  let km = 0;
  for (let i = 1; i < coords.length; i++) km += haversineKm(coords[i - 1], coords[i]);
  return kmToMiles(km);
}

// ── Smoothing / snapping / dead-reckoning helpers ────────────────────────────

const EMA_ALPHA = 0.3; // 30% new reading, 70% history — balances lag vs jitter

function emaSmooth(prev: LatLng | null, next: LatLng): LatLng {
  if (!prev) return next;
  return {
    latitude: prev.latitude + EMA_ALPHA * (next.latitude - prev.latitude),
    longitude: prev.longitude + EMA_ALPHA * (next.longitude - prev.longitude),
  };
}

function closestPointOnSegment(p: LatLng, a: LatLng, b: LatLng): LatLng {
  const dx = b.longitude - a.longitude;
  const dy = b.latitude - a.latitude;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return a;
  const t = Math.max(0, Math.min(1,
    ((p.longitude - a.longitude) * dx + (p.latitude - a.latitude) * dy) / lenSq,
  ));
  return { latitude: a.latitude + t * dy, longitude: a.longitude + t * dx };
}

// Snap point to the nearest segment on route — only if within 50 m of it.
// Prevents the marker cutting through buildings while the route is loaded.
function snapToRoute(point: LatLng, route: LatLng[]): LatLng {
  if (route.length < 2) return point;
  let best = point;
  let bestDist = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const snapped = closestPointOnSegment(point, route[i], route[i + 1]);
    const d = haversineKm(point, snapped);
    if (d < bestDist) { bestDist = d; best = snapped; }
  }
  return bestDist < 0.05 ? best : point;
}

// Extrapolate position using last known speed (m/s) and heading (°CW from N).
// Used when the next GPS fix hasn't arrived yet — keeps the marker moving.
function deadReckon(from: LatLng, speedMs: number, headingDeg: number, elapsedSec: number): LatLng {
  const headingRad = (headingDeg * Math.PI) / 180;
  const distanceM = Math.min(speedMs * elapsedSec, 100); // cap: avoid runaway
  const distanceDeg = distanceM / 111320;
  const cosLat = Math.cos(from.latitude * Math.PI / 180);
  return {
    latitude: from.latitude + distanceDeg * Math.cos(headingRad),
    longitude: from.longitude + (cosLat > 0.001 ? distanceDeg * Math.sin(headingRad) / cosLat : 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

async function fetchRoute(origin: LatLng, dest: LatLng): Promise<{ coords: LatLng[]; durationMins: number | null; distanceMi: number | null }> {
  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.latitude},${origin.longitude}&destination=${dest.latitude},${dest.longitude}&mode=driving&key=${GOOGLE_PLACES_API_KEY}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.status && json.status !== 'OK') {
      console.warn('[Directions API] status:', json.status, json.error_message ?? '');
    }
    const encoded = json?.routes?.[0]?.overview_polyline?.points;
    const leg = json?.routes?.[0]?.legs?.[0];
    const durationMins = leg ? Math.ceil(leg.duration.value / 60) : null;
    const distanceMi = leg ? leg.distance.value / 1609.34 : null;
    if (encoded) return { coords: decodePolyline(encoded), durationMins, distanceMi };
  } catch (e) {
    console.warn('[Directions API] fetch error:', e);
  }
  return { coords: [origin, dest], durationMins: null, distanceMi: null };
}

interface TrackedProvider {
  id: string;
  name: string;
  role: string;
  rating: number;
  image: string | null;
  phone: string;
}

const STATUS_LABELS: Record<string, string> = {
  POSTED: 'Waiting for provider',
  DISTRIBUTED: 'Waiting for provider',
  ACCEPTED: 'On the way',
  INSPECTING: 'Inspecting the job',
  INVOICE_PENDING: 'Invoice ready',
  IN_PROGRESS: 'Working',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  DISPUTED: 'Disputed',
};

export default function TrackProviderScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const appAlert = useAppAlert();
  const insets = useSafeAreaInsets();

  const mapRef = useRef<any>(null);
  // KeyboardAvoidingView's 'position'/'height' behaviors weren't reliably
  // clearing the keyboard for the counter-offer input on real devices —
  // scrolling straight to the focused input on its own focus event is more
  // direct and doesn't depend on that working correctly.
  const bottomSheetScrollRef = useRef<ScrollView>(null);
  const scrollToFocusedInput = () => {
    setTimeout(() => bottomSheetScrollRef.current?.scrollToEnd({ animated: true }), 150);
  };
  const wsRef = useRef<WebSocket | null>(null);
  const hasShownCompletionRef = useRef(false);
  const hasShownCancellationRef = useRef(false);
  const isFollowingRef = useRef(false);
  const lastFollowTickRef = useRef(0);
  // Marker animation: glide from the last rendered point to the latest poll
  // result over the poll interval, instead of snapping straight to it.
  const animFromRef = useRef<LatLng | null>(null);
  const animToRef = useRef<LatLng | null>(null);
  const animStartTimeRef = useRef(0);
  const currentPosRef = useRef<LatLng | null>(null);
  const lastRouteFetchLocRef = useRef<LatLng | null>(null);
  const fullRouteCoordsRef = useRef<LatLng[]>([]);
  const emaLocRef = useRef<LatLng | null>(null);
  const speedRef = useRef(0);    // m/s — last known from provider
  const headingRef = useRef(0);  // degrees clockwise from north
  const jobStatusRef = useRef('ACCEPTED');
  const lastWsLocRef = useRef(0); // Date.now() of last WS location message
  const etaBaseRef = useRef<number | null>(null);  // minutes, last known from Directions API or backend
  const etaSetAtRef = useRef<number>(0);            // Date.now() when etaBaseRef was set
  const [polledLoc, setPolledLoc] = useState<LatLng | null>(null);
  const [routeCoords, setRouteCoords] = useState<LatLng[]>([]);
  const [provider, setProvider] = useState<TrackedProvider | null>(null);
  const [destination, setDestination] = useState<{ latitude: number; longitude: number } | null>(null);
  const [providerLoc, setProviderLoc] = useState<LatLng | null>(null);
  const [eta, setEta] = useState('—');
  const [distance, setDistance] = useState('—');
  const [jobStatus, setJobStatus] = useState('ACCEPTED');
  // On-site inspection + invoice — bidding is retired, so the real job cost
  // is only ever set here, after the provider inspects in person.
  const [inspectionFeeStatus, setInspectionFeeStatus] = useState<'PENDING_CAPTURE' | 'HELD' | 'FAILED' | null>(null);
  const [inspectionOtp, setInspectionOtp] = useState<{ otp: string | null; expires_in_seconds: number | null }>({ otp: null, expires_in_seconds: null });
  // Pickup & Drop — the customer isn't physically at the pickup point (it's
  // a store), so the OTP card above can't apply to this job kind; a photo of
  // what was picked up substitutes for it instead.
  const [jobKind, setJobKind] = useState<'STANDARD' | 'PICKUP_DROPOFF'>('STANDARD');
  const [pickupPhotoUrl, setPickupPhotoUrl] = useState<string | null>(null);
  const [pickupConfirmedAt, setPickupConfirmedAt] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<any>(null);
  const [payingFee, setPayingFee] = useState(false);
  const [respondingToInvoice, setRespondingToInvoice] = useState(false);
  const [showCounterInput, setShowCounterInput] = useState(false);
  const [counterAmountInput, setCounterAmountInput] = useState('');
  const { payInspectionFee, payInvoice } = useHirePayment();
  const [mapError, setMapError] = useState(!MapView);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  // Set when the job is permanently gone/inaccessible (404/403) — usually a
  // stale notification tap landing here after the job was cancelled/expired.
  // Without this, the screen just silently sits there with default
  // placeholder data (jobStatus stays 'ACCEPTED', provider stays null)
  // forever, with no indication anything is wrong.
  const [jobGone, setJobGone] = useState(false);
  const status = STATUS_LABELS[jobStatus] ?? jobStatus;

  useEffect(() => { jobStatusRef.current = jobStatus; }, [jobStatus]);

  // Count ETA down every second so it never freezes between poll/Directions updates
  useEffect(() => {
    const id = setInterval(() => {
      const status = jobStatusRef.current;
      if (status === 'IN_PROGRESS' || status === 'COMPLETED' || etaBaseRef.current == null) return;
      const elapsedMins = (Date.now() - etaSetAtRef.current) / 60000;
      const remaining = Math.max(0, Math.round(etaBaseRef.current - elapsedMins));
      setEta(`${remaining} min${remaining === 1 ? '' : 's'}`);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Central location update handler — applies EMA smoothing, route snapping,
  // then feeds the animation system. Called from both WS and HTTP poll paths.
  const applyLocation = useCallback((raw: LatLng, speed?: number, heading?: number) => {
    const smoothed = emaSmooth(emaLocRef.current, raw);
    emaLocRef.current = smoothed;
    const shouldSnap = jobStatusRef.current === 'ACCEPTED' && fullRouteCoordsRef.current.length >= 2;
    const final = shouldSnap ? snapToRoute(smoothed, fullRouteCoordsRef.current) : smoothed;
    if (speed != null && speed >= 0) speedRef.current = speed;
    if (heading != null && heading >= 0) headingRef.current = heading;
    setPolledLoc(final);
    animFromRef.current = currentPosRef.current ?? final;
    animToRef.current = final;
    animStartTimeRef.current = Date.now();
  }, []);

  // One-time: who's coming, and where they're headed
  useEffect(() => {
    if (!jobId) return;
    SkoFyApi.jobs.get(jobId).then((j: any) => {
      if (j.assigned_provider) {
        setProvider({
          id: j.assigned_provider.provider_id,
          name: j.assigned_provider.name,
          role: j.assigned_provider.profession ?? 'Service Provider',
          rating: j.assigned_provider.avg_rating ?? 0,
          image: j.assigned_provider.profile_image_url ?? null,
          phone: j.assigned_provider.phone ?? '',
        });
      }
      if (j.lat != null && j.lng != null) {
        setDestination({ latitude: j.lat, longitude: j.lng });
      }
      setJobStatus(j.status);
      setJobKind(j.job_type === 'PICKUP_DROPOFF' ? 'PICKUP_DROPOFF' : 'STANDARD');
      setPickupPhotoUrl(j.pickup_photo_url ?? null);
      setPickupConfirmedAt(j.pickup_confirmed_at ?? null);
    }).catch((err) => {
      console.error('Failed to fetch job/provider details for tracking:', err);
      if (err?.error_code === 'NOT_FOUND' || err?.error_code === 'FORBIDDEN') {
        setJobGone(true);
      }
    });
  }, [jobId]);

  // WebSocket: receive provider location in real-time (<200ms vs 2s HTTP poll)
  // Auto-reconnects with exponential backoff (1s→2s→4s→…→30s) so a network
  // hiccup or brief app-background doesn't permanently kill the live feed.
  useEffect(() => {
    if (!jobId) return;
    let closed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 1000;

    const connect = async () => {
      if (closed) return;
      const token = await getFreshAccessToken();
      if (!token || closed) return;
      ws = new WebSocket(`${WS_BASE}/ws/jobs/${jobId}`);
      wsRef.current = ws;

      ws.onopen = () => {
        // Must be the first message — the server holds the connection
        // unauthenticated until this arrives (see ws.py).
        ws?.send(JSON.stringify({ type: 'auth', token }));
        reconnectDelay = 1000; // reset backoff on successful connect
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'location' && msg.lat != null && msg.lng != null) {
            lastWsLocRef.current = Date.now();
            applyLocation(
              { latitude: msg.lat, longitude: msg.lng },
              msg.speed ?? undefined,
              msg.heading ?? undefined,
            );
          }
        } catch {}
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (closed) return;
        // HTTP polling keeps location flowing during the gap; reconnect in background
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 30000);
          connect();
        }, reconnectDelay);
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      wsRef.current = null;
    };
  }, [jobId]);

  // Repeated: live provider location, distance, ETA
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const t = await SkoFyApi.tracking.track(jobId);
        if (cancelled) return;
        setJobStatus(t.job_status);
        // Use HTTP location when WS is down OR when WS is open but has gone
        // silent (provider killed app — WS stays connected to backend but no
        // messages arrive). 3 s without a WS location = treat as stale.
        const wsStale = Date.now() - lastWsLocRef.current > 3000;
        if (t.provider_lat != null && t.provider_lng != null &&
            (wsRef.current?.readyState !== WebSocket.OPEN || wsStale)) {
          applyLocation({ latitude: t.provider_lat, longitude: t.provider_lng }, undefined, t.heading ?? undefined);
        }
        if (t.job_status === 'IN_PROGRESS' || t.job_status === 'COMPLETED') {
          setDistance('0 mi');
          setEta(t.job_status === 'COMPLETED' ? 'Completed' : 'Arrived');
          etaBaseRef.current = null;
        } else if (t.eta_minutes != null) {
          // Seed the countdown timer; 1s interval ticks it down from here
          etaBaseRef.current = t.eta_minutes;
          etaSetAtRef.current = Date.now();
          // Show backend distance as fallback until route segments load
          if (fullRouteCoordsRef.current.length < 2 && t.distance_km != null) {
            setDistance(`${kmToMiles(t.distance_km).toFixed(1)} mi`);
          }
        } else if (t.provider_lat != null && t.provider_lng != null && t.destination_lat != null && t.destination_lng != null) {
          // No ETA from backend at all — derive rough estimate from haversine + 25 km/h
          const distKm = haversineKm(
            { latitude: t.provider_lat, longitude: t.provider_lng },
            { latitude: t.destination_lat, longitude: t.destination_lng },
          );
          const etaMins = Math.max(1, Math.round(distKm / 25 * 60));
          etaBaseRef.current = etaMins;
          etaSetAtRef.current = Date.now();
          if (fullRouteCoordsRef.current.length < 2) setDistance(`${kmToMiles(distKm).toFixed(1)} mi`);
        }
        // Pick up the provider completing the job from their own app, not just
        // the customer tapping "Mark as Completed" here.
        if (t.job_status === 'COMPLETED' && !hasShownCompletionRef.current) {
          hasShownCompletionRef.current = true;
          setIsCompleted(true);
          setShowRatingModal(true);
        }
        // Pick up the provider cancelling from their own app — they need
        // to see why, not just find themselves bounced back silently.
        if (t.job_status === 'CANCELLED' && !hasShownCancellationRef.current) {
          hasShownCancellationRef.current = true;
          appAlert.show(
            'warning',
            'Job Cancelled',
            t.cancellation_reason
              ? `The provider cancelled this job. Reason: ${t.cancellation_reason}\n\nYou can view your job in My Jobs or post a new requirement.`
              : 'The provider cancelled this job.\n\nYou can view your job in My Jobs or post a new requirement.',
            [{ text: 'View My Jobs', onPress: () => router.replace('/my-jobs' as any) }],
          );
        }
        // The provider cancelled but other applicants were already in the
        // pool — the job goes back to DISTRIBUTED (not CANCELLED) so the
        // customer can hire someone else, but there's no longer anyone to
        // track here, so bounce them to the applicants list instead.
        if (t.job_status === 'DISTRIBUTED' && !hasShownCancellationRef.current) {
          hasShownCancellationRef.current = true;
          appAlert.show(
            'warning',
            'Provider Cancelled',
            'Your provider cancelled this job, but other applicants are still available. Pick one to continue.',
            [{ text: 'View Applicants', onPress: () => router.replace({ pathname: '/applicants', params: { jobId: jobId ?? '' } } as any) }],
          );
        }
      } catch (err: any) {
        // A transient poll miss should keep showing last known values, not
        // crash the screen — but NOT_FOUND/FORBIDDEN mean the job itself is
        // gone (deleted, or no longer this customer's), which no amount of
        // retrying will fix.
        if (err?.error_code === 'NOT_FOUND' || err?.error_code === 'FORBIDDEN') {
          setJobGone(true);
        }
      }
    };

    poll();
    const interval = setInterval(poll, TRACK_POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [jobId]);

  // On-site inspection + invoice — separate, lower-frequency poll (the
  // lightweight /track endpoint above doesn't carry this data). Only runs
  // while it's actually relevant, not once the job is under way.
  useEffect(() => {
    if (!jobId) return;
    if (!['ACCEPTED', 'INSPECTING', 'INVOICE_PENDING'].includes(jobStatus)) return;
    let cancelled = false;

    const poll = async () => {
      try {
        if (jobStatus === 'ACCEPTED') {
          const feeStatus = await SkoFyApi.payments.getStatus(jobId, 'INSPECTION_FEE').catch(() => null);
          if (!cancelled && feeStatus) setInspectionFeeStatus(feeStatus.status as any);
          if (jobKind === 'PICKUP_DROPOFF') {
            // No OTP for this job kind (the customer isn't at the pickup
            // point) — poll the job itself for the pickup-confirmation photo.
            const job = await SkoFyApi.jobs.get(jobId).catch(() => null);
            if (!cancelled && job) {
              setPickupPhotoUrl((job as any).pickup_photo_url ?? null);
              setPickupConfirmedAt((job as any).pickup_confirmed_at ?? null);
            }
          } else {
            // The OTP only ever exists in Redis while the job is still
            // ACCEPTED — verify_inspection_otp deletes it the instant it's
            // checked, before flipping status to INSPECTING. Polling for it
            // only once status reaches INSPECTING (the old code) was asking
            // for something already gone, so the customer never saw it.
            const otpResult = await SkoFyApi.jobs.getInspectionOtp(jobId).catch(() => null);
            if (!cancelled && otpResult) setInspectionOtp(otpResult);
          }
        }
        if (jobStatus === 'INVOICE_PENDING') {
          const job = await SkoFyApi.jobs.get(jobId).catch(() => null);
          if (!cancelled && job) setInvoice((job as any)?.invoice ?? null);
        }
      } catch {
        // transient — keep showing last known values
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [jobId, jobStatus, jobKind]);

  const handlePayInspectionFee = async () => {
    if (!jobId) return;
    setPayingFee(true);
    try {
      const result = await payInspectionFee(jobId);
      if (result.status === 'success') {
        setInspectionFeeStatus('HELD');
      } else if (result.status === 'pending') {
        appAlert.show('warning', 'Still Processing', result.message);
      } else if (result.status === 'error') {
        appAlert.show('error', 'Payment Failed', result.message);
      }
    } finally {
      setPayingFee(false);
    }
  };

  // The provider accepting the customer's counter-offer resolves the invoice
  // to ACCEPTED asynchronously (a provider-side action, picked up here via
  // polling) — distinct from the customer tapping "Accept & Pay" directly,
  // which pays inline within handleRespondToInvoice below. Without this, a
  // customer who countered had no way to actually pay once accepted.
  const handlePayAcceptedInvoice = () => {
    if (!jobId) return;
    setShowCheckout(true);
  };

  // Paying always goes through the checkout sheet, where the customer can
  // apply an offer/promo code first. Errors keep the sheet open to retry.
  const payFromCheckout = async (offerCode: string | null) => {
    if (!jobId) return;
    const payResult = await payInvoice(jobId, offerCode ?? undefined);
    if (payResult.status === 'success') {
      setShowCheckout(false);
      setJobStatus('IN_PROGRESS');
    } else if (payResult.status === 'pending') {
      setShowCheckout(false);
      appAlert.show('warning', 'Still Processing', payResult.message);
    } else if (payResult.status === 'error') {
      appAlert.show('error', 'Payment Failed', payResult.message);
    }
  };

  const handleRespondToInvoice = async (action: 'ACCEPT' | 'REJECT' | 'COUNTER') => {
    if (!jobId) return;
    if (action === 'COUNTER') {
      const amount = parseFloat(counterAmountInput);
      if (!amount || amount <= 0) {
        appAlert.show('error', 'Invalid Amount', 'Enter a valid counter-offer amount.');
        return;
      }
      setRespondingToInvoice(true);
      try {
        await SkoFyApi.jobs.respondToInvoice(jobId, 'COUNTER', amount);
        setShowCounterInput(false);
        setCounterAmountInput('');
        appAlert.show('success', 'Counter-Offer Sent', 'Waiting for the provider to respond.');
      } catch (err: any) {
        appAlert.show('error', 'Failed to Send', err?.message ?? 'Please try again.');
      } finally {
        setRespondingToInvoice(false);
      }
      return;
    }

    setRespondingToInvoice(true);
    try {
      await SkoFyApi.jobs.respondToInvoice(jobId, action);
      if (action === 'REJECT') {
        appAlert.show('warning', 'Invoice Rejected', 'This job has been cancelled.', [
          { text: 'OK', onPress: () => router.replace('/my-jobs' as any) },
        ]);
        return;
      }
      // ACCEPT — go to checkout (offers / promo code, then pay).
      setShowCheckout(true);
    } catch (err: any) {
      appAlert.show('error', 'Failed', err?.message ?? 'Please try again.');
    } finally {
      setRespondingToInvoice(false);
    }
  };

  // Glide the marker smoothly toward the latest poll result instead of
  // snapping to it — if a new result arrives mid-glide, redirect from
  // wherever the dot currently is rather than jumping back to the old start.
  useEffect(() => {
    const tick = () => {
      if (!animToRef.current) return;
      if (!animFromRef.current) {
        currentPosRef.current = animToRef.current;
        setProviderLoc(animToRef.current);
        return;
      }
      const elapsed = Date.now() - animStartTimeRef.current;
      const progress = elapsed / TRACK_POLL_INTERVAL_MS;
      let point: LatLng;
      if (progress < 1) {
        // Glide toward the latest confirmed GPS fix
        point = {
          latitude: animFromRef.current.latitude + (animToRef.current.latitude - animFromRef.current.latitude) * progress,
          longitude: animFromRef.current.longitude + (animToRef.current.longitude - animFromRef.current.longitude) * progress,
        };
      } else {
        // Dead reckoning: keep moving in last known direction while waiting
        // for the next GPS fix. Only extrapolate if actually moving (>0.5 m/s).
        // Cap at 5 s of extrapolation so the marker doesn't drift far on stale data.
        const extraSec = Math.min((elapsed - TRACK_POLL_INTERVAL_MS) / 1000, 5);
        point = speedRef.current > 0.5
          ? deadReckon(animToRef.current, speedRef.current, headingRef.current, extraSec)
          : animToRef.current;
      }
      currentPosRef.current = point;
      setProviderLoc(point);
    };
    const interval = setInterval(tick, ANIM_TICK_MS);
    return () => clearInterval(interval);
  }, []);

  // Each poll: trim the route so the blue line always starts at the provider's
  // current position (Google Maps style), and re-fetch the full route only
  // when the provider moves significantly.
  useEffect(() => {
    if (!polledLoc || !destination || jobStatus === 'IN_PROGRESS' || jobStatus === 'COMPLETED') return;

    // Trim existing route: find nearest point to provider, slice from there
    const full = fullRouteCoordsRef.current;
    if (full.length >= 2) {
      let minIdx = 0, minDist = Infinity;
      for (let i = 0; i < full.length; i++) {
        const d = haversineKm(polledLoc, full[i]);
        if (d < minDist) { minDist = d; minIdx = i; }
      }
      const trimmed = [polledLoc, ...full.slice(minIdx + 1)];
      setRouteCoords(trimmed);
      // Live distance from remaining road segments — updates on every location fix
      const liveMi = routeDistanceMi(trimmed);
      if (liveMi > 0) setDistance(`${liveMi.toFixed(1)} mi`);
    }

    // Re-fetch full route from Directions API when provider moves 0.3km
    const last = lastRouteFetchLocRef.current;
    if (last && haversineKm(last, polledLoc) < ROUTE_REFETCH_KM) return;
    lastRouteFetchLocRef.current = polledLoc;
    fetchRoute(polledLoc, destination).then(({ coords, durationMins, distanceMi }) => {
      fullRouteCoordsRef.current = coords;
      setRouteCoords(coords);
      // Seed ETA countdown from Directions API (accounts for traffic/roads)
      if (durationMins != null) {
        etaBaseRef.current = durationMins;
        etaSetAtRef.current = Date.now();
      }
      // Road distance from API is more accurate than haversine sum — use it
      if (distanceMi != null) setDistance(`${distanceMi.toFixed(1)} mi`);
    });
  }, [polledLoc, destination, jobStatus]);

  // Auto-follow the provider — keep both the provider and destination visible
  useEffect(() => {
    if (!polledLoc || !destination || !mapRef.current) return;
    const latDelta = Math.abs(polledLoc.latitude - destination.latitude) * 1.6 + 0.008;
    const lngDelta = Math.abs(polledLoc.longitude - destination.longitude) * 1.6 + 0.008;
    mapRef.current.animateToRegion({
      latitude: (polledLoc.latitude + destination.latitude) / 2,
      longitude: (polledLoc.longitude + destination.longitude) / 2,
      latitudeDelta: latDelta,
      longitudeDelta: lngDelta,
    }, 800);
  }, [polledLoc]);

  // Camera follow — locks onto the provider icon when follow mode is active
  useEffect(() => {
    if (!isFollowingRef.current || !providerLoc || !mapRef.current) return;
    const now = Date.now();
    if (now - lastFollowTickRef.current < 100) return;
    lastFollowTickRef.current = now;
    mapRef.current.animateToRegion(
      { ...providerLoc, latitudeDelta: 0.003, longitudeDelta: 0.003 },
      80,
    );
  }, [providerLoc]);

  const handleLocateMe = () => {
    isFollowingRef.current = true;
    setIsFollowing(true);
    if (providerLoc && mapRef.current) {
      mapRef.current.animateToRegion(
        { ...providerLoc, latitudeDelta: 0.003, longitudeDelta: 0.003 },
        600,
      );
    }
  };

  const handleMapDrag = () => {
    if (isFollowingRef.current) {
      isFollowingRef.current = false;
      setIsFollowing(false);
    }
  };

  const [isFollowing, setIsFollowing] = useState(false);
  const [isCancelModalVisible, setIsCancelModalVisible] = useState(false);

  const handleCancelHire = () => {
    setIsCancelModalVisible(true);
  };

  const handleJobCancelled = (message: string) => {
    setIsCancelModalVisible(false);
    // The status poll below also watches for job_status === 'CANCELLED' and
    // shows its own alert for provider-initiated cancellations — without
    // this, a customer-initiated cancel here would trip both, stacking two
    // "Job Cancelled" popups back to back.
    hasShownCancellationRef.current = true;
    const reopened = message.toLowerCase().includes('other applicant');
    appAlert.show(
      reopened ? 'success' : 'warning',
      reopened ? 'Other Applicants Available' : 'Job Cancelled',
      message,
      [{ text: 'OK', onPress: () => router.back() }],
    );
  };

  const [isDisputeModalVisible, setIsDisputeModalVisible] = useState(false);

  const handleJobDisputed = (message: string) => {
    setIsDisputeModalVisible(false);
    appAlert.show('success', 'Dispute Filed', message, [{ text: 'OK', onPress: () => router.back() }]);
  };

  const handleRatingSubmit = async (ratings: RatingDimensions, comment: string) => {
    if (!jobId) throw new Error('Missing job reference.');
    // Throws on failure — RatingModal awaits this and shows the error
    // inline instead of silently closing as if it succeeded.
    await SkoFyApi.jobs.submitReview(jobId, { ...ratings, comment });
  };

  const handleRatingModalClose = () => {
    setShowRatingModal(false);
    router.replace('/(tabs)/home' as any);
  };

  const handleCompleteJob = async () => {
    if (!jobId) return;
    try {
      await SkoFyApi.jobs.complete(jobId);
      setJobStatus('COMPLETED');
      hasShownCompletionRef.current = true;
      setIsCompleted(true);
      setShowRatingModal(true);
    } catch {
      // leave status as-is so the user can retry
    }
  };

  const handleCallProvider = () => {
    // This used to dial the provider's raw phone number through the device's
    // native dialer — switched to the in-app VoIP call so it actually goes
    // through our calling system (push notifications, call logs, etc.).
    if (!jobId || !provider) return;
    router.push({
      pathname: '/chat' as any,
      params: {
        jobId,
        name: provider.name,
        profession: provider.role,
        profileImage: provider.image ?? undefined,
        autoCall: 'true',
      },
    });
  };

  const renderMap = () => {
    if (mapError || !MapView) {
      return (
        <View style={[styles.map, { backgroundColor: themeColors.inputFilled, justifyContent: 'center', alignItems: 'center' }]}>
          <Image
            source={require('@/assets/images/logo-mark.png')}
            style={{ width: 100, height: 100, opacity: 0.2 }}
            contentFit="contain"
          />
          <ThemedText style={{ marginTop: 20, color: themeColors.textSecondary }}>Map View Unavailable</ThemedText>
          <ThemedText style={{ fontSize: 12, color: themeColors.textMuted }}>Please restart app to reload native modules</ThemedText>
        </View>
      );
    }

    if (!destination) {
      return (
        <View style={[styles.map, { backgroundColor: themeColors.inputFilled, justifyContent: 'center', alignItems: 'center' }]}>
          <ThemedText style={{ color: themeColors.textSecondary }}>Loading job details…</ThemedText>
        </View>
      );
    }

    const region = providerLoc
      ? { latitude: (providerLoc.latitude + destination.latitude) / 2, longitude: (providerLoc.longitude + destination.longitude) / 2, latitudeDelta: 0.02, longitudeDelta: 0.02 }
      : { ...destination, latitudeDelta: 0.01, longitudeDelta: 0.01 };

    return (
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={region}
        onPanDrag={handleMapDrag}
        onError={() => setMapError(true)}
      >
        {/* Road Route (Blue polyline) */}
        {routeCoords.length >= 2 && (
          <Polyline
            coordinates={routeCoords}
            strokeWidth={6}
            strokeColor="#2563EB"
          />
        )}

        {/* Destination pin — a real native Marker using the `image` prop, not
            `children`. `image` renders through the platform's native
            icon-setting path, not the view-to-bitmap snapshot pipeline
            `children` goes through — that pipeline turned out to be
            unreliable in this release build for ANY custom content (a
            remote photo, plain Text/emoji, all of it). Being a real native
            Marker also means it stays perfectly locked to the map during
            zoom/pan, unlike a JS-projected overlay (which is what this used
            to be, and which is why it used to swim during a pinch-zoom
            gesture). Static content, so no rotation/heading needed here —
            just the vehicle icon below has that. */}
        {destination && (
          <Marker
            coordinate={destination}
            image={require('@/assets/images/destination-pin.png')}
            anchor={{ x: 0.5, y: 1.0 }}
          />
        )}

        {/* Provider vehicle icon — same reasoning as the destination pin
            above. `rotation` + `flat` let the native layer keep the icon
            pointed the right way as the map itself rotates/tilts/zooms,
            with no JS animation code needed on our side for that part.
            The ETA pill that used to float near this icon was dropped
            entirely — it needed live-changing text, which can't be a
            reliable native Marker (no static image can show that) and
            couldn't be a reliable JS overlay either (swims during zoom).
            The bottom sheet's "Arriving in / X min" already shows the same
            information without either problem. */}
        {providerLoc && (
          <Marker
            coordinate={providerLoc}
            image={require('@/assets/images/provider-marker.png')}
            anchor={{ x: 0.5, y: 0.5 }}
            rotation={headingRef.current}
            flat
          />
        )}
      </MapView>
    );
  };

  if (jobGone) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 40, gap: 16 }]}>
        <StatusBar barStyle="dark-content" />
        <ThemedText style={{ fontSize: 16, color: '#6B7280', textAlign: 'center' }}>
          This job is no longer available — it may have been completed, cancelled, or already closed out.
        </ThemedText>
        <TouchableOpacity
          style={{ backgroundColor: '#FFCE48', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 }}
          onPress={() => router.replace('/my-jobs' as any)}
        >
          <ThemedText style={{ fontWeight: '700', color: '#111827' }}>Go to My Jobs</ThemedText>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />

      {renderMap()}

      {/* Locate / Follow Button */}
      <View style={styles.locateMeContainer}>
        <TouchableOpacity
          style={[styles.locateMeButton, isFollowing && styles.locateMeButtonActive]}
          onPress={handleLocateMe}
        >
          <LocateFixed size={22} color={isFollowing ? '#fff' : '#000'} />
        </TouchableOpacity>
      </View>

      {/* Header Overlay */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={24} color="#000" />
        </TouchableOpacity>
        <View style={styles.statusPill}>
          <ThemedText style={styles.statusText}>{status}</ThemedText>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {/* Bottom Sheet Info */}
      {/* bottomSheet is position:'absolute' pinned to the screen bottom —
          Android's default keyboard resize doesn't reliably push an
          absolutely-positioned element like this above the keyboard, which
          is why the counter-offer input (deep in this sheet) was getting
          covered. KeyboardAvoidingView's 'position' behavior (iOS) / 'height'
          (Android) explicitly translates/resizes this wrapper by the
          keyboard's height instead of relying on that. */}
      <KeyboardAvoidingView
        style={styles.bottomSheetKeyboardWrapper}
        behavior="padding"
      >
      <Animated.View
        entering={SlideInDown.duration(600)}
        style={[styles.bottomSheet, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 40 : 24) + 12 }]}
      >
        <ScrollView ref={bottomSheetScrollRef} showsVerticalScrollIndicator={false} bounces={false} keyboardShouldPersistTaps="handled">
          {/* Arrival Time */}
          <View style={styles.arrivalRow}>
            <View>
              <ThemedText style={styles.arrivingLabel}>Arriving in</ThemedText>
              <ThemedText style={styles.etaText}>{eta}</ThemedText>
            </View>
            <View style={styles.distanceBadge}>
              <ThemedText style={styles.distanceText}>{distance}</ThemedText>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Provider Profile — tap to view their full profile (work proof,
              reviews) read-only; hiring isn't offered here since they're
              already hired for this job. */}
          <TouchableOpacity
            style={styles.providerRow}
            activeOpacity={0.7}
            disabled={!provider}
            onPress={() => provider && router.push({
              pathname: '/provider-details' as any,
              params: { id: provider.id, providerId: provider.id, jobId: jobId ?? '', viewOnly: 'true' },
            })}
          >
            <Image source={provider?.image ? { uri: provider.image } : require('@/assets/images/icon-mark.png')} style={styles.avatar} />
            <View style={styles.providerInfo}>
              <ThemedText style={styles.providerName}>{provider?.name ?? 'Provider'}</ThemedText>
              <View style={styles.ratingRow}>
                <ThemedText style={styles.roleText}>{provider?.role ?? ''}</ThemedText>
                <View style={styles.dot} />
                <Star size={12} color="#F59E0B" fill="#F59E0B" />
                <ThemedText style={styles.ratingText}>{(provider?.rating ?? 0).toFixed(1)}</ThemedText>
              </View>
            </View>
            <View style={styles.shieldBadge}>
              <ShieldCheck size={16} color="#10B981" />
            </View>
          </TouchableOpacity>

          {/* Actions */}
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.callButton} onPress={handleCallProvider}>
              <Phone size={20} color="#000" />
              <ThemedText style={styles.actionBtnText}>Call</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.callButton, styles.msgButton]}
              onPress={() => provider && router.push({
                pathname: '/chat',
                params: { jobId: jobId ?? '', id: provider.id, name: provider.name, profileImage: provider.image ?? '', profession: provider.role }
              })}
            >
              <MessageCircle size={20} color="#fff" />
              <ThemedText style={[styles.actionBtnText, { color: '#fff' }]}>Chat</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleCancelHire}
            >
              <Trash2 size={20} color="#EF4444" />
            </TouchableOpacity>
          </View>

          {/* Inspection fee — pay right after hiring, before the provider
              can request the on-site inspection OTP. */}
          {jobStatus === 'ACCEPTED' && inspectionFeeStatus !== 'HELD' && (
            <View style={styles.inspectionCard}>
              <ThemedText style={styles.inspectionCardTitle}>Pay Visiting Fee</ThemedText>
              <ThemedText style={styles.inspectionCardBody}>
                Pay the visiting fee so your provider can start inspecting the job once they arrive.
              </ThemedText>
              <TouchableOpacity
                style={styles.completeJobBtn}
                onPress={handlePayInspectionFee}
                disabled={payingFee}
              >
                <ThemedText style={styles.completeJobBtnText}>{payingFee ? 'Processing…' : 'Pay Now'}</ThemedText>
              </TouchableOpacity>
            </View>
          )}
          {/* On-site inspection code — only exists in Redis while the job is
              still ACCEPTED (verify_inspection_otp deletes it the instant
              it's checked, before the status flips to INSPECTING), so this
              must show here and not once the job reaches INSPECTING —
              by then the code is already consumed and gone. Doesn't apply to
              Pickup & Drop — the customer isn't at the pickup point to hand
              over a code, see the pickup-photo card below instead. */}
          {jobStatus === 'ACCEPTED' && jobKind !== 'PICKUP_DROPOFF' && inspectionFeeStatus === 'HELD' && inspectionOtp.otp && (
            <View style={styles.otpCard}>
              <View style={styles.otpCardHeader}>
                <View style={styles.otpIconBadge}>
                  <ShieldCheck size={16} color="#111827" />
                </View>
                <ThemedText style={styles.otpCardTitle}>Give this code to your provider</ThemedText>
              </View>
              <View style={styles.otpDigitsRow}>
                {inspectionOtp.otp.split('').map((digit, idx) => (
                  <View key={idx} style={styles.otpDigitBox}>
                    <ThemedText style={styles.otpDigitText}>{digit}</ThemedText>
                  </View>
                ))}
              </View>
              <ThemedText style={styles.inspectionCardBody}>
                Your provider needs this code to start inspecting the job.
              </ThemedText>
            </View>
          )}
          {jobStatus === 'ACCEPTED' && jobKind !== 'PICKUP_DROPOFF' && inspectionFeeStatus === 'HELD' && !inspectionOtp.otp && (
            <View style={styles.inspectionCard}>
              <ThemedText style={styles.inspectionCardBody}>
                Waiting for your provider to arrive and start the inspection.
              </ThemedText>
            </View>
          )}

          {/* Pickup & Drop — proof of pickup substitutes for the OTP flow
              above (the customer isn't physically at the pickup point). */}
          {jobStatus === 'ACCEPTED' && jobKind === 'PICKUP_DROPOFF' && inspectionFeeStatus === 'HELD' && pickupConfirmedAt && (
            <View style={styles.inspectionCard}>
              <ThemedText style={styles.inspectionCardTitle}>Picked up ✓</ThemedText>
              {pickupPhotoUrl && (
                <Image source={{ uri: pickupPhotoUrl }} style={styles.pickupPhoto} contentFit="cover" />
              )}
              <ThemedText style={styles.inspectionCardBody}>
                Your provider has picked up your order and will deliver it shortly.
              </ThemedText>
            </View>
          )}
          {jobStatus === 'ACCEPTED' && jobKind === 'PICKUP_DROPOFF' && inspectionFeeStatus === 'HELD' && !pickupConfirmedAt && (
            <View style={styles.inspectionCard}>
              <ThemedText style={styles.inspectionCardBody}>
                Waiting for your provider to arrive and confirm pickup.
              </ThemedText>
            </View>
          )}

          {jobStatus === 'INSPECTING' && (
            <View style={styles.inspectionCard}>
              <ThemedText style={styles.inspectionCardTitle}>Inspection in progress</ThemedText>
              <ThemedText style={styles.inspectionCardBody}>
                Your provider is inspecting the job on-site.
              </ThemedText>
            </View>
          )}

          {/* Invoice — the real price, set only after inspection. */}
          {jobStatus === 'INVOICE_PENDING' && invoice && (
            <View style={styles.inspectionCard}>
              <ThemedText style={styles.inspectionCardTitle}>
                {invoice.status === 'COUNTERED' ? 'Waiting for provider…'
                  : invoice.status === 'COUNTER_REJECTED' ? 'Original Price Offered'
                  : invoice.status === 'ACCEPTED' ? 'Invoice Accepted'
                  : 'Invoice Ready'}
              </ThemedText>
              <ThemedText style={styles.invoiceAmount}>
                {/* final_amount is the one authoritative settled number once
                    resolved — whether that's the original invoice.amount or
                    a counter-offer the provider accepted. Falls back to
                    counter_amount/amount only while still unresolved. */}
                $ {Number(
                  invoice.final_amount ?? (invoice.status === 'COUNTERED' ? invoice.counter_amount : invoice.amount)
                ).toFixed(2)}
              </ThemedText>
              {invoice.materials?.length > 0 && (
                <View style={{ marginBottom: 8 }}>
                  {invoice.materials.map((m: any, idx: number) => (
                    <ThemedText key={idx} style={styles.inspectionCardBody}>
                      • {m.name} × {m.quantity} (${m.unit_cost}/ea)
                    </ThemedText>
                  ))}
                </View>
              )}
              {invoice.notes && <ThemedText style={styles.inspectionCardBody}>{invoice.notes}</ThemedText>}

              {invoice.status === 'PENDING' && !showCounterInput && (
                // Primary action gets its own full-width row; Counter/Reject
                // as compact secondary text buttons below. The previous
                // 3-across row squeezed "Reject" into cancelButton — a fixed
                // 56x56 circular icon button designed for a trash icon, not
                // a text label — clipping/wrapping the word inside it.
                <View style={{ marginTop: 8, gap: 8 }}>
                  <TouchableOpacity
                    style={[styles.completeJobBtn, { marginTop: 0 }]}
                    onPress={() => handleRespondToInvoice('ACCEPT')}
                    disabled={respondingToInvoice}
                  >
                    <ThemedText style={styles.completeJobBtnText}>Accept & Pay</ThemedText>
                  </TouchableOpacity>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      style={styles.invoiceSecondaryBtn}
                      onPress={() => setShowCounterInput(true)}
                      disabled={respondingToInvoice}
                    >
                      <ThemedText style={styles.invoiceSecondaryBtnText}>Counter</ThemedText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.invoiceSecondaryBtn, { backgroundColor: '#FEF2F2', borderColor: '#FEE2E2' }]}
                      onPress={() => handleRespondToInvoice('REJECT')}
                      disabled={respondingToInvoice}
                    >
                      <ThemedText style={[styles.invoiceSecondaryBtnText, { color: '#EF4444' }]}>Reject</ThemedText>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {invoice.status === 'COUNTER_REJECTED' && (
                // The provider declined the one counter-offer — the original
                // amount (already what's shown above, since it's not
                // 'COUNTERED') is back on the table. No Counter option here:
                // the one-round cap was already spent on the earlier attempt.
                <View style={{ marginTop: 8, gap: 8 }}>
                  <ThemedText style={styles.inspectionCardBody}>
                    Your provider declined your offer. Pay the original price to proceed, or cancel.
                  </ThemedText>
                  <TouchableOpacity
                    style={[styles.completeJobBtn, { marginTop: 0 }]}
                    onPress={() => handleRespondToInvoice('ACCEPT')}
                    disabled={respondingToInvoice}
                  >
                    <ThemedText style={styles.completeJobBtnText}>Accept & Pay</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.invoiceSecondaryBtn, { backgroundColor: '#FEF2F2', borderColor: '#FEE2E2' }]}
                    onPress={() => handleRespondToInvoice('REJECT')}
                    disabled={respondingToInvoice}
                  >
                    <ThemedText style={[styles.invoiceSecondaryBtnText, { color: '#EF4444' }]}>Reject & Cancel Job</ThemedText>
                  </TouchableOpacity>
                </View>
              )}

              {invoice.status === 'PENDING' && showCounterInput && (
                <View style={{ marginTop: 8 }}>
                  <TextInput
                    style={[styles.counterInput, { fontWeight: '700', fontSize: 17 }]}
                    placeholder="Your offer ($)"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="numeric"
                    value={counterAmountInput}
                    onChangeText={setCounterAmountInput}
                    onFocus={scrollToFocusedInput}
                  />
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    {/* completeJobBtn is 48px tall with its own marginTop:16;
                        callButton is 56px with none — mismatched heights and
                        an offset only one of them had was why these two never
                        actually lined up in the same row. Both now share one
                        explicit height/margin regardless of their base styles. */}
                    <TouchableOpacity
                      style={[styles.completeJobBtn, { flex: 1, height: 52, marginTop: 0 }]}
                      onPress={() => handleRespondToInvoice('COUNTER')}
                      disabled={respondingToInvoice}
                    >
                      <ThemedText style={styles.completeJobBtnText}>Send Offer</ThemedText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.callButton, { flex: 1, height: 52 }]}
                      onPress={() => setShowCounterInput(false)}
                    >
                      <ThemedText style={styles.actionBtnText}>Cancel</ThemedText>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {invoice.status === 'COUNTERED' && (
                <ThemedText style={styles.inspectionCardBody}>
                  You offered ${invoice.counter_amount} — waiting for the provider to respond.
                </ThemedText>
              )}

              {invoice.status === 'ACCEPTED' && (
                <>
                  <ThemedText style={styles.inspectionCardBody}>
                    {invoice.counter_amount != null
                      ? 'Your provider accepted your counter-offer — pay now to start the job.'
                      : 'Pay now to start the job.'}
                  </ThemedText>
                  <TouchableOpacity
                    style={[styles.completeJobBtn, { marginTop: 8 }]}
                    onPress={handlePayAcceptedInvoice}
                    disabled={respondingToInvoice}
                  >
                    <ThemedText style={styles.completeJobBtnText}>
                      {respondingToInvoice ? 'Processing…' : 'Pay Now'}
                    </ThemedText>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {/* Mark as Completed Button */}
          {!isCompleted && jobStatus === 'IN_PROGRESS' && (
            <TouchableOpacity
              style={styles.completeJobBtn}
              onPress={handleCompleteJob}
            >
              <ThemedText style={styles.completeJobBtnText}>Mark as Completed</ThemedText>
            </TouchableOpacity>
          )}

          {/* Backend only accepts a dispute for IN_PROGRESS or COMPLETED —
              a job still Open/Accepted/Inspecting has nothing to dispute yet
              (cancel is the right action there instead). */}
          {(jobStatus === 'IN_PROGRESS' || isCompleted) && (
            <TouchableOpacity
              style={styles.reportIssueBtn}
              onPress={() => setIsDisputeModalVisible(true)}
            >
              <ThemedText style={styles.reportIssueBtnText}>Report an Issue</ThemedText>
            </TouchableOpacity>
          )}
        </ScrollView>
      </Animated.View>
      </KeyboardAvoidingView>

      {jobId && (
        <CheckoutSheet
          visible={showCheckout}
          jobId={jobId}
          onPay={payFromCheckout}
          onClose={() => setShowCheckout(false)}
        />
      )}

      <RatingModal
        visible={showRatingModal}
        providerName={provider?.name ?? 'Provider'}
        onClose={handleRatingModalClose}
        onSubmit={handleRatingSubmit}
        onSkip={() => {
          if (jobId) markRatingSkipped(jobId);
          handleRatingModalClose();
        }}
      />

      {jobId && (
        <CancelJobModal
          visible={isCancelModalVisible}
          jobId={jobId}
          // The provider being physically on-site actively inspecting is a
          // materially different situation from just having been hired and
          // being en route — "already on their way" read as flatly wrong
          // once they'd actually arrived and started working, and gave no
          // indication that cancelling now means an in-person trip for
          // nothing rather than just a turn-around.
          scenario={jobStatus === 'INSPECTING' || jobStatus === 'INVOICE_PENDING' ? 'inspecting' : 'after-hire'}
          onClose={() => setIsCancelModalVisible(false)}
          onCancelled={handleJobCancelled}
        />
      )}
      {jobId && (
        <DisputeModal
          visible={isDisputeModalVisible}
          jobId={jobId}
          onClose={() => setIsDisputeModalVisible(false)}
          onDisputed={handleJobDisputed}
        />
      )}
      {appAlert.element}
    </View>
  );
}

function makeStyles(t: typeof Colors.light) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: t.card },
  map: { ...StyleSheet.absoluteFillObject },
  header: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 10,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.card,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 4,
  },
  statusPill: {
    backgroundColor: t.card,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 4,
  },
  statusText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  bottomSheetKeyboardWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  bottomSheet: {
    maxHeight: height * 0.65,
    backgroundColor: t.card,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 10,
  },
  arrivalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  arrivingLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
  },
  etaText: {
    fontSize: 24,
    lineHeight: 30,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  distanceBadge: {
    backgroundColor: t.inputFilled,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  distanceText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  divider: {
    height: 1,
    backgroundColor: t.inputFilled,
    marginBottom: 20,
  },
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: t.inputFilled,
  },
  providerInfo: {
    flex: 1,
    marginLeft: 16,
  },
  providerName: {
    fontSize: 18,
    lineHeight: 24,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  roleText: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.border,
  },
  ratingText: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  shieldBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ECFDF5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 16,
  },
  callButton: {
    flex: 1,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFCE48',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    shadowColor: '#FFCE48',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  msgButton: {
    backgroundColor: '#111827',
    shadowColor: '#000',
  },
  actionBtnText: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: Fonts.poppinsBold,
    color: '#000',
  },
  locateMeContainer: {
    position: 'absolute',
    // Was pinned a fixed 300px from the screen bottom — fine for the
    // original short sheet (ETA + provider info + buttons), but the sheet
    // now grows much taller once the OTP/invoice/counter-offer sections
    // appear, so this fixed offset ended up sitting inside the sheet's own
    // content instead of above it. Anchoring from the top of the map
    // (below the header) keeps it clear of the sheet regardless of how
    // tall it gets.
    top: Platform.OS === 'ios' ? 120 : 100,
    right: 20,
    zIndex: 11,
  },
  locateMeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.card,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
    borderWidth: 1,
    borderColor: t.inputFilled,
  },
  locateMeButtonActive: {
    backgroundColor: '#4285F4',
    borderColor: '#4285F4',
  },
  cancelButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FEF2F2',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FEE2E2',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  completeJobBtn: {
    marginTop: 16,
    height: 48,
    backgroundColor: '#10B981',
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#10B981',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 2,
  },
  invoiceSecondaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  invoiceSecondaryBtnText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Fonts.poppinsBold,
    color: '#111827',
  },
  completeJobBtnText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Fonts.poppinsBold,
  },
  reportIssueBtn: {
    marginTop: 10,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reportIssueBtnText: {
    color: '#EF4444',
    fontSize: 13,
    lineHeight: 18,
    fontFamily: Fonts.poppinsSemiBold,
  },
  inspectionCard: {
    marginTop: 16,
    padding: 16,
    borderRadius: 16,
    backgroundColor: t.inputFilled,
  },
  inspectionCardTitle: {
    fontSize: 15,
    lineHeight: 21,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    marginBottom: 4,
  },
  inspectionCardBody: {
    fontSize: 13,
    color: t.textSecondary,
    lineHeight: 18,
  },
  pickupPhoto: {
    width: '100%',
    height: 160,
    borderRadius: 12,
    marginBottom: 10,
    backgroundColor: t.inputFilled,
  },
  otpCard: {
    marginTop: 16,
    padding: 20,
    borderRadius: 20,
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.border,
  },
  otpCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  otpIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: t.brand,
    justifyContent: 'center',
    alignItems: 'center',
  },
  otpCardTitle: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  otpDigitsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 16,
  },
  otpDigitBox: {
    width: 52,
    height: 60,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#FDE68A',
    backgroundColor: '#FFFBEB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  otpDigitText: {
    fontSize: 26,
    lineHeight: 32,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    includeFontPadding: false,
  },
  invoiceAmount: {
    fontSize: 28,
    lineHeight: 34,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    marginBottom: 8,
  },
  counterInput: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    fontSize: 14,
  },
}); }
