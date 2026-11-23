import { useAppAlert } from '@/components/app-alert';
import { CarePanel, CareTripDetails } from '@/components/care-panel';
import { Disclosure } from '@/components/tracking/disclosure';
import { JobMenu, type JobMenuAction } from '@/components/tracking/job-menu';
import { ProviderStrip } from '@/components/tracking/provider-strip';
import { TripProgress } from '@/components/tracking/trip-progress';
import { useCareJob } from '@/hooks/use-care-job';
import { trackingStage } from '@/services/tracking-stage';
import { RouteFollower, estimate, fromEncoded, haversineKm, progress, type LatLng, type Route } from '@/services/route';
import { CancelJobModal } from '@/components/cancel-job-modal';
import { DisputeModal } from '@/components/dispute-modal';
import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SkoFyApi, BASE_URL, getFreshAccessToken, MeetingInfo } from '@/services/api';
import { MeetingCard } from '@/components/meeting-card';
import { InspectionReport, InspectionReportCard } from '@/components/inspection-report-card';
import { kmToMiles } from '@/services/units';
import { GOOGLE_PLACES_API_KEY } from '@/services/google-places';
import { Image } from 'expo-image';
import { usePhotoViewer } from '@/components/photo-viewer';
import { callTapAllowed } from '@/services/callManager';
import { router, useLocalSearchParams } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useOpenScreen } from '@/services/openScreens';
import {
  CheckCircle2,
  ChevronLeft,
  LocateFixed,
  Receipt,
  ShieldCheck,
  Video,
} from 'lucide-react-native';
import { VehicleIcon } from '@/components/vehicle-icon';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { PanResponder, Platform, ScrollView, Share, StatusBar, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { TextInput } from '@/components/scaled-text';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SheetToggleHandle } from '@/components/sheet-toggle-handle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RatingModal, RatingDimensions } from '@/components/ui/rating-modal';
import { ExtraWorkCard } from '@/components/extra-work-card';
import { TipSheet } from '@/components/tip-sheet';
import { QuoteGuide } from '@/components/price-guide-note';
import type { OffAppAnswer } from '@/components/off-app-question';
import { alreadyRated, isRatingSkipped, markRatingSkipped, markRatingSubmitted } from '@/services/ratingReminders';
import { CheckoutSheet } from '@/components/checkout-sheet';
import { GoodsHoldCard, PickupCodeEditor, goodsReceiptLine } from '@/components/pickup-tracking';
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


const TRACK_POLL_INTERVAL_MS = 2000;
// The provider's phone sends its figures every few seconds while its
// navigation screen is open; older than this, they've stopped.
const PROVIDER_TRIP_FRESH_MS = 15_000;
const ANIM_TICK_MS = 50; // ~20fps — smooth enough for a slow-moving marker, cheap on battery

const WS_BASE = BASE_URL
  .replace(/^https:\/\//, 'wss://')
  .replace(/^http:\/\//, 'ws://');


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


interface TrackedProvider {
  id: string;
  name: string;
  role: string;
  rating: number;
  image: string | null;
  phone: string;
}

/** A car-trunk or van load: the vehicle Dodorez checked that's coming
 * (skofy-backend VehicleService.on_job) — to know it when it pulls up. */
interface ComingVehicle {
  description: string;
  vehicle_type?: string;
  plate?: string;
  plate_state?: string;
  photo_url?: string | null;
}

// A one-time code the customer reads out to the provider: the arrival code on
// in-person jobs, the drop-off code on deliveries.
function CodeCard({ title, code, body, validUntil, styles, action }: {
  title: string; code: string; body?: string;
  /** When it stops working (ms) — "Valid until 3:42 PM" under the digits. */
  validUntil?: number | null;
  styles: ReturnType<typeof makeStyles>;
  /** e.g. sending the code on to whoever receives the delivery. */
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.otpCard}>
      <View style={styles.otpCardHeader}>
        <View style={styles.otpIconBadge}>
          <ShieldCheck size={16} color="#111827" />
        </View>
        <ThemedText style={styles.otpCardTitle}>{title}</ThemedText>
      </View>
      <View style={styles.otpDigitsRow}>
        {code.split('').map((digit, idx) => (
          <View key={idx} style={styles.otpDigitBox}>
            <ThemedText style={styles.otpDigitText}>{digit}</ThemedText>
          </View>
        ))}
      </View>
      {!!body && <ThemedText style={styles.inspectionCardBody}>{body}</ThemedText>}
      {!!validUntil && (
        <ThemedText style={[styles.inspectionCardBody, { textAlign: 'center' }]}>
          Valid until {clockTime(validUntil)} · your provider can send a new one after that
        </ThemedText>
      )}
      {action && (
        <TouchableOpacity style={[styles.completeJobBtn, { marginTop: 10 }]} onPress={action.onPress}>
          <ThemedText style={styles.completeJobBtnText}>{action.label}</ThemedText>
        </TouchableOpacity>
      )}
    </View>
  );
}

// A done step with the provider's photo of it: a small thumbnail beside a
// line of text — tap it to see the photo full width, tap again to shrink it.
/** The provider's photo at a stop, with what it shows. A tap opens it whole,
 * full screen (it used to only grow inside the card, still cropped). */
function PhotoNote({ uri, title, body, styles, onOpen }: {
  uri: string | null; title: string; body: string; styles: ReturnType<typeof makeStyles>; onOpen: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.photoNote}
      activeOpacity={0.85}
      disabled={!uri}
      onPress={onOpen}
      accessibilityRole={uri ? 'button' : undefined}
      accessibilityLabel={uri ? `${title}. Open the photo full size` : title}
    >
      <View style={styles.photoNoteRow}>
        {uri
          ? <Image source={{ uri }} style={styles.photoThumb} contentFit="cover" />
          : <CheckCircle2 size={22} color="#10B981" />}
        <View style={{ flex: 1 }}>
          <ThemedText style={styles.photoNoteTitle}>{title}</ThemedText>
          <ThemedText style={styles.inspectionCardBody}>{body}</ThemedText>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const clockTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

type GlideRefs = {
  from: React.MutableRefObject<LatLng | null>;
  to: React.MutableRefObject<LatLng | null>;
  startedAt: React.MutableRefObject<number>;
  current: React.MutableRefObject<LatLng | null>;
  speed: React.MutableRefObject<number>;
  heading: React.MutableRefObject<number>;
};

/** The provider's vehicle icon, gliding smoothly toward the latest location
 * instead of snapping to it — if a new one arrives mid-glide, it redirects
 * from wherever the dot currently is rather than jumping back to the old
 * start. Its own component: the 20 frames a second used to redraw the whole
 * screen (docs/APP_DATA_ARCHITECTURE.md). */
const GlidingProviderMarker = React.memo(function GlidingProviderMarker({ glide, onMove }: {
  glide: GlideRefs; onMove: (point: LatLng) => void;
}) {
  const [loc, setLoc] = useState<LatLng | null>(null);
  useEffect(() => {
    const tick = () => {
      const to = glide.to.current;
      const from = glide.from.current;
      if (!to) return;
      let point: LatLng;
      if (!from) {
        point = to;
      } else {
        const elapsed = Date.now() - glide.startedAt.current;
        const progress = elapsed / TRACK_POLL_INTERVAL_MS;
        if (progress < 1) {
          // Glide toward the latest confirmed GPS fix
          point = {
            latitude: from.latitude + (to.latitude - from.latitude) * progress,
            longitude: from.longitude + (to.longitude - from.longitude) * progress,
          };
        } else {
          // Dead reckoning: keep moving in last known direction while waiting
          // for the next GPS fix. Only extrapolate if actually moving (>0.5 m/s).
          // Cap at 5 s of extrapolation so the marker doesn't drift far on stale data.
          const extraSec = Math.min((elapsed - TRACK_POLL_INTERVAL_MS) / 1000, 5);
          point = glide.speed.current > 0.5
            ? deadReckon(to, glide.speed.current, glide.heading.current, extraSec)
            : to;
        }
      }
      if (point === glide.current.current) return;   // standing still: nothing to draw
      glide.current.current = point;
      setLoc(point);
      onMove(point);
    };
    const interval = setInterval(tick, ANIM_TICK_MS);
    return () => clearInterval(interval);
  }, [glide, onMove]);
  if (!loc) return null;
  return (
    <Marker
      coordinate={loc}
      image={require('@/assets/images/provider-marker.png')}
      anchor={{ x: 0.5, y: 0.5 }}
      rotation={glide.heading.current}
      flat
    />
  );
});

export default function TrackProviderScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const appAlert = useAppAlert();
  // The provider's photos at the pickup and drop-off, seen whole.
  const photoViewer = usePhotoViewer();
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
  const fullRouteCoordsRef = useRef<LatLng[]>([]);
  // Follows the trip — when to ask for the road again (services/route.ts) —
  // and when the distance and time were last worked out from a live location.
  const followerRef = useRef<RouteFollower | null>(null);
  if (!followerRef.current) followerRef.current = new RouteFollower(GOOGLE_PLACES_API_KEY);
  const liveAtRef = useRef(0);
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
  const [vehicle, setVehicle] = useState<ComingVehicle | null>(null);
  const [destination, setDestination] = useState<{ latitude: number; longitude: number } | null>(null);
  const destinationRef = useRef<LatLng | null>(null);
  useEffect(() => { destinationRef.current = destination; }, [destination]);
  // The provider's own figures and road, while their navigation screen sends
  // them (backend app/domain/trip_figures.py): shown exactly as they are, so
  // both phones say the same miles and minutes. Without them (screen closed,
  // older app), this phone works them out itself.
  const providerTripRef = useRef<{ at: number; eta: number; miles: number; route: Route | null } | null>(null);
  const providerTripFresh = () => !!providerTripRef.current && Date.now() - providerTripRef.current.at < PROVIDER_TRIP_FRESH_MS;
  const [eta, setEta] = useState('—');
  const [distance, setDistance] = useState('—');
  const [jobStatus, setJobStatus] = useState('ACCEPTED');
  // On-site inspection + invoice — bidding is retired, so the real job cost
  // is only ever set here, after the provider inspects in person.
  const [inspectionFeeStatus, setInspectionFeeStatus] = useState<'PENDING_CAPTURE' | 'HELD' | 'FAILED' | null>(null);
  // A trip priced up front (Pickup & Delivery): its fare booked and paid.
  const [bookingPaid, setBookingPaid] = useState(false);
  const [inspectionOtp, setInspectionOtp] = useState<{ otp: string | null; expires_in_seconds: number | null }>({ otp: null, expires_in_seconds: null });
  // Pickup & Drop: the code the customer gives the provider at the drop-off.
  const [deliveryCode, setDeliveryCode] = useState<string | null>(null);
  // When the code shown stops working (Date.now() ms) — shown under it, and
  // in the message that sends it on to whoever receives the order.
  const [deliveryCodeUntil, setDeliveryCodeUntil] = useState<number | null>(null);
  const [arrivalCodeUntil, setArrivalCodeUntil] = useState<number | null>(null);
  // The detail poll, run now: the server says a code was just issued
  // ("handover_code" on the job's socket), so it shows at once, not on the
  // next tick.
  const pollNowRef = useRef<(() => void) | null>(null);
  // The same for a booking's check-in / hand-back code (useCareJob).
  const careReloadRef = useRef<(() => void) | null>(null);
  // Set once the drop-off code is used — it's delivered, waiting to be completed.
  const [delivered, setDelivered] = useState(false);
  // Pickup & Drop — the customer isn't physically at the pickup point (it's
  // a store), so the OTP card above can't apply to this job kind; a photo of
  // what was picked up substitutes for it instead.
  const [jobKind, setJobKind] = useState<'STANDARD' | 'PICKUP_DROPOFF'>('STANDARD');
  // The job's protocol steps (docs/JOB_SHAPE_DESIGN.md). A job priced up
  // front is paid at booking and run by CarePanel — no visiting fee or
  // inspection code.
  const [steps, setSteps] = useState<string[]>([]);
  // Online work (docs/ONLINE_JOBS_DESIGN.md): no map, no trip, no visit — the
  // session, and its meeting link, in their place.
  const [setOff, setSetOff] = useState(true);
  const [online, setOnline] = useState(false);
  const [meeting, setMeeting] = useState<MeetingInfo | null>(null);
  const [sessionAt, setSessionAt] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState('');
  const meetingRefreshRef = useRef<(() => void) | null>(null);
  const paysUpfront = steps.includes('PAY_UPFRONT');
  // A pickup can go ahead: a trip's fare booked, or a quoted pickup's visiting fee held.
  const pickupPaid = paysUpfront ? bookingPaid : inspectionFeeStatus === 'HELD';
  const [pickupPhotoUrl, setPickupPhotoUrl] = useState<string | null>(null);
  // The provider's photo of the order at the drop-off, taken before the code.
  const [dropoffPhotoUrl, setDropoffPhotoUrl] = useState<string | null>(null);
  const [pickupConfirmedAt, setPickupConfirmedAt] = useState<string | null>(null);
  // Buy it for me: the shopping money held at hire, and what was spent.
  const [purchaseLimit, setPurchaseLimit] = useState<number | null>(null);
  const [goodsHoldStatus, setGoodsHoldStatus] = useState<string | null>(null);
  const [goodsAmount, setGoodsAmount] = useState<number | null>(null);
  const [payingGoods, setPayingGoods] = useState(false);
  // Already paid: the store's pickup code, which the customer can add later.
  const [pickupCode, setPickupCode] = useState<string | null>(null);
  // From a person (any address): no store, no store code — the provider
  // checks the item with whoever hands it over, and may refuse it.
  const [pickupFromPerson, setPickupFromPerson] = useState(false);
  // Sent from the customer: someone else receives it, so they need the drop-off code.
  const [recipientName, setRecipientName] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<any>(null);
  // The provider's inspection report, for the customer to confirm (§4).
  const [inspection, setInspection] = useState<{
    report: InspectionReport | null; completed: boolean; confirmed: boolean; disputed: boolean;
  }>({ report: null, completed: false, confirmed: false, disputed: false });
  const [inspectionTick, setInspectionTick] = useState(0);
  const [payingFee, setPayingFee] = useState(false);
  const [respondingToInvoice, setRespondingToInvoice] = useState(false);
  const [showCounterInput, setShowCounterInput] = useState(false);
  const [counterAmountInput, setCounterAmountInput] = useState('');
  const { payInspectionFee, payGoodsHold, payInvoice } = useHirePayment();
  const [mapError, setMapError] = useState(!MapView);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [tipJobId, setTipJobId] = useState<string | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  // Set when the job is permanently gone/inaccessible (404/403) — usually a
  // stale notification tap landing here after the job was cancelled/expired.
  // Without this, the screen just silently sits there with default
  // placeholder data (jobStatus stays 'ACCEPTED', provider stays null)
  // forever, with no indication anything is wrong.
  const [jobGone, setJobGone] = useState(false);
  // Until the job, and whether its fee or booking is paid, have been read,
  // the screen doesn't guess: guessing showed "Pay the visiting fee" (or
  // "Book it") for a moment on every open, paid or not.
  const [jobLoaded, setJobLoaded] = useState(false);
  const [feeChecked, setFeeChecked] = useState(false);
  // The detail poll's first round is in (codes, delivered, the invoice…).
  const [detailChecked, setDetailChecked] = useState(false);
  // Whether the provider travels to the customer — not for work at their own
  // place or online (unknown until the job loads: assume they do).
  const travels = steps.length === 0 || steps.includes('TRACK_EN_ROUTE');
  const orderCollected = jobKind === 'PICKUP_DROPOFF' && !!pickupConfirmedAt;

  useEffect(() => { jobStatusRef.current = jobStatus; }, [jobStatus]);
  // For the poll and the ETA clock (set up once): a delivery under way is
  // still travelling — to the drop-off — until it's handed over.
  const jobKindRef = useRef(jobKind);
  const deliveredRef = useRef(delivered);
  useEffect(() => { jobKindRef.current = jobKind; }, [jobKind]);
  useEffect(() => { deliveredRef.current = delivered; }, [delivered]);
  const stillTravelling = (status: string) =>
    status === 'ACCEPTED' || (status === 'IN_PROGRESS' && jobKindRef.current === 'PICKUP_DROPOFF' && !deliveredRef.current);

  // A notification for this job, tapped while this screen is open, mustn't
  // stack a second copy of it (services/openScreens.ts).
  const isFocused = useIsFocused();
  const { height: windowHeight } = useWindowDimensions();
  useOpenScreen('/track-provider', jobId, { jobId });

  // Count ETA down every second so it never freezes between poll/Directions updates
  useEffect(() => {
    const id = setInterval(() => {
      if (!stillTravelling(jobStatusRef.current) || etaBaseRef.current == null) return;
      if (providerTripFresh()) return;   // their figure, as they see it
      const elapsedMins = (Date.now() - etaSetAtRef.current) / 60000;
      const remaining = Math.max(0, Math.round(etaBaseRef.current - elapsedMins));
      setEta(`${remaining} min${remaining === 1 ? '' : 's'}`);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // The provider's figures and road (a 'trip' message): for this stop only —
  // a delivery's pickup figures mustn't show on the drive to the drop-off.
  const applyProviderTrip = (msg: any) => {
    const dest = destinationRef.current;
    if (!dest || !stillTravelling(jobStatusRef.current)) return;
    if (typeof msg.eta_min !== 'number' || typeof msg.distance_mi !== 'number') return;
    if (haversineKm(dest, { latitude: msg.dest_lat, longitude: msg.dest_lng }) > 0.15) return;
    const before = providerTripRef.current;
    const route = typeof msg.route === 'string'
      ? fromEncoded(msg.route, typeof msg.route_mins === 'number' ? msg.route_mins : msg.eta_min)
      : before?.route ?? null;
    providerTripRef.current = { at: Date.now(), eta: msg.eta_min, miles: msg.distance_mi, route };
    setDistance(`${Number(msg.distance_mi).toFixed(1)} mi`);
    setEta(`${msg.eta_min} min${msg.eta_min === 1 ? '' : 's'}`);
    etaBaseRef.current = msg.eta_min;
    etaSetAtRef.current = Date.now();
    liveAtRef.current = Date.now();
    if (route) {
      fullRouteCoordsRef.current = route.coords;   // the marker snaps to their road
      const here = currentPosRef.current;
      if (here) setRouteCoords(progress(here, dest, route).coords);
    }
  };

  // Central location update handler — applies EMA smoothing, route snapping,
  // then feeds the animation system. Called from both WS and HTTP poll paths.
  const applyLocation = useCallback((raw: LatLng, speed?: number, heading?: number) => {
    const smoothed = emaSmooth(emaLocRef.current, raw);
    emaLocRef.current = smoothed;
    const shouldSnap = stillTravelling(jobStatusRef.current) && fullRouteCoordsRef.current.length >= 2;
    const final = shouldSnap ? snapToRoute(smoothed, fullRouteCoordsRef.current) : smoothed;
    if (speed != null && speed >= 0) speedRef.current = speed;
    if (heading != null && heading >= 0) headingRef.current = heading;
    setPolledLoc(final);
    animFromRef.current = currentPosRef.current ?? final;
    animToRef.current = final;
    animStartTimeRef.current = Date.now();
  }, []);

  const applyPickupFields = useCallback((j: any) => {
    setPickupPhotoUrl(j.pickup_photo_url ?? null);
    setDropoffPhotoUrl(j.dropoff_photo_url ?? null);
    setPickupConfirmedAt(j.pickup_confirmed_at ?? null);
    setPurchaseLimit(j.pickup_purchase === 'BUY_FOR_ME' && j.purchase_limit != null ? Number(j.purchase_limit) : null);
    setGoodsAmount(j.goods_amount != null ? Number(j.goods_amount) : null);
    setPickupCode(j.pickup_details?.pickup_code ?? null);
    setPickupFromPerson(j.pickup_source === 'PERSON');
    setRecipientName(j.pickup_details?.recipient_name ?? null);
  }, []);

  // One-time: who's coming, and where they're headed
  useEffect(() => {
    if (!jobId) return;
    SkoFyApi.jobs.get(jobId).then((j: any) => {
      if (j.assigned_provider) {
        setProvider({
          id: j.assigned_provider.provider_id,
          name: j.assigned_provider.name,
          // A business's job: the business, with its member doing it (docs/BUSINESS_PROVIDERS_DESIGN.md).
          role: (j as any).business_name ? `${(j as any).business_name} team` : (j.assigned_provider.profession ?? 'Service Provider'),
          rating: j.assigned_provider.avg_rating ?? 0,
          image: j.assigned_provider.profile_image_url ?? null,
          phone: j.assigned_provider.phone ?? '',
        });
      }
      setVehicle(j.vehicle ?? null);
      if (j.lat != null && j.lng != null) {
        setDestination({ latitude: j.lat, longitude: j.lng });
      }
      setJobStatus(j.status);
      setJobKind(j.job_type === 'PICKUP_DROPOFF' ? 'PICKUP_DROPOFF' : 'STANDARD');
      setSteps((j as any).steps ?? []);
      setOnline(((j as any).shape?.venue ?? (j.service_mode === 'REMOTE' ? 'ONLINE' : null)) === 'ONLINE');
      setMeeting((j as any).meeting ?? null);
      setSessionAt(j.scheduled_at ?? null);
      setSessionTitle(j.title ?? '');
      applyPickupFields(j);
      setJobLoaded(true);
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
          if (msg.type === 'meeting_changed') {
            // The other side added, changed or removed the meeting link.
            meetingRefreshRef.current?.();
          } else if (msg.type === 'handover_code') {
            pollNowRef.current?.();
            careReloadRef.current?.();
          } else if (msg.type === 'trip') {
            applyProviderTrip(msg);
          } else if (msg.type === 'location' && msg.lat != null && msg.lng != null) {
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
        setSetOff(t.set_off !== false);
        // Use HTTP location when WS is down OR when WS is open but has gone
        // silent (provider killed app — WS stays connected to backend but no
        // messages arrive). 3 s without a WS location = treat as stale.
        const wsStale = Date.now() - lastWsLocRef.current > 3000;
        if (t.provider_lat != null && t.provider_lng != null &&
            (wsRef.current?.readyState !== WebSocket.OPEN || wsStale)) {
          applyLocation({ latitude: t.provider_lat, longitude: t.provider_lng }, undefined, t.heading ?? undefined);
        }
        // Where the provider is heading, as the server has it: a delivery's
        // pickup until it's collected, then its drop-off. Taken from the job
        // once at the start, the map kept pointing at the pickup for the
        // whole drive to the customer.
        if (t.destination_lat != null && t.destination_lng != null) {
          setDestination((d) => (d && d.latitude === t.destination_lat && d.longitude === t.destination_lng
            ? d : { latitude: t.destination_lat as number, longitude: t.destination_lng as number }));
        }
        if (!stillTravelling(t.job_status)) {
          setDistance('0 mi');
          setEta(t.job_status === 'COMPLETED' ? 'Completed' : 'Arrived');
          etaBaseRef.current = null;
        } else if (t.figures_from_provider && t.eta_minutes != null && t.distance_km != null
                   && t.destination_lat != null && t.destination_lng != null) {
          // The provider's figures, through the server while this phone's
          // socket is down: as they are, the same as on their screen.
          applyProviderTrip({
            eta_min: t.eta_minutes, distance_mi: Math.round(kmToMiles(t.distance_km) * 10) / 10,
            dest_lat: t.destination_lat, dest_lng: t.destination_lng,
          });
        } else if (Date.now() - liveAtRef.current < 15_000) {
          // Worked out from a live location just now (services/route.ts): kept.
        } else if (t.eta_minutes != null) {
          // Seed the countdown timer; 1s interval ticks it down from here
          etaBaseRef.current = t.eta_minutes;
          etaSetAtRef.current = Date.now();
          // Show backend distance as fallback until route segments load
          if (fullRouteCoordsRef.current.length < 2 && t.distance_km != null) {
            setDistance(`${kmToMiles(t.distance_km).toFixed(1)} mi`);
          }
        } else if (t.provider_lat != null && t.provider_lng != null && t.destination_lat != null && t.destination_lng != null) {
          // No ETA from the server: the same estimate as everywhere (services/route.ts).
          const est = estimate(
            { latitude: t.provider_lat, longitude: t.provider_lng },
            { latitude: t.destination_lat, longitude: t.destination_lng },
          );
          etaBaseRef.current = est.durationMins;
          etaSetAtRef.current = Date.now();
          if (fullRouteCoordsRef.current.length < 2) setDistance(`${est.distanceMi.toFixed(1)} mi`);
        }
        // Pick up the provider completing the job from their own app, not just
        // the customer tapping "Mark as Completed" here.
        if (t.job_status === 'COMPLETED' && !hasShownCompletionRef.current) {
          hasShownCompletionRef.current = true;
          setIsCompleted(true);
          if (!isRatingSkipped(jobId)) setShowRatingModal(true);
        }
        // Pick up the provider cancelling from their own app — they need
        // to see why, not just find themselves bounced back silently.
        if (t.job_status === 'CANCELLED' && !hasShownCancellationRef.current) {
          hasShownCancellationRef.current = true;
          const reason = t.cancellation_reason ?? '';
          const refused = reason.startsWith('Pickup refused');
          appAlert.show(
            'warning',
            refused ? 'Pickup Not Completed' : 'Job Cancelled',
            refused
              ? `Your provider didn't take the item — ${reason.replace(/^Pickup refused:\s*/, '').toLowerCase()}. The job is cancelled and their trip fee is kept.\n\nIf that's wrong, contact support from Help.`
              : t.cancellation_reason
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
  // Online: the meeting link and the session time as they change — the job's
  // stamp every 5 s, the job only when it moved, and at once when the server
  // says the link changed (meeting_changed, above).
  useEffect(() => {
    if (!jobId || !online) return;
    let cancelled = false;
    let lastStamp = '';
    const refresh = async (force = false) => {
      const stamp = await SkoFyApi.jobs.stamp(jobId).then((r) => r?.stamp ?? '').catch(() => '');
      if (!force && stamp && stamp === lastStamp) return;
      const job: any = await SkoFyApi.jobs.get(jobId).catch(() => null);
      if (cancelled || !job) return;
      lastStamp = stamp;
      setMeeting(job.meeting ?? null);
      setSessionAt(job.scheduled_at ?? null);
      setInvoice(job.invoice ?? null);
    };
    meetingRefreshRef.current = () => { void refresh(true); };
    const timer = setInterval(() => { void refresh(); }, 5000);
    return () => { cancelled = true; clearInterval(timer); meetingRefreshRef.current = null; };
  }, [jobId, online]);

  useEffect(() => {
    if (!jobId) return;
    const deliveryOnItsWay = jobStatus === 'IN_PROGRESS' && jobKind === 'PICKUP_DROPOFF';
    // CarePanel polls a booking of its own — except a trip's pickup state
    // (the photo, the shopping money), which the cards below follow.
    if (paysUpfront && jobKind !== 'PICKUP_DROPOFF') return;
    if (!['ACCEPTED', 'INSPECTING', 'INVOICE_PENDING'].includes(jobStatus) && !deliveryOnItsWay) return;
    let cancelled = false;

    // The job, only when it changed: its stamp (one small query) every 3 s,
    // the whole job (about ten queries) when the stamp moves, and every 30 s
    // anyway. Null when unchanged — what's shown is still current. Nothing
    // read here is a running meter, so the stamp covers it all (server:
    // JobRepository.change_stamp). Unreadable stamp: the whole job, as before.
    let lastStamp = '';
    let lastFullAt = 0;
    let deliveredSeen = false;
    // Buy it for me, as of the last whole job: its shopping-money hold is
    // asked about every time, changed or not — that ask is what brings a
    // hold Stripe has taken into the database (PaymentService._reconciled,
    // webhooks aside), so waiting for the stamp to move first would wait
    // for itself.
    let buyForMe = false;
    const jobIfChanged = async (): Promise<any | null> => {
      const stamp = await SkoFyApi.jobs.stamp(jobId).then((r) => r?.stamp ?? null).catch(() => null);
      if (stamp !== null && stamp === lastStamp && Date.now() - lastFullAt < 30_000) return null;
      const job: any = await SkoFyApi.jobs.get(jobId).catch(() => null);
      if (job) {
        if (stamp !== null) lastStamp = stamp;
        lastFullAt = Date.now();
        if (job.delivered_at) deliveredSeen = true;
        buyForMe = job.pickup_purchase === 'BUY_FOR_ME';
      }
      return job;
    };

    // One at a time: on a weak signal the 3-second ticks used to pile up,
    // each slowing the next — and the code with them.
    let inFlight = false;
    const until = (seconds: number | null | undefined) => (seconds ? Date.now() + seconds * 1000 : null);
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        // Online: no visiting fee and no arrival code to ask for.
        if (jobStatus === 'ACCEPTED' && !online) {
          // A trip has no visiting fee: its fare is booked (bookingPaid).
          if (!paysUpfront) {
            const feeStatus = await SkoFyApi.payments.getStatus(jobId, 'INSPECTION_FEE').catch(() => null);
            if (!cancelled && feeStatus) setInspectionFeeStatus(feeStatus.status as any);
            if (!cancelled) setFeeChecked(true);
          }
          if (jobKind === 'PICKUP_DROPOFF') {
            // No OTP for this job kind (the customer isn't at the pickup
            // point) — poll the job itself for the pickup-confirmation photo.
            const job = await jobIfChanged();
            if (!cancelled && job) applyPickupFields(job);
            if (!cancelled && job) setBookingPaid(['HELD', 'PAID'].includes((job as any).payment_status));
            if (!cancelled && buyForMe) {
              const goods = await SkoFyApi.payments.getStatus(jobId, 'GOODS_ADVANCE').catch(() => null);
              if (!cancelled) setGoodsHoldStatus(goods?.status ?? null);
            }
          } else {
            // The OTP only ever exists in Redis while the job is still
            // ACCEPTED — verify_inspection_otp deletes it the instant it's
            // checked, before flipping status to INSPECTING. Polling for it
            // only once status reaches INSPECTING (the old code) was asking
            // for something already gone, so the customer never saw it.
            const otpResult = await SkoFyApi.jobs.getInspectionOtp(jobId).catch(() => null);
            if (!cancelled && otpResult) {
              setInspectionOtp(otpResult);
              setArrivalCodeUntil(until(otpResult.expires_in_seconds));
            }
          }
        }
        if (jobStatus === 'INSPECTING' || jobStatus === 'INVOICE_PENDING') {
          const job: any = await jobIfChanged();
          if (!cancelled && job) {
            setInvoice(job.invoice ?? null);
            setInspection({
              report: job.inspection_report ?? null,
              completed: !!job.inspection_completed_at,
              confirmed: job.inspection_confidence === 'CONFIRMED',
              disputed: !!job.inspection_disputed_at,
            });
          }
        }
        // Every delivery's drop-off code is shown here — with a recipient's
        // name and the button to send it to them (CarePanel leaves it to this).
        if (deliveryOnItsWay) {
          // The code first — it's what the provider is standing at the door
          // for — and alongside the job, not after it.
          const [result, job] = await Promise.all([
            deliveredSeen ? Promise.resolve(null) : SkoFyApi.jobs.getDeliveryCode(jobId).catch(() => null),
            jobIfChanged(),
          ]);
          if (!cancelled && result) {
            setDeliveryCode(result.code);
            setDeliveryCodeUntil(until(result.expires_in_seconds));
          }
          if (!cancelled && job) {
            setDelivered(!!job.delivered_at);
            setDropoffPhotoUrl(job.dropoff_photo_url ?? null);
          }
        }
      } catch {
        // transient — keep showing last known values
      } finally {
        inFlight = false;
        if (!cancelled) setDetailChecked(true);
      }
    };

    pollNowRef.current = () => { void poll(); };
    poll();
    const interval = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(interval); pollNowRef.current = null; };
  }, [jobId, jobStatus, jobKind, inspectionTick, paysUpfront, online]);

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

  const handlePayGoodsHold = async () => {
    if (!jobId) return;
    setPayingGoods(true);
    try {
      const result = await payGoodsHold(jobId);
      if (result.status === 'success') {
        setGoodsHoldStatus('HELD');
      } else if (result.status === 'pending') {
        appAlert.show('warning', 'Still Processing', result.message);
      } else if (result.status === 'error') {
        appAlert.show('error', 'Payment Failed', result.message);
      }
    } finally {
      setPayingGoods(false);
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


  // Each poll: trim the route so the blue line always starts at the provider's
  // current position (Google Maps style), and re-fetch the full route only
  // when the provider moves significantly.
  // A new destination (a delivery's drop-off, once collected): the old route
  // is the wrong road (the follower drops it too, and any answer for it).
  useEffect(() => {
    fullRouteCoordsRef.current = [];
    providerTripRef.current = null;
    setRouteCoords([]);
  }, [destination?.latitude, destination?.longitude]);

  useEffect(() => () => followerRef.current?.stop(), []);

  useEffect(() => {
    const deliveryLeg = jobStatus === 'IN_PROGRESS' && jobKind === 'PICKUP_DROPOFF' && !delivered;
    if (!polledLoc || !destination || (jobStatus !== 'ACCEPTED' && !deliveryLeg)) {
      // Arrived, collected or done: a road still on its way mustn't bring
      // back a distance over "Arrived".
      followerRef.current?.stop();
      return;
    }

    // What's left, from where they are now — along the road route, or the
    // straight line × 1.3 without one (services/route.ts). Every location,
    // so distance and time go down as they drive. Only a road is drawn:
    // without one the map shows the two ends, never a straight line.
    const shared = providerTripRef.current;
    if (shared?.route && providerTripFresh()) {
      // Their figures stand (applyProviderTrip); their road, from where the
      // marker is now. Nothing asked of Google from here.
      setRouteCoords(progress(polledLoc, destination, shared.route).coords);
      return;
    }
    // This phone's own road — and its own figures, unless theirs are fresh:
    // their phone may have figures but no road to send (no route allowed on
    // its key), and the map still draws one.
    const follower = followerRef.current!;
    follower.follow(polledLoc, destination, (left) => {
      if (providerTripRef.current?.route && providerTripFresh()) return;   // their road arrived meanwhile
      fullRouteCoordsRef.current = follower.roadCoords;
      setRouteCoords(left.road ? left.coords : []);
      if (providerTripFresh()) return;   // their miles and minutes stand
      setDistance(`${left.distanceMi.toFixed(1)} mi`);
      etaBaseRef.current = left.durationMins;
      etaSetAtRef.current = Date.now();
      liveAtRef.current = Date.now();
    });
  }, [polledLoc, destination, jobStatus, jobKind, delivered]);

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

  // Camera follow — locks onto the provider icon when follow mode is active.
  // Called by the marker as it glides (GlidingProviderMarker); stable.
  const followMarker = useCallback((point: LatLng) => {
    if (!isFollowingRef.current || !mapRef.current) return;
    const now = Date.now();
    if (now - lastFollowTickRef.current < 100) return;
    lastFollowTickRef.current = now;
    mapRef.current.animateToRegion(
      { ...point, latitudeDelta: 0.003, longitudeDelta: 0.003 },
      80,
    );
  }, []);
  const glide = React.useMemo(() => ({
    from: animFromRef, to: animToRef, startedAt: animStartTimeRef,
    current: currentPosRef, speed: speedRef, heading: headingRef,
  }), []);

  const handleLocateMe = () => {
    isFollowingRef.current = true;
    setIsFollowing(true);
    const here = currentPosRef.current;
    if (here && mapRef.current) {
      mapRef.current.animateToRegion(
        { ...here, latitudeDelta: 0.003, longitudeDelta: 0.003 },
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

  const handleRatingSubmit = async (ratings: RatingDimensions, comment: string, offApp: OffAppAnswer) => {
    if (!jobId) throw new Error('Missing job reference.');
    // Throws on failure — RatingModal awaits this and shows the error
    // inline instead of silently closing as if it succeeded.
    // Rated already (the chat, another screen): done, not a failure.
    try {
      await SkoFyApi.jobs.submitReview(jobId, { ...ratings, comment, ...offApp });
    } catch (err) {
      if (!alreadyRated(err)) throw err;
    }
    markRatingSubmitted(jobId);
  };

  const handleRatingModalClose = () => {
    setShowRatingModal(false);
    // Back to the existing Home, not a new copy of it stacked on top — the
    // old one underneath could still be holding its own rating reminder.
    router.dismissTo('/(tabs)/home' as any);
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
    if (!jobId || !provider || !callTapAllowed()) return;
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

  // ── The sheet: what's happening, who's coming, the one thing to do ──
  // A booking priced up front, followed once for its card and its trip details.
  const care = useCareJob(jobId, paysUpfront);
  careReloadRef.current = paysUpfront ? care.reload : null;
  const careJob = care.job;
  const upfrontPaid = careJob ? careJob.payment_status === 'HELD' || careJob.payment_status === 'PAID' : bookingPaid;
  const isDelivery = jobKind === 'PICKUP_DROPOFF';
  // The detail poll runs for these (its effect, above): until its first round
  // is in, what it brings — the fee, a code, delivered, the price — isn't known.
  const detailPolled = !(paysUpfront && !isDelivery)
    && (['ACCEPTED', 'INSPECTING', 'INVOICE_PENDING'].includes(jobStatus) || (jobStatus === 'IN_PROGRESS' && isDelivery));
  const ready = jobLoaded && (!paysUpfront || !!careJob) && (!detailPolled || detailChecked);
  const stageNow = trackingStage({
    jobStatus,
    isCompleted,
    delivery: isDelivery,
    travels,
    setOff,
    paysUpfront,
    upfrontPaid,
    feeHeld: inspectionFeeStatus === 'HELD',
    needsGoodsHold: isDelivery && purchaseLimit != null && goodsHoldStatus !== 'HELD' && !pickupConfirmedAt,
    pickupFromStore: isDelivery && !pickupFromPerson,
    collected: !!pickupConfirmedAt,
    delivered: delivered || !!careJob?.delivered_at,
    hasCode: isDelivery ? !!deliveryCode && !delivered : paysUpfront ? !!care.code : !!inspectionOtp.otp,
    inspectionDone: inspection.completed,
    inspectionConfirmed: inspection.confirmed,
    invoiceStatus: invoice?.status ?? null,
    recipientName,
    hostedAtTheirPlace: steps.includes('CHECK_IN_CODE'),
    online,
  });
  const stage: typeof stageNow = ready ? stageNow
    : { ...stageNow, key: 'on_the_way', title: 'Getting the latest…', subtitle: '', needsAction: false, moving: false };
  // "12 mins" → a big "12" over "min"; "Arrived" stays a word.
  const etaMatch = /^(\d+) mins?$/.exec(eta);
  const etaNumber = etaMatch ? etaMatch[1] : eta;
  const etaUnit = etaMatch ? 'min' : '';
  const showEta = travels && stage.moving && eta !== '—';
  const pickupClock = pickupConfirmedAt ? new Date(pickupConfirmedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
  // Cancelling isn't offered once the order is with the provider (the server
  // refuses — it would be left with them) or once the work is under way.
  const canCancel = !isCompleted && !orderCollected && ['ACCEPTED', 'INSPECTING', 'INVOICE_PENDING'].includes(jobStatus);
  // A dispute is taken once it's under way or done, or once a delivery order
  // is collected (can_dispute in app/domain/pickup.py).
  const canReport = jobStatus === 'IN_PROGRESS' || isCompleted
    || (orderCollected && (jobStatus === 'ACCEPTED' || jobStatus === 'INVOICE_PENDING'));
  const hasTripDetails = (paysUpfront && !!careJob) || !!vehicle || (isDelivery && pickupFromPerson && !pickupConfirmedAt);

  // The "more" menu, and the sheet folded down to its headline to see the map.
  const [menuOpen, setMenuOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  // Something to do appears: the sheet opens to show it.
  useEffect(() => { if (stage.needsAction) setMinimized(false); }, [stage.key, stage.needsAction]);
  // Slid in by a transform, not an entering animation: that one held the panel
  // at its first height while the provider's row loaded into it, leaving the
  // row outside the white.
  const sheetY = useSharedValue(windowHeight);
  useEffect(() => { sheetY.value = withTiming(0, { duration: 500, easing: Easing.out(Easing.cubic) }); }, [sheetY]);
  const sheetIn = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.value }] }));
  const sheetPan = React.useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderRelease: (_, g) => {
      if (g.dy > 30) setMinimized(true);
      else if (g.dy < -30) setMinimized(false);
    },
  }), []);

  const openProfile = () => provider && router.push({
    pathname: '/provider-details' as any,
    params: { id: provider.id, providerId: provider.id, jobId: jobId ?? '', viewOnly: 'true' },
  });
  const openChat = () => provider && router.push({
    pathname: '/chat',
    params: { jobId: jobId ?? '', id: provider.id, name: provider.name, profileImage: provider.image ?? '', profession: provider.role },
  });
  // After the menu has closed: on iPhone a popup can't open while another is still closing.
  const pickMenu = (action: JobMenuAction) => {
    setMenuOpen(false);
    setTimeout(() => {
      if (action === 'profile') openProfile();
      else if (action === 'help') router.push({ pathname: '/support-chat', params: { jobId: jobId ?? '' } } as any);
      else if (action === 'report') setIsDisputeModalVisible(true);
      else if (action === 'cancel') handleCancelHire();
    }, Platform.OS === 'ios' ? 450 : 60);
  };

  // The provider's price: accept and pay, counter once, or reject.
  const renderInvoice = () => (
    <View style={styles.inspectionCard}>
      {/* Where it stands is the sheet's headline; this card is the price itself. */}
      <ThemedText style={styles.inspectionCardBody}>
        {invoice.status === 'COUNTERED' ? 'Your offer' : 'Their price'}
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
      {invoice.status === 'PENDING' && jobId && <QuoteGuide jobId={jobId} />}
      {invoice.visit_credit > 0 && (
        <ThemedText style={[styles.inspectionCardBody, { marginTop: 6 }]}>
          The ${Number(invoice.visit_credit).toFixed(2)} visiting fee you paid counts toward this price.
        </ThemedText>
      )}
      {invoice.deposit_percent > 0 && (
        <ThemedText style={[styles.inspectionCardBody, { marginTop: 6 }]}>
          {invoice.deposit_percent}% goes to your provider when work starts, for parts and materials; the rest when the
          job is done. You pay it all now, and it's held safely until then.
        </ThemedText>
      )}

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
            {/* Rejecting cancels the job — not once the provider has the order. */}
            {!orderCollected && (
              <TouchableOpacity
                style={[styles.invoiceSecondaryBtn, { backgroundColor: '#FEF2F2', borderColor: '#FEE2E2' }]}
                onPress={() => handleRespondToInvoice('REJECT')}
                disabled={respondingToInvoice}
              >
                <ThemedText style={[styles.invoiceSecondaryBtnText, { color: '#EF4444' }]}>Reject</ThemedText>
              </TouchableOpacity>
            )}
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
            {orderCollected
              ? 'Your provider declined your offer. Pay the original price to get your order, or report an issue below.'
              : 'Your provider declined your offer. Pay the original price to proceed, or cancel.'}
          </ThemedText>
          <TouchableOpacity
            style={[styles.completeJobBtn, { marginTop: 0 }]}
            onPress={() => handleRespondToInvoice('ACCEPT')}
            disabled={respondingToInvoice}
          >
            <ThemedText style={styles.completeJobBtnText}>Accept & Pay</ThemedText>
          </TouchableOpacity>
          {!orderCollected && (
            <TouchableOpacity
              style={[styles.invoiceSecondaryBtn, { backgroundColor: '#FEF2F2', borderColor: '#FEE2E2' }]}
              onPress={() => handleRespondToInvoice('REJECT')}
              disabled={respondingToInvoice}
            >
              <ThemedText style={[styles.invoiceSecondaryBtnText, { color: '#EF4444' }]}>Reject & Cancel Job</ThemedText>
            </TouchableOpacity>
          )}
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
  );

  const renderMap = () => {
    // Online: nothing to show on a map — the session, in its place.
    if (online) {
      return (
        <View style={[styles.map, styles.onlineBackdrop, { backgroundColor: themeColors.inputFilled, paddingTop: insets.top + 88 }]}>
          <View style={styles.onlineIcon}><Video size={30} color="#111827" /></View>
          <ThemedText style={[styles.onlineTitle, { color: themeColors.textPrimary }]}>Online session</ThemedText>
          <ThemedText style={[styles.onlineLine, { color: themeColors.textSecondary }]}>
            {sessionAt
              ? new Date(sessionAt).toLocaleString([], { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
              : 'No travel — you meet over video'}
          </ThemedText>
          <ThemedText style={[styles.onlineHint, { color: themeColors.textMuted }]}>
            Join from your phone, or a computer to share screens.
          </ThemedText>
        </View>
      );
    }
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
          <ThemedText style={{ color: themeColors.textSecondary }}>
            {jobLoaded ? 'The map isn’t available for this job' : 'Loading job details…'}
          </ThemedText>
        </View>
      );
    }

    const region = polledLoc
      ? { latitude: (polledLoc.latitude + destination.latitude) / 2, longitude: (polledLoc.longitude + destination.longitude) / 2, latitudeDelta: 0.02, longitudeDelta: 0.02 }
      : { ...destination, latitudeDelta: 0.01, longitudeDelta: 0.01 };

    return (
      <MapView
        // No Google toolbar: tapping a pin must not send people out to Google Maps.
        toolbarEnabled={false}
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
        <GlidingProviderMarker glide={glide} onMove={followMarker} />
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

      {/* Over the map: back, and follow the provider. The status is the sheet's headline. */}
      <View style={[styles.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
        <TouchableOpacity style={styles.roundMapButton} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={24} color="#111827" />
        </TouchableOpacity>
        {travels && (
          <TouchableOpacity
            style={[styles.roundMapButton, isFollowing && styles.locateMeButtonActive]}
            onPress={handleLocateMe}
            accessibilityRole="button"
            accessibilityLabel="Follow your provider on the map"
          >
            <LocateFixed size={22} color={isFollowing ? '#fff' : '#111827'} />
          </TouchableOpacity>
        )}
      </View>

      {/* The sheet: where things are (headline, steps), who's coming, the one
          thing to do now — and the fine print behind "Trip details". Swipe
          the handle down to see more of the map; up to bring it back.
          KeyboardAvoidingView: the counter-offer input sits deep in here,
          and Android's resize doesn't lift an absolutely placed sheet. */}
      <KeyboardAvoidingView style={styles.bottomSheetKeyboardWrapper} behavior="padding">
      <Animated.View style={[styles.bottomSheet, sheetIn]}>
        <View style={styles.handleArea} {...sheetPan.panHandlers}>
          {/* An arrow, not a bare line: it says the card can be folded (components/sheet-toggle-handle.tsx). */}
          <SheetToggleHandle
            expanded={!minimized}
            onPress={() => setMinimized((m) => !m)}
            expandLabel="Show the details"
            collapseLabel="Show more of the map"
          />
        </View>

        <ScrollView
          ref={bottomSheetScrollRef}
          style={[styles.bottomSheetScroll, { maxHeight: windowHeight * 0.62 }]}
          contentContainerStyle={[styles.bottomSheetContent, {
            paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 28 : 16) + 12,
          }]}
          showsVerticalScrollIndicator={false}
          bounces={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Headline: where things are, and how long until they're here. */}
          <View style={styles.stageRow}>
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.stageTitle} accessibilityRole="header">{stage.title}</ThemedText>
              {!!stage.subtitle && <ThemedText style={styles.stageSubtitle}>{stage.subtitle}</ThemedText>}
            </View>
            {showEta && (
              <View style={styles.etaChip} accessible accessibilityLabel={`Arriving in ${eta}${distance !== '—' ? `, ${distance} away` : ''}`}>
                <ThemedText style={styles.etaBig}>{etaNumber}</ThemedText>
                <ThemedText style={styles.etaSmall}>{etaUnit}{distance !== '—' ? ` · ${distance}` : ''}</ThemedText>
              </View>
            )}
          </View>

          {!minimized && (
            <>
              {ready && stage.key !== 'closed' && <TripProgress steps={stage.steps} current={stage.step} />}

              <View style={styles.rule} />

              <ProviderStrip
                provider={provider}
                vehicle={vehicle}
                onOpenProfile={openProfile}
                onCall={handleCallProvider}
                onChat={openChat}
                onMore={() => setMenuOpen(true)}
              />

              {/* ── The one thing to do now ─────────────────────────────── */}

              {jobId && paysUpfront && (
                <CarePanel jobId={jobId} care={care} onMessage={(kind, title, message) => appAlert.show(kind, title, message)} />
              )}

              {/* Online: the meeting — join here, or on a computer by its short address. */}
              {online && jobId && ['ACCEPTED', 'INVOICE_PENDING', 'IN_PROGRESS'].includes(jobStatus) && (
                <MeetingCard jobId={jobId} meeting={meeting} sessionAt={sessionAt} title={sessionTitle} viewer="customer"
                  onChanged={setMeeting}
                  onMessage={(kind, title, message) => appAlert.show(kind, title, message)} />
              )}

              {/* Quoted: the visiting / delivery fee, before the provider sets off. Online: none. */}
              {jobStatus === 'ACCEPTED' && !paysUpfront && !online && feeChecked && inspectionFeeStatus !== 'HELD' && (
                <View style={styles.inspectionCard}>
                  <ThemedText style={styles.inspectionCardBody}>
                    {jobKind === 'PICKUP_DROPOFF'
                      ? 'It’s held safely until your order is delivered.'
                      : 'It’s held safely, and counts toward the price if you go ahead.'}
                  </ThemedText>
                  <TouchableOpacity style={styles.completeJobBtn} onPress={handlePayInspectionFee} disabled={payingFee} accessibilityRole="button">
                    <ThemedText style={styles.completeJobBtnText}>{payingFee ? 'Processing…' : 'Pay now'}</ThemedText>
                  </TouchableOpacity>
                </View>
              )}

              {/* The arrival code (a visit) — only while it exists, before the inspection starts. */}
              {jobStatus === 'ACCEPTED' && !paysUpfront && jobKind !== 'PICKUP_DROPOFF' && inspectionFeeStatus === 'HELD' && inspectionOtp.otp && (
                <CodeCard title="Give your provider this code" code={inspectionOtp.otp} validUntil={arrivalCodeUntil} styles={styles} />
              )}

              {/* Pickup & Delivery, before it's collected. */}
              {jobStatus === 'ACCEPTED' && jobKind === 'PICKUP_DROPOFF' && pickupPaid && !pickupConfirmedAt
                && purchaseLimit != null && goodsHoldStatus !== 'HELD' && (
                <GoodsHoldCard limit={purchaseLimit} paying={payingGoods} onPay={handlePayGoodsHold} styles={styles} />
              )}
              {jobStatus === 'ACCEPTED' && jobKind === 'PICKUP_DROPOFF' && !pickupConfirmedAt && purchaseLimit == null && !pickupFromPerson && jobId && (
                <PickupCodeEditor jobId={jobId} code={pickupCode} styles={styles} />
              )}

              {/* Collected: the provider's photo of it (and what the shopping came to). */}
              {jobKind === 'PICKUP_DROPOFF' && !!pickupConfirmedAt && !delivered && (pickupPhotoUrl || (purchaseLimit != null && goodsAmount != null)) && (
                <PhotoNote
                  onOpen={() => photoViewer.open([{ uri: pickupPhotoUrl!, caption: `Picked up${pickupClock ? ` at ${pickupClock}` : ''}` }])}
                  uri={pickupPhotoUrl}
                  title={`Picked up${pickupClock ? ` at ${pickupClock}` : ''}`}
                  body={purchaseLimit != null && goodsAmount != null ? goodsReceiptLine(purchaseLimit, goodsAmount) : 'Photo of your order'}
                  styles={styles}
                />
              )}

              {/* On its way: the drop-off code, once the provider asks for it. */}
              {jobStatus === 'IN_PROGRESS' && jobKind === 'PICKUP_DROPOFF' && !delivered && deliveryCode && (
                <CodeCard
                  title={recipientName ? `Drop-off code for ${recipientName}` : 'Give your provider this code'}
                  code={deliveryCode}
                  validUntil={deliveryCodeUntil}
                  styles={styles}
                  action={recipientName ? {
                    label: `Send code to ${recipientName}`,
                    onPress: () => {
                      Share.share({
                        message: `Your Dodorez delivery is with you. Give the provider this code: ${deliveryCode}${deliveryCodeUntil ? ` (valid until ${clockTime(deliveryCodeUntil)})` : ''}.`,
                      }).catch(() => {});
                    },
                  } : undefined}
                />
              )}

              {/* Delivered (a booked trip's photo is in its booking card). */}
              {jobStatus === 'IN_PROGRESS' && jobKind === 'PICKUP_DROPOFF' && delivered && !paysUpfront && !!dropoffPhotoUrl && (
                <TouchableOpacity activeOpacity={0.9} accessibilityRole="button" accessibilityLabel="Delivery photo. Open it full size"
                  onPress={() => photoViewer.open([
                    ...(pickupPhotoUrl ? [{ uri: pickupPhotoUrl, caption: 'At the pickup' }] : []),
                    { uri: dropoffPhotoUrl, caption: 'Delivered' },
                  ], pickupPhotoUrl ? 1 : 0)}>
                  <Image source={{ uri: dropoffPhotoUrl }} style={styles.pickupPhoto} contentFit="cover" />
                </TouchableOpacity>
              )}

              {/* The inspection report, to look over — until it's confirmed (§4). */}
              {jobId && (jobStatus === 'INSPECTING' || jobStatus === 'INVOICE_PENDING') && inspection.completed
                && (!inspection.confirmed || jobStatus === 'INSPECTING') && (
                <InspectionReportCard
                  jobId={jobId}
                  jobStatus={jobStatus}
                  report={inspection.report}
                  confirmed={inspection.confirmed}
                  disputed={inspection.disputed}
                  onChanged={() => setInspectionTick((t) => t + 1)}
                  onError={(title, message) => appAlert.show('error', title, message)}
                />
              )}

              {/* The price — set only after the provider has seen the job. */}
              {jobStatus === 'INVOICE_PENDING' && invoice && renderInvoice()}

              {/* Work the provider asks to add mid-job (§11). */}
              {jobId && !isCompleted && jobStatus === 'IN_PROGRESS' && (
                <ExtraWorkCard jobId={jobId} onMessage={(kind, title, message) => appAlert.show(kind, title, message)} />
              )}

              {/* Done: the main button once it's handed over or the work is
                  done. A delivery still on its way can be marked received
                  early (handed over without the code) — offered quietly,
                  not as the next step. */}
              {!isCompleted && jobStatus === 'IN_PROGRESS' && (
                jobKind === 'PICKUP_DROPOFF' && !delivered ? (
                  <TouchableOpacity style={styles.quietLink} onPress={handleCompleteJob} accessibilityRole="button">
                    <ThemedText style={styles.quietLinkText}>Already have it? Mark as received</ThemedText>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.completeJobBtn} onPress={handleCompleteJob} accessibilityRole="button">
                    <ThemedText style={styles.completeJobBtnText}>Mark as completed</ThemedText>
                  </TouchableOpacity>
                )
              )}

              {/* ── The fine print, one tap away ─────────────────────────── */}
              {hasTripDetails && (
                <View style={styles.detailsBox}>
                  <Disclosure label={online ? 'Booking details' : 'Trip details'} icon={<Receipt size={18} color={themeColors.textSecondary} />}>
                    {paysUpfront && <CareTripDetails care={care} />}
                    {vehicle && (
                      <View style={styles.vehicleDetail}>
                        {vehicle.photo_url
                          ? <Image source={{ uri: vehicle.photo_url }} style={styles.vehiclePhoto} />
                          : <View style={[styles.vehiclePhoto, styles.vehiclePhotoEmpty]}><VehicleIcon type={vehicle.vehicle_type} size={22} color="#6B7280" /></View>}
                        <View style={{ flex: 1, gap: 4 }}>
                          <ThemedText style={styles.vehicleName} numberOfLines={2}>{vehicle.description}</ThemedText>
                          <View style={styles.checkedBadge}>
                            <ShieldCheck size={12} color="#047857" />
                            <ThemedText style={styles.checkedText}>Checked by Dodorez</ThemedText>
                          </View>
                        </View>
                      </View>
                    )}
                    {jobKind === 'PICKUP_DROPOFF' && pickupFromPerson && !pickupConfirmedAt && (
                      <ThemedText style={styles.inspectionCardBody}>
                        Your provider checks the item before taking it, and can refuse anything that isn’t allowed.
                      </ThemedText>
                    )}
                  </Disclosure>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </Animated.View>
      </KeyboardAvoidingView>

      <JobMenu
        visible={menuOpen}
        canCancel={canCancel}
        canReport={canReport}
        onPick={pickMenu}
        onClose={() => setMenuOpen(false)}
      />

      {jobId && (
        <CheckoutSheet
          visible={showCheckout}
          jobId={jobId}
          onPay={payFromCheckout}
          onClose={() => setShowCheckout(false)}
        />
      )}

      <RatingModal
        visible={showRatingModal && isFocused}
        providerName={provider?.name ?? 'Provider'}
        onClose={handleRatingModalClose}
        onTip={() => { setShowRatingModal(false); setTipJobId(jobId ?? null); }}
        onSubmit={handleRatingSubmit}
        onSkip={() => {
          if (jobId) markRatingSkipped(jobId);
          handleRatingModalClose();
        }}
      />

      <TipSheet
        jobId={tipJobId}
        providerName={provider?.name ?? 'your provider'}
        onClose={() => { setTipJobId(null); handleRatingModalClose(); }}
        onMessage={(kind, title, message) => appAlert.show(kind, title, message)}
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
      {photoViewer.element}
    </View>
  );
}

function makeStyles(t: typeof Colors.light) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: t.card },
  map: { ...StyleSheet.absoluteFillObject },
  // Online: the session where the map would be, in the space above the sheet.
  onlineBackdrop: { alignItems: 'center', paddingHorizontal: 32, gap: 6 },
  onlineIcon: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#FFCE48',
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  onlineTitle: { fontSize: 22, lineHeight: 30, fontFamily: Fonts.poppinsBold, textAlign: 'center' },
  onlineLine: { fontSize: 15, lineHeight: 21, fontFamily: Fonts.poppinsSemiBold, textAlign: 'center' },
  onlineHint: { fontSize: 13, lineHeight: 19, fontFamily: Fonts.poppins, textAlign: 'center' },
  bottomSheetKeyboardWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  // Rounded like the panel, so content scrolls under its top corners, not
  // over them (clipped here, not on the panel: that would cut iOS's shadow).
  bottomSheetScroll: { borderTopLeftRadius: 32, borderTopRightRadius: 32, overflow: 'hidden' },
  bottomSheetContent: { paddingHorizontal: 20, paddingTop: 4, gap: 16 },
  // Over the map: back on the left, follow-the-provider on the right.
  topBar: {
    position: 'absolute', left: 16, right: 16, zIndex: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  roundMapButton: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: t.card,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 5,
  },
  // The sheet's grab handle: swipe or tap it to fold the sheet to its headline.
  handleArea: { alignItems: 'center', paddingTop: 10, paddingBottom: 8 },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stageTitle: { fontSize: 22, lineHeight: 29, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
  stageSubtitle: { fontSize: 13.5, lineHeight: 19, fontFamily: Fonts.poppins, color: t.textSecondary, marginTop: 2 },
  etaChip: { minWidth: 72, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: t.brand },
  etaBig: { fontSize: 22, lineHeight: 26, fontFamily: Fonts.poppinsBold, color: '#111827' },
  etaSmall: { fontSize: 11.5, lineHeight: 15, fontFamily: Fonts.poppinsSemiBold, color: '#111827' },
  rule: { height: 1, backgroundColor: t.borderSubtle },
  quietLink: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 12 },
  quietLinkText: { fontSize: 13.5, lineHeight: 19, fontFamily: Fonts.poppinsSemiBold, color: t.textSecondary, textDecorationLine: 'underline' },
  detailsBox: { borderTopWidth: 1, borderTopColor: t.borderSubtle },
  vehicleDetail: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  photoNote: { padding: 12, borderRadius: 16, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, gap: 10 },
  photoNoteRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  photoThumb: { width: 52, height: 52, borderRadius: 10, backgroundColor: t.inputFilled },
  photoNoteTitle: { fontSize: 14.5, lineHeight: 20, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
  bottomSheet: {
    backgroundColor: t.card,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 10,
  },
  vehiclePhoto: { width: 64, height: 52, borderRadius: 10, backgroundColor: '#E5E7EB' },
  vehiclePhotoEmpty: { alignItems: 'center', justifyContent: 'center' },
  vehicleName: { fontSize: 14, lineHeight: 19, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
  checkedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999, backgroundColor: '#ECFDF5', alignSelf: 'flex-start',
  },
  checkedText: { fontSize: 11, lineHeight: 15, fontFamily: Fonts.poppinsSemiBold, color: '#047857' },
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
  actionBtnText: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: Fonts.poppinsBold,
    color: '#000',
  },
  locateMeButtonActive: {
    backgroundColor: '#4285F4',
    borderColor: '#4285F4',
  },
  // The screen's main button — the brand's, as Book and the rest of the app.
  completeJobBtn: {
    height: 52,
    backgroundColor: '#FFCE48',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
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
    color: '#111827',
    fontSize: 15,
    lineHeight: 21,
    fontFamily: Fonts.poppinsBold,
  },
  inspectionCard: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.border,
    gap: 10,
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
    height: 180,
    borderRadius: 14,
    backgroundColor: t.inputFilled,
  },
  otpCard: {
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
