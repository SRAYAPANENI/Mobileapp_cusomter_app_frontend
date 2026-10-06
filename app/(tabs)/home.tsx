import notifee from '@notifee/react-native';
import AnimatedBrandMark from '@/components/animated-brand-mark';
import { Skeleton } from '@/components/skeleton';
import { VoicePostModal } from '@/components/voice-post-modal';
import { QuickNeedModal } from '@/components/quick-need-modal';
import { PickupDropoffModal } from '@/components/pickup-dropoff-modal';
import { NoInternetState } from '@/components/no-internet-state';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SkoFyBottomBar } from '@/components/skofy-bottom-bar';
import { SkoFyMascot } from '@/components/skofy-mascot';
import { Colors, Fonts } from '@/constants/theme';
import { QUICK_NEEDS, QuickNeed } from '@/constants/quick-needs';
import { useIsOnline } from '@/hooks/use-is-online';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { RatingReminder } from '@/components/rating-reminder';
import { BASE_URL, SkoFyApi } from '@/services/api';
import { readHomeCache, writeHomeCache } from '@/services/homeCache';
import type { OfferResponse } from '@/types/offer';
import { discountText, OFFER_CARD_COLORS } from '@/utils/offer-format';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  AlertTriangle,
  Bell,
  Briefcase,
  Bug,
  ChevronRight,
  Clock,
  Code,
  Cpu,
  GraduationCap,
  Hammer,
  Home,
  Leaf,
  LocateFixed,
  LogOut,
  MapPin,
  Mic,
  Monitor,
  Navigation,
  Package,
  Paintbrush,
  Pencil,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Star,
  TicketPercent,
  User,
  UserRound,
  Users,
  Wrench,
  X as XIcon,
  Zap,
} from 'lucide-react-native';
import Reanimated, {
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Dimensions,
  FlatList,
  Linking,
  Modal,
  Platform,
  Animated as RNAnimated,
  Easing as RNEasing,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Conditionally import MapView only for native platforms
let MapView: any;
let Marker: any;
let Circle: any;
let PROVIDER_GOOGLE: any;

if (Platform.OS !== 'web') {
  try {
    const maps = require('react-native-maps');
    MapView = maps.default;
    Marker = maps.Marker;
    Circle = maps.Circle;
    PROVIDER_GOOGLE = maps.PROVIDER_GOOGLE;
  } catch (e) {
    console.log('Maps library not found');
  }
}

const { width, height } = Dimensions.get('window');

interface ServiceProvider {
  id: string;
  latitude: number;
  longitude: number;
  name: string;
}

// A provider this customer has booked more than once — Repeat Provider
// dashboard feature (find/re-book someone you've used before, instead of
// needing their number saved off-platform).
interface RegularProvider {
  provider_id: string;
  name: string;
  profile_image_url: string | null;
  profession: string | null;
  avg_rating: number;
  is_identity_verified: boolean;
  // Set False the moment this provider is hired onto any job, True again
  // on completion — a reliable "can you book them right now" signal, not
  // a manual online/offline toggle.
  is_available: boolean;
  jobs_with_you_count: number;
}

interface ActiveJob {
  id: string;
  title: string;
  location: string;
  postedAt: string;
  applicantCount: number;
  status: 'Open' | 'Closed';
  rawStatus: string;
  hasAssignedProvider: boolean;
  lat: number | null;
  lng: number | null;
  // "ON_SITE" (default) or "REMOTE" — a remote job has no physical location
  // to track, so its ongoing-job CTA goes to job-details instead of the
  // (map-based) track-provider screen.
  serviceMode: string;
  assignedProviderId: string | null;
  // Who's actually coming, once hired — fills the space on an accepted/
  // ongoing card that otherwise sits empty above the Track Provider button.
  assignedProvider: { provider_id: string; name: string; profile_image_url: string | null; profession: string | null } | null;
  // Direct-request shortlist progress — null once someone's hired or it fell
  // back to broadcast. directRequestProvider is who's being asked right now;
  // directRequestQueue is who's next, in order.
  directRequestProvider: { provider_id: string; name: string; profession: string | null } | null;
  directRequestQueue: { provider_id: string; name: string; profession: string | null }[];
  directRequestSentAt: string | null;
  directRequestTimeoutMinutes: number | null;
  // Fill the same empty-card-space gap for broadcast (non-direct) jobs and
  // the "provider cancelled after hire" state, same way assignedProvider
  // does for ongoing jobs.
  providersNotified: number;
  cancellationReason: string | null;
}

// type drives the Explore Skills card color (see renderSkillTiles): 'home'
// cards render on SkoFy yellow, 'pro' cards render on dark navy.
// Deliberately interleaved rather than grouped by type — leading with the
// same handful of common trades (plumber/electrician/AC) every home-services
// app already leads with is exactly the "looks like everyone else" read we're
// trying to avoid, given SkoFy is meant to span any skill, not just repairs.
const TOP_SERVICES: Array<{
  id: string; label: string;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  type: 'home' | 'pro';
}> = [
  { id: 'cleaner',     label: 'Cleaning',     Icon: Sparkles,      type: 'home' },
  { id: 'software',    label: 'Software Dev', Icon: Code,          type: 'pro' },
  { id: 'teacher',     label: 'Teacher',      Icon: GraduationCap, type: 'pro' },
  { id: 'painter',     label: 'Painter',      Icon: Paintbrush,    type: 'home' },
  { id: 'webdesign',   label: 'Web Design',   Icon: Monitor,       type: 'pro' },
  { id: 'plumber',     label: 'Plumber',      Icon: Wrench,        type: 'home' },
  { id: 'carpenter',   label: 'Carpenter',    Icon: Hammer,        type: 'home' },
  { id: 'electrician', label: 'Electrician',  Icon: Zap,           type: 'home' },
  { id: 'handyman',    label: 'Handyman',     Icon: Wrench,        type: 'home' },
  { id: 'ac',          label: 'AC Repair',    Icon: Snowflake,     type: 'home' },
  { id: 'pest',        label: 'Pest Control', Icon: Bug,           type: 'home' },
  { id: 'appliance',   label: 'Appliance',    Icon: Cpu,           type: 'home' },
  { id: 'gardener',    label: 'Gardener',     Icon: Leaf,          type: 'home' },
];


// expo-location's getCurrentPositionAsync has no built-in timeout — on a
// device that can't get a fresh GPS fix quickly (WiFi-only, weak signal
// indoors, no cellular assist), the call can hang indefinitely. Since
// setLoading(false) only ran after it resolved, that hung the whole
// dashboard's loading state forever on some devices/networks while others
// (with a fast fix) never noticed. Racing it against a timeout guarantees
// the loading state always resolves one way or another.
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

function urgencyRank(j: ActiveJob): number {
  // INVOICE_PENDING needs a decision from the customer — rank it above even
  // IN_PROGRESS so it doesn't get buried under jobs that don't need action.
  if (j.rawStatus === 'INVOICE_PENDING') return 0;
  if (j.rawStatus === 'IN_PROGRESS') return 1;
  if (j.rawStatus === 'INSPECTING') return 1;
  if (j.rawStatus === 'ACCEPTED') return 2;
  if (j.applicantCount > 0) return 3;
  return 4;
}

function mapApiJob(j: any): ActiveJob {
  const postedAt = j.created_at
    ? new Date(j.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : 'Just posted';
  const isOpen = ['POSTED', 'DISTRIBUTED'].includes(j.status);
  return {
    id: j.id,
    title: j.title || 'Service Request',
    location: j.full_address || '',
    postedAt,
    applicantCount: j.applicant_count ?? 0,
    status: isOpen ? 'Open' : 'Closed',
    rawStatus: j.status ?? '',
    hasAssignedProvider: !!j.assigned_provider_id,
    lat: j.lat ?? null,
    lng: j.lng ?? null,
    serviceMode: j.service_mode ?? 'ON_SITE',
    assignedProviderId: j.assigned_provider_id ?? null,
    assignedProvider: j.assigned_provider ?? null,
    directRequestProvider: j.direct_request_provider ?? null,
    directRequestQueue: j.direct_request_queue ?? [],
    directRequestSentAt: j.direct_request_sent_at ?? null,
    directRequestTimeoutMinutes: j.direct_request_timeout_minutes ?? null,
    providersNotified: j.providers_notified ?? 0,
    cancellationReason: j.cancellation_reason ?? null,
  };
}

// A tiny "typing indicator"-style pulse, reused on the "Finding providers
// near you…" row so it reads as actively searching rather than a static,
// possibly-stuck line of text. Its own component (not inline in
// renderJobCard) so each card instance owns its own animation lifecycle —
// renderJobCard is a plain function called per FlatList row, not a
// component, so hooks can't live there directly.
function SearchingDots() {
  const dots = useRef([0, 1, 2].map(() => new RNAnimated.Value(1))).current;

  useEffect(() => {
    const STAGGER = 160, HALF = 260, PERIOD = 900;
    const loops = dots.map((anim, i) =>
      RNAnimated.loop(RNAnimated.sequence([
        RNAnimated.delay(i * STAGGER),
        RNAnimated.timing(anim, { toValue: 1.6, duration: HALF, easing: RNEasing.inOut(RNEasing.ease), useNativeDriver: true }),
        RNAnimated.timing(anim, { toValue: 1, duration: HALF, easing: RNEasing.inOut(RNEasing.ease), useNativeDriver: true }),
        RNAnimated.delay(Math.max(0, PERIOD - i * STAGGER - HALF * 2)),
      ]))
    );
    const parallel = RNAnimated.parallel(loops);
    parallel.start();
    return () => parallel.stop();
  }, []);

  return (
    <View style={{ flexDirection: 'row', gap: 3, marginLeft: 6 }}>
      {dots.map((anim, i) => (
        <RNAnimated.View
          key={i}
          style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#9CA3AF', transform: [{ scale: anim }] }}
        />
      ))}
    </View>
  );
}

export default function HomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const insets = useSafeAreaInsets();
  const isOnline = useIsOnline();
  // States
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [address, setAddress] = useState<string>('Detecting Location...');
  const [loading, setLoading] = useState(true);
  const [serviceProviders, setServiceProviders] = useState<ServiceProvider[]>([]);
  // Empty until the real profile loads — this used to default to a
  // developer's own name ('Sumanth'), which stayed on screen permanently
  // for every user whenever the profile fetch failed (offline/no backend),
  // since the .catch() below never resets it.
  const [userName, setUserName] = useState('');
  const firstName = userName.split(' ')[0];
  const getTimeGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Morning';
    if (h < 17) return 'Afternoon';
    return 'Evening';
  };
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [mapReady, setMapReady] = useState(false);
  const [isLocationModalVisible, setIsLocationModalVisible] = useState(false);
  const [isExitModalVisible, setIsExitModalVisible] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);
  // True once we've established location truly can't be obtained (permission
  // denied, or a fresh fix timed out with no cached fallback either) — drives
  // the header address text and "Providers Near You" card so they say so
  // instead of silently showing nothing / a permanently-stuck "Detecting…".
  const [locationUnavailable, setLocationUnavailable] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [savedAddresses, setSavedAddresses] = useState<Array<{ id: string; label: string; full_address: string; lat?: number; lng?: number }>>([]);
  const [showNotifNudge, setShowNotifNudge] = useState(false);
  const [showViewLocationSheet, setShowViewLocationSheet] = useState(false);

  const lastBackPressTime = useRef<number>(0);

  const [preselectedProfession, setPreselectedProfession] = useState('');

  // ── Voice assistant state ──────────────────────────────────────────────────
  const [voiceModalVisible, setVoiceModalVisible] = useState(false);
  const [postMode, setPostMode] = useState<'voice' | 'manual' | 'quick' | 'pickupdrop'>('manual');
  const [pendingVoiceLat, setPendingVoiceLat] = useState<number | null>(null);
  const [pendingVoiceLng, setPendingVoiceLng] = useState<number | null>(null);
  const [pendingVoiceAddress, setPendingVoiceAddress] = useState<string>('');

  // ── Quick Needs (Super Fast) state — posts via a modal, not a route ────────
  const [quickNeedModalVisible, setQuickNeedModalVisible] = useState(false);
  const [selectedQuickNeed, setSelectedQuickNeed] = useState<QuickNeed | null>(null);
  const [pendingQuickLat, setPendingQuickLat] = useState<number | null>(null);
  const [pendingQuickLng, setPendingQuickLng] = useState<number | null>(null);
  const [pendingQuickAddress, setPendingQuickAddress] = useState<string>('');

  // ── "Book Now" job-kind chooser — asked before the location modal so
  // Pickup & Drop is a first-class choice, not a toggle buried inside the
  // standard wizard (which used to have its own separate, drifting copy of
  // this feature — see handlePickupDropTrigger below, the same path the
  // Home banner already uses). ─────────────────────────────────────────────
  const [bookChoiceModalVisible, setBookChoiceModalVisible] = useState(false);

  // ── Pickup & Drop state — posts via a modal, not a route ───────────────────
  const [pickupDropModalVisible, setPickupDropModalVisible] = useState(false);
  const [pendingDropoffLat, setPendingDropoffLat] = useState<number | null>(null);
  const [pendingDropoffLng, setPendingDropoffLng] = useState<number | null>(null);
  const [pendingDropoffAddress, setPendingDropoffAddress] = useState<string>('');
  const orbPulse = useRef(new RNAnimated.Value(1)).current;
  // Dot wave anims — 4 dots, each scales independently (staggered bounce like Google Assistant)
  const dotAnims = useRef([0,1,2,3].map(() => new RNAnimated.Value(1))).current;
  const dotsParallelRef = useRef<RNAnimated.CompositeAnimation | null>(null);

  const params = useLocalSearchParams<{ triggerBookLocation?: string }>();

  useFocusEffect(
    useCallback(() => {
      if (params.triggerBookLocation === 'true') {
        setPreselectedProfession('');
        setBookChoiceModalVisible(true);
        router.setParams({ triggerBookLocation: '' });
      }

      if (location) {
        refreshDashboard(location.coords.latitude, location.coords.longitude);
      }

      (SkoFyApi.addresses.list() as Promise<any[]>)
        .then(list => setSavedAddresses((list ?? []).map((a: any) => ({
          id: a.id, label: a.label, full_address: a.full_address,
          lat: a.lat ?? undefined, lng: a.lng ?? undefined,
        }))))
        .catch(() => {});

      SkoFyApi.customers.getProfile()
        .then((p: any) => {
          if (p?.name) setUserName(p.name);
          if (p?.profile_image_url) setProfileImageUrl(p.profile_image_url);
        })
        .catch(() => {});
      SkoFyApi.notifications.unreadCount()
        .then(setUnreadNotifCount)
        .catch(() => {});

      const backAction = () => {
        const currentTime = Date.now();
        if (currentTime - lastBackPressTime.current < 2000) {
          setIsExitModalVisible(true);
        } else {
          lastBackPressTime.current = currentTime;
        }
        return true;
      };

      const backHandler = BackHandler.addEventListener(
        'hardwareBackPress',
        backAction,
      );

      return () => backHandler.remove();
    // params.triggerBookLocation must be a dep — useFocusEffect always
    // invokes the LATEST callback ref on each focus, but that callback is
    // itself memoized by useCallback: without this dep, a focus event
    // arriving between two renders that didn't otherwise change
    // isExitModalVisible/location would still run a stale closure that
    // read an old (pre-navigation) value of this param, silently skipping
    // the Book Now chooser below.
    }, [isExitModalVisible, location, params.triggerBookLocation])
  );

  // Periodic live refresh while this tab stays focused — the focus effect
  // above only fires on the initial focus transition, so a new applicant, a
  // hire, or an inspection/invoice status change sat there stale until the
  // customer switched tabs away and back or pulled to refresh manually.
  useFocusEffect(
    useCallback(() => {
      if (!location) return;
      const interval = setInterval(() => {
        refreshDashboard(location.coords.latitude, location.coords.longitude);
      }, 15000);
      return () => clearInterval(interval);
    }, [location])
  );

  const [jobs, setJobs] = useState<ActiveJob[]>([]);
  const [dismissedJobIds, setDismissedJobIds] = useState<Set<string>>(new Set());
  const [dismissedIdsReady, setDismissedIdsReady] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Load persisted dismissed IDs on mount — must resolve before we render job cards
  // to prevent dismissed jobs flashing briefly on login before the Set is populated.
  useEffect(() => {
    SecureStore.getItemAsync('dismissed_job_ids').then(raw => {
      if (raw) {
        try { setDismissedJobIds(new Set(JSON.parse(raw))); } catch { /* corrupt, ignore */ }
      }
      setDismissedIdsReady(true);
    }).catch(() => setDismissedIdsReady(true));
  }, []);

  const [offers, setOffers] = useState<OfferResponse[]>([]);
  useEffect(() => {
    SkoFyApi.offers.list()
      .then((data: unknown) => setOffers(Array.isArray(data) ? (data as OfferResponse[]) : []))
      .catch(() => { /* dashboard still works without offers */ });
  }, []);

  const [regularProviders, setRegularProviders] = useState<RegularProvider[]>([]);
  // Also called from refreshDashboard (pull-to-refresh), not just on mount
  // — unlike this card's other fields (name/rating/profession), is_available
  // flips the moment a provider is hired on any job, so this one genuinely
  // needs to stay refreshable, not just fetched once per screen visit.
  const fetchRegularProviders = async () => {
    try {
      const data = await SkoFyApi.customers.getRepeatProviders();
      setRegularProviders(Array.isArray(data) ? data : []);
    } catch { /* dashboard still works without this section */ }
  };
  // On every focus, not just first mount — returning to Home after finishing
  // a 2nd job with the same provider should show them here straight away.
  useFocusEffect(useCallback(() => { fetchRegularProviders(); }, []));

  const dismissJob = (jobId: string) => {
    // Optimistic local update so card disappears instantly
    setDismissedJobIds(prev => {
      const next = new Set([...prev, jobId]);
      SecureStore.setItemAsync('dismissed_job_ids', JSON.stringify([...next])).catch(() => {});
      return next;
    });
    // Persist to server — survives reinstalls and new devices
    SkoFyApi.jobs.dismiss(jobId).catch(() => {});
  };

  const [skippingJobId, setSkippingJobId] = useState<string | null>(null);
  const skipDirectRequest = async (jobId: string) => {
    if (skippingJobId) return;
    setSkippingJobId(jobId);
    try {
      await SkoFyApi.jobs.skipDirect(jobId);
      if (location) await refreshDashboard(location.coords.latitude, location.coords.longitude);
    } catch { /* transient — next focus refresh will pick up the real state */ }
    setSkippingJobId(null);
  };

  const [carouselIndex, setCarouselIndex] = useState(0);
  const [etaMap, setEtaMap] = useState<Record<string, string>>({});
  const etaPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // All actionable jobs sorted by urgency (IN_PROGRESS → ACCEPTED → applicants → waiting)
  // Guard on dismissedIdsReady so dismissed jobs don't flash on login before SecureStore resolves
  const activeJobs = dismissedIdsReady
    ? jobs
        .filter(j =>
          !dismissedJobIds.has(j.id) &&
          !['COMPLETED', 'EXPIRED'].includes(j.rawStatus) &&
          !(j.rawStatus === 'CANCELLED' && !j.hasAssignedProvider)
        )
        .sort((a, b) => urgencyRank(a) - urgencyRank(b))
    : [];

  const activeJob = activeJobs[0] ?? null;
  const hasApplicants = (activeJob?.applicantCount ?? 0) > 0;

  const fabScale = useSharedValue(1);
  const cardGlow = useSharedValue(0.4);

  const fabAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: fabScale.value }],
  }));

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    shadowOpacity: cardGlow.value,
    borderColor: hasApplicants ? `rgba(16,185,129,${cardGlow.value})` : 'transparent',
    borderWidth: 2,
  }));

  // ETA polling — only runs for jobs where "arriving" is still meaningful;
  // once inspecting/invoice-pending the provider is already on-site.
  useEffect(() => {
    const hiredJobs = activeJobs.filter(j => ['ACCEPTED', 'IN_PROGRESS'].includes(j.rawStatus));
    if (hiredJobs.length === 0) {
      if (etaPollRef.current) { clearInterval(etaPollRef.current); etaPollRef.current = null; }
      return;
    }
    const poll = async () => {
      const updates: Record<string, string> = {};
      await Promise.all(hiredJobs.map(async (j) => {
        try {
          const t = await SkoFyApi.tracking.track(j.id);
          if (t.eta_minutes != null) {
            updates[j.id] = `${t.eta_minutes} min${t.eta_minutes === 1 ? '' : 's'}`;
          } else if (t.job_status === 'IN_PROGRESS') {
            updates[j.id] = 'In progress';
          }
        } catch { /* keep stale */ }
      }));
      if (Object.keys(updates).length > 0) setEtaMap(prev => ({ ...prev, ...updates }));
    };
    poll();
    etaPollRef.current = setInterval(poll, 3000);
    return () => { if (etaPollRef.current) { clearInterval(etaPollRef.current); etaPollRef.current = null; } };
  }, [activeJobs.map(j => j.id + j.rawStatus).join(',')]);

  // Animation for pulse effect (RN Built-in for Clock)
  const pulseAnim = useRef(new RNAnimated.Value(1)).current;
  const mapRef = useRef<any>(null);

  const fetchAddress = async (lat: number, lon: number) => {
    // Cached alongside the coordinates that produced it — next cold start
    // can prime both `address` and `location` together from one read,
    // skipping the "Finding your location..." gate for a reopen even
    // before this reverse-geocode call (or the GPS fix itself) resolves.
    writeHomeCache({ location: { latitude: lat, longitude: lon } });
    try {
      const response = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
      if (response.length > 0) {
        const item = response[0];
        const readableAddress = `${item.name || ''}, ${item.district || item.city || item.region || ''}`.trim();
        const resolved = readableAddress || 'Your Location';
        setAddress(resolved);
        writeHomeCache({ address: resolved });
      }
    } catch (error) {
      setAddress('Your Location');
    }
  };

  // Real-time Data Provisions — the two fetches below are independent of
  // each other, so they run concurrently (each with its own try/catch, so
  // one failing doesn't block or cancel the other) instead of the nearby-
  // providers call finishing before the active-jobs call even started.
  const refreshDashboard = async (lat: number, lon: number) => {
    const fetchNearbyProviders = async () => {
      try {
        const providers = await SkoFyApi.dashboard.getNearbyProviders(lat, lon);
        const mapped = providers
          .filter(p => p.lat != null && p.lng != null)
          .map(p => ({ id: p.provider_id, latitude: p.lat!, longitude: p.lng!, name: p.name }));
        setServiceProviders(mapped);
        // Only a non-empty result counts as "live data arrived" for the
        // cache-priming race guard — if this came back empty, letting a
        // still-in-flight cache read show last-known providers is better
        // than an empty map.
        if (mapped.length > 0) {
          liveDataArrivedRef.current = true;
          writeHomeCache({ serviceProviders: mapped });
        }
      } catch (err) {
        // Keep whatever is already shown (cached providers) rather than
        // inventing pins — fake dots used to be generated here.
        console.error('Failed to fetch nearby providers:', err);
      }
    };

    const fetchActiveJobs = async () => {
      try {
        // Map backend field names to ActiveJob shape
        const jobData = await SkoFyApi.dashboard.getActiveJobs();
        if (Array.isArray(jobData)) {
          const mapped = jobData.map(mapApiJob);
          liveDataArrivedRef.current = true;
          setJobs(mapped);
          writeHomeCache({ jobs: mapped });
          // Reverse-geocode jobs that were created via map-tap (no address_id → no full_address)
          mapped.forEach(async (j) => {
            if (!j.location && j.lat != null && j.lng != null) {
              try {
                const geo = await Location.reverseGeocodeAsync({ latitude: j.lat, longitude: j.lng });
                if (geo.length > 0) {
                  const g = geo[0];
                  const addr = [g.name, g.street, g.city, g.region].filter(Boolean).join(', ');
                  if (addr) setJobs(prev => prev.map(p => p.id === j.id ? { ...p, location: addr } : p));
                }
              } catch { /* leave blank */ }
            }
          });
        }
      } catch (err) {
        console.error('Failed to fetch active jobs:', err);
      }
    };

    await Promise.all([fetchNearbyProviders(), fetchActiveJobs(), fetchRegularProviders()]);
  };

  const handleRefresh = async () => {
    if (!location) return;
    setIsRefreshing(true);
    await refreshDashboard(location.coords.latitude, location.coords.longitude);
    setIsRefreshing(false);
  };

  useEffect(() => {
    notifee.getNotificationSettings()
      .then(s => { if (s.authorizationStatus < 1) setShowNotifNudge(true); })
      .catch(() => {});
  }, []);

  // Set the instant any of this mount's live fetches (profile, unread
  // count, saved addresses) actually lands — guards the cache-priming
  // read right below against overwriting fresh data if it happened to
  // resolve after a live response already did.
  const liveDataArrivedRef = useRef(false);

  useEffect(() => {
    // Cache-first paint: prime whatever was last successfully shown,
    // before any network call resolves, so a reopen renders the real
    // dashboard immediately instead of sitting on the "Finding your
    // location..." gate below while this run's fetches are still in
    // flight (the splash screen's prefetchHomeEssentials() already had a
    // head start on three of them too). Every fetch below still runs
    // exactly as it always did and overwrites this with fresh data the
    // moment it lands — this is a bridge to that, not a replacement for it.
    //
    // liveDataArrivedRef guards the (unlikely but real) inverse race: a
    // local file read is effectively always faster than a network round
    // trip, but isn't GUARANTEED to be — without this, a cache read that
    // happened to resolve after a live response already landed would
    // overwrite fresh data with stale cached data, with nothing left to
    // correct it until the next manual refresh.
    readHomeCache().then(cached => {
      if (!cached || liveDataArrivedRef.current) return;
      if (cached.userName) setUserName(cached.userName);
      if (cached.profileImageUrl) setProfileImageUrl(cached.profileImageUrl);
      if (cached.address) setAddress(cached.address);
      if (cached.unreadNotifCount != null) setUnreadNotifCount(cached.unreadNotifCount);
      if (Array.isArray(cached.jobs)) setJobs(cached.jobs as ActiveJob[]);
      if (Array.isArray(cached.serviceProviders)) setServiceProviders(cached.serviceProviders as ServiceProvider[]);
      if (Array.isArray(cached.savedAddresses)) setSavedAddresses(cached.savedAddresses as any);
      if (cached.location) {
        setLocation({
          coords: {
            latitude: cached.location.latitude,
            longitude: cached.location.longitude,
            altitude: null, accuracy: null, altitudeAccuracy: null, heading: null, speed: null,
          },
          timestamp: Date.now(),
        });
      }
    });

    // Load user name + profile image on mount
    SkoFyApi.customers.getProfile()
      .then(p => {
        liveDataArrivedRef.current = true;
        if (p?.name) { setUserName(p.name); writeHomeCache({ userName: p.name }); }
        if ((p as any)?.profile_image_url) {
          setProfileImageUrl((p as any).profile_image_url);
          writeHomeCache({ profileImageUrl: (p as any).profile_image_url });
        }
      })
      .catch((err) => {
        console.error('Failed to fetch profile:', err);
      });
    SkoFyApi.notifications.unreadCount()
      .then(c => { liveDataArrivedRef.current = true; setUnreadNotifCount(c); writeHomeCache({ unreadNotifCount: c }); })
      .catch(() => {});

    (SkoFyApi.addresses.list() as Promise<any[]>)
      .then(list => {
        liveDataArrivedRef.current = true;
        const mapped = (list ?? []).map((a: any) => ({
          id: a.id, label: a.label, full_address: a.full_address,
          lat: a.lat ?? undefined, lng: a.lng ?? undefined,
        }));
        setSavedAddresses(mapped);
        writeHomeCache({ savedAddresses: mapped });
      })
      .catch((err) => {
        console.error('Failed to fetch saved addresses:', err);
      });

    fetchLocationAndRefresh();
  }, []);

  // Pulled out of the mount effect so the "tap to retry" affordance (header
  // address text, Providers Near You card) can re-run the exact same flow
  // instead of duplicating it.
  const fetchLocationAndRefresh = async () => {
    let gotAnyLocation = false;
    try {
      setLocationUnavailable(false);
      // Small delay on first mount so the Android Activity window is fully
      // attached before we request permission — without this, the system
      // dialog is silently dropped on cold first-launch.
      await new Promise(resolve => setTimeout(resolve, 400));
      const requested = await Location.requestForegroundPermissionsAsync();
      if (requested.status !== 'granted') {
        setLoading(false);
        if (!requested.canAskAgain) {
          setShowLocationModal(true);
        }
        setLocationUnavailable(true);
        return;
      }

      // Show last cached GPS immediately — no satellite wait on cold start.
      const cached = await Location.getLastKnownPositionAsync({
        maxAge: 300000,
        requiredAccuracy: 500,
      });
      if (cached) {
        gotAnyLocation = true;
        setLocation(cached);
        fetchAddress(cached.coords.latitude, cached.coords.longitude);
        refreshDashboard(cached.coords.latitude, cached.coords.longitude);
        if (mapRef.current) {
          mapRef.current.animateToRegion({
            latitude: cached.coords.latitude,
            longitude: cached.coords.longitude,
            latitudeDelta: 0.0015,
            longitudeDelta: 0.0015,
          }, 1000);
        }
      }

      let userLocation = await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        10000,
        'Timed out getting current location',
      );
      gotAnyLocation = true;
      setLocation(userLocation);
      fetchAddress(userLocation.coords.latitude, userLocation.coords.longitude);

      // Provisioning real-time data sync
      refreshDashboard(userLocation.coords.latitude, userLocation.coords.longitude);

      // Immediate street-level auto-zoom on load
      if (mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: userLocation.coords.latitude,
          longitude: userLocation.coords.longitude,
          latitudeDelta: 0.0015,
          longitudeDelta: 0.0015,
        }, 2000);
      }
      setLoading(false);
    } catch (error) {
      // A fresh fix timing out is not fatal if a cached fix already got us
      // showing something — only tell the user "location unavailable" when
      // we truly have nothing (no cached fix, no fresh fix, permission was
      // fine). Loading must still resolve instead of hanging either way.
      setLoading(false);
      if (!gotAnyLocation) setLocationUnavailable(true);
    }
  };

  // Pulse animation for waiting jobs (RN Animated — no Reanimated worklets)
  useEffect(() => {
    if (activeJob && activeJob.applicantCount === 0) {
      RNAnimated.loop(
        RNAnimated.sequence([
          RNAnimated.timing(pulseAnim, { toValue: 1.2, duration: 1000, easing: RNEasing.inOut(RNEasing.ease), useNativeDriver: true }),
          RNAnimated.timing(pulseAnim, { toValue: 1, duration: 1000, easing: RNEasing.inOut(RNEasing.ease), useNativeDriver: true }),
        ])
      ).start();
      fabScale.value = withSpring(1);
      cardGlow.value = withTiming(0.4, { duration: 300 });
    } else if (activeJob && activeJob.applicantCount > 0) {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
      // One-time spring bounce when applicants arrive — NOT infinite
      fabScale.value = withSpring(1.15, { damping: 6 });
      cardGlow.value = withTiming(0.8, { duration: 500 });
    }
  }, [activeJob?.applicantCount]);

  // Periodic jitter to simulate providers moving (Uber style)
  useEffect(() => {
    const jitter = setInterval(() => {
      setServiceProviders(prev => prev.map(p => ({
        ...p,
        latitude: p.latitude + (Math.random() - 0.5) * 0.00002, // Smaller jitter for street level
        longitude: p.longitude + (Math.random() - 0.5) * 0.00002,
      })));
    }, 3000);
    return () => clearInterval(jitter);
  }, []);


  // Orb breathing + dot wave animations — both start once on mount
  useEffect(() => {
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(orbPulse, { toValue: 1.12, duration: 1300, easing: RNEasing.inOut(RNEasing.ease), useNativeDriver: true }),
        RNAnimated.timing(orbPulse, { toValue: 1, duration: 1300, easing: RNEasing.inOut(RNEasing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();

    // Each dot: delay(i*180ms) → scale up → scale down → pause → loop
    // All 4 loops have the same period (1200ms) so the phase offset is stable across loops
    const STAGGER = 180;
    const HALF = 300;
    const PERIOD = 1200;
    const dotLoops = dotAnims.map((anim, i) =>
      RNAnimated.loop(RNAnimated.sequence([
        RNAnimated.delay(i * STAGGER),
        RNAnimated.timing(anim, { toValue: 1.7, duration: HALF, easing: RNEasing.inOut(RNEasing.ease), useNativeDriver: true }),
        RNAnimated.timing(anim, { toValue: 1, duration: HALF, easing: RNEasing.inOut(RNEasing.ease), useNativeDriver: true }),
        RNAnimated.delay(PERIOD - i * STAGGER - HALF * 2),
      ]))
    );
    dotsParallelRef.current = RNAnimated.parallel(dotLoops);
    dotsParallelRef.current.start();

    return () => { loop.stop(); dotsParallelRef.current?.stop(); };
  }, []);

  const handleServiceTap = (service: typeof TOP_SERVICES[0], mode: 'voice' | 'manual' = 'manual') => {
    setPreselectedProfession(service.label);
    setPostMode(mode);
    setIsLocationModalVisible(true);
  };

  const handlePostRequestTrigger = () => {
    setPreselectedProfession('');
    setPostMode('manual');
    setIsLocationModalVisible(true);
  };

  const handleQuickNeedTap = (need: QuickNeed) => {
    // "Super Fast" tiles — a genuinely different flow from the rest of
    // Explore Services, not the normal describe-problem wizard with
    // urgency pre-set (that was the old approach and it wasn't actually
    // fast: the customer still had to describe the problem and pick
    // skills). This only asks for location; title/description/skill are
    // predefined per need type (see constants/quick-needs.ts) and posted
    // via QuickNeedModal — no separate screen.
    setSelectedQuickNeed(need);
    setPreselectedProfession('');
    setPostMode('quick');
    setIsLocationModalVisible(true);
  };

  const handlePickupDropTrigger = () => {
    // The location confirmed here becomes the DROPOFF point ("bring it to
    // me here"). Only the pickup point (a verified business) is asked
    // separately, inside PickupDropoffModal — the single dedicated place
    // this feature lives now (reached from this banner and from the "Book
    // Now" chooser below).
    setPreselectedProfession('');
    setPostMode('pickupdrop');
    setIsLocationModalVisible(true);
  };

  const handleVoiceTrigger = () => {
    setPostMode('voice');
    setIsLocationModalVisible(true);
  };

  const handleBookChoiceStandard = () => {
    setBookChoiceModalVisible(false);
    handlePostRequestTrigger();
  };

  const handleBookChoicePickupDrop = () => {
    setBookChoiceModalVisible(false);
    handlePickupDropTrigger();
  };

  const handleLocateMe = () => {
    if (location && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.002,
        longitudeDelta: 0.002,
      }, 1000);
    }
  };

  const handleCancelJob = (jobId: string) => {
    setJobs(prev => prev.filter(j => j.id !== jobId));
  };

  const confirmLocationSelection = (addr: string, lat?: number, lng?: number) => {
    setIsLocationModalVisible(false);
    setSelectedLocation(addr);
    if (postMode === 'voice') {
      setPendingVoiceLat(lat ?? null);
      setPendingVoiceLng(lng ?? null);
      setPendingVoiceAddress(addr);
      setVoiceModalVisible(true);
    } else if (postMode === 'quick') {
      setPendingQuickLat(lat ?? null);
      setPendingQuickLng(lng ?? null);
      setPendingQuickAddress(addr);
      setQuickNeedModalVisible(true);
    } else if (postMode === 'pickupdrop') {
      setPendingDropoffLat(lat ?? null);
      setPendingDropoffLng(lng ?? null);
      setPendingDropoffAddress(addr);
      setPickupDropModalVisible(true);
    } else {
      router.push({
        pathname: '/post-requirement/step1',
        params: {
          selectedAddress: addr,
          lat: lat?.toString() ?? '',
          lng: lng?.toString() ?? '',
          profession: preselectedProfession,
        },
      });
      setPreselectedProfession('');
    }
  };

  const CARD_WIDTH = width - 32;

  const renderJobCard = ({ item: job }: { item: ActiveJob }) => {
    // Hired and still headed toward completion — includes the on-site
    // inspection/invoice-negotiation window (bidding is retired, so price
    // is only ever set post-inspection), not just ACCEPTED/IN_PROGRESS.
    // Without INSPECTING/INVOICE_PENDING here, the card would fall through
    // to "Waiting for providers"/"View Applicants" and lose its "Track
    // Provider" CTA the moment inspection actually starts.
    const isOngoing = ['ACCEPTED', 'INSPECTING', 'INVOICE_PENDING', 'IN_PROGRESS'].includes(job.rawStatus);
    const isCancelledPostHire = job.rawStatus === 'CANCELLED' && job.hasAssignedProvider;
    const isWaiting = !isOngoing && !isCancelledPostHire && job.applicantCount === 0;

    // SkoFy palette: yellow for waiting, indigo for active, red for cancelled, green for applicants
    let accentColor = '#FFCE48';
    if (isOngoing) accentColor = '#6366F1';
    else if (isCancelledPostHire) accentColor = '#EF4444';
    else if (!isWaiting) accentColor = '#22C55E';

    const accentBg = isOngoing ? '#EEF2FF' : isCancelledPostHire ? '#FEF2F2' : isWaiting ? '#FFFBEB' : '#F0FDF4';

    let statusLabel = isWaiting ? 'Waiting for providers' : `${job.applicantCount} Provider${job.applicantCount === 1 ? '' : 's'} Applied`;
    if (job.rawStatus === 'INSPECTING') statusLabel = 'Inspecting the job';
    else if (job.rawStatus === 'INVOICE_PENDING') statusLabel = 'Invoice ready';
    else if (isOngoing) statusLabel = 'Provider on the way';
    // Neutral wording — this card covers both "you cancelled after hiring"
    // and "the provider backed out and no one else was available"; the API
    // doesn't currently distinguish who initiated it.
    if (isCancelledPostHire) statusLabel = 'Job Cancelled';

    const isRemote = job.serviceMode === 'REMOTE';
    let ctaLabel = isWaiting ? 'View Job' : 'View Applicants';
    if (isOngoing) ctaLabel = isRemote ? 'View Job' : 'Track Provider';

    const handleCta = () => {
      if (isOngoing && isRemote) {
        // A remote job has no physical location to track — there's nothing
        // for the map-based track-provider screen to show.
        router.push({ pathname: '/job-details', params: { jobId: job.id } } as any);
      } else if (isOngoing) {
        // push, not replace — replacing the Home tab itself left
        // track-provider with nothing behind it in the stack, so the
        // hardware back button exited the app instead of returning here.
        router.push({ pathname: '/track-provider', params: { jobId: job.id } } as any);
      } else if (!isWaiting) {
        router.push({ pathname: '/applicants', params: { jobId: job.id } } as any);
      } else {
        router.push('/my-jobs');
      }
    };

    const eta = etaMap[job.id];

    return (
      <View style={[styles.jobCardContent, { width: CARD_WIDTH }]}>
        {/* Colored accent bar at top */}
        <View style={[styles.jobCardAccentBar, { backgroundColor: accentColor }]} />
        <View style={styles.jobCardBody}>
        <View style={styles.jobHeader}>
          <View style={styles.statusInfo}>
            <View style={[styles.iconContainer, { backgroundColor: accentBg }]}>
              {isWaiting ? (
                <RNAnimated.View style={{ transform: [{ scale: pulseAnim }] }}>
                  <Clock size={20} color={accentColor} />
                </RNAnimated.View>
              ) : (
                <Users size={20} color={accentColor} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <View style={[styles.statusBadge, { backgroundColor: accentBg }]}>
                <ThemedText style={[styles.statusTitle, { color: accentColor }]}>{statusLabel.toUpperCase()}</ThemedText>
              </View>
              <ThemedText style={styles.jobTitle} numberOfLines={1}>{job.title}</ThemedText>
            </View>
          </View>
          <ThemedText style={styles.timeText}>{job.postedAt}</ThemedText>
        </View>

        {/* Location row — address before hire, live ETA after hire */}
        <View style={styles.jobLocationRow}>
          {isOngoing && eta ? (
            <>
              <Navigation size={14} color={accentColor} />
              <ThemedText style={[styles.jobLocationText, { color: accentColor, fontFamily: Fonts.poppinsSemiBold }]}>
                Arriving in {eta}
              </ThemedText>
            </>
          ) : (
            <>
              <MapPin size={14} color="#6B7280" />
              <ThemedText style={styles.jobLocationText} numberOfLines={1}>
                {job.location || 'Location set'}
              </ThemedText>
            </>
          )}
        </View>

        {/* Who's actually coming — the ongoing-card variant used to have
            nothing here, just empty space up to the Track Provider button,
            since it's the shortest-content card of the bunch. */}
        {isOngoing && job.assignedProvider && (
          <View style={styles.assignedProviderRow}>
            {job.assignedProvider.profile_image_url ? (
              <Image source={{ uri: job.assignedProvider.profile_image_url }} style={styles.assignedProviderAvatar} />
            ) : (
              <View style={[styles.assignedProviderAvatar, styles.assignedProviderAvatarFallback]}>
                <ThemedText style={styles.assignedProviderInitial}>
                  {job.assignedProvider.name[0]?.toUpperCase() ?? '?'}
                </ThemedText>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.assignedProviderName} numberOfLines={1}>{job.assignedProvider.name}</ThemedText>
              {job.assignedProvider.profession && (
                <ThemedText style={styles.assignedProviderProfession} numberOfLines={1}>{job.assignedProvider.profession}</ThemedText>
              )}
            </View>
          </View>
        )}

        {/* Direct-request shortlist progress — who's being asked now, who's next */}
        {isWaiting && job.directRequestProvider && (
          <View style={styles.directRequestRow}>
            <ThemedText style={styles.directRequestText} numberOfLines={1}>
              Waiting on {job.directRequestProvider.name.split(' ')[0]}
              {job.directRequestQueue.length > 0
                ? ` · then ${job.directRequestQueue.map(p => p.name.split(' ')[0]).join(', ')}`
                : ''}
            </ThemedText>
            <TouchableOpacity
              disabled={skippingJobId === job.id}
              onPress={() => skipDirectRequest(job.id)}
              style={styles.directRequestSkipBtn}
            >
              {skippingJobId === job.id ? (
                <ActivityIndicator size="small" color="#6366F1" />
              ) : (
                <ThemedText style={styles.directRequestSkipText}>Skip</ThemedText>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Broadcast (non-direct) jobs still open for bids — same empty-space
            gap as the other card variants, filled with how many providers
            were actually notified (and how many have responded so far, once
            any have) instead of nothing. */}
        {!isOngoing && !isCancelledPostHire && !job.directRequestProvider && (
          <View style={[styles.notifiedRow, { flexDirection: 'row', alignItems: 'center' }]}>
            <ThemedText style={styles.notifiedText} numberOfLines={1}>
              {job.providersNotified > 0
                ? (job.applicantCount > 0
                    ? `Notified ${job.providersNotified} providers · ${job.applicantCount} applied so far`
                    : `Notified ${job.providersNotified} providers nearby`)
                : 'Finding providers near you'}
            </ThemedText>
            {job.providersNotified === 0 && <SearchingDots />}
          </View>
        )}

        {/* Cancelled after a provider was hired — show why. */}
        {isCancelledPostHire && job.cancellationReason && (
          <View style={styles.notifiedRow}>
            <ThemedText style={styles.notifiedText} numberOfLines={2}>
              "{job.cancellationReason}"
            </ThemedText>
          </View>
        )}

        <View style={{ marginTop: 'auto' }}>
          {isCancelledPostHire ? (
            // The backend now demotes the cancelled hire's application out
            // of applicantCount and reopens to DISTRIBUTED whenever another
            // applicant is actually available — so a job only ever reaches
            // here (CANCELLED, not DISTRIBUTED) when there's genuinely no
            // one left. There's nothing to rehire; just let them clear it.
            <View style={styles.jobActionRow}>
              <TouchableOpacity
                style={[styles.viewApplicantsButton, { backgroundColor: '#EF4444', flex: 1 }]}
                onPress={() => dismissJob(job.id)}
              >
                <ThemedText style={styles.viewApplicantsText}>Dismiss</ThemedText>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.jobActionRow}>
              <TouchableOpacity
                style={[styles.viewApplicantsButton, { backgroundColor: accentColor, flex: 1 }]}
                onPress={handleCta}
              >
                <ThemedText style={styles.viewApplicantsText}>{ctaLabel}</ThemedText>
                <ChevronRight size={18} color="#000" />
              </TouchableOpacity>
            </View>
          )}
        </View>
        </View>{/* end jobCardBody */}
      </View>
    );
  };

  // White card + colored icon badge, not a full-bleed saturated color
  // block. One dominant brand color (yellow-gold) is reserved for primary
  // actions; every other hue here is a small, purposeful accent on an
  // otherwise neutral card — not a competing "mini-brand" per category.
  // Pro/remote used flat neutral gray (#E5E7EB/#1F2937) — no actual hue, so
  // it read as "disabled" rather than as its own category next to amber and
  // red. A muted indigo (the near-universal cross-cultural association for
  // "professional/office work" — LinkedIn, etc.) gives it a real identity
  // while staying restrained: pastel badge + moderate-saturation icon only,
  // same small-dose-of-color rule the other categories already follow.
  const TILE_ACCENTS: Record<'home' | 'pro' | 'urgent', { bg: string; fg: string }> = {
    home: { bg: '#FEF3C7', fg: '#B45309' },
    pro: { bg: '#E0E7FF', fg: '#4338CA' },
    urgent: { bg: '#FEE2E2', fg: '#DC2626' },
  };
  const renderSkillCard = ({ key, variant = 'home', Icon, label, ctaLabel, onPress }: {
    key: string; variant?: 'home' | 'pro' | 'urgent';
    Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number; style?: any }>;
    label: string; ctaLabel: string; onPress: () => void;
  }) => {
    const accent = TILE_ACCENTS[variant];
    return (
      <TouchableOpacity key={key} style={styles.skillTile} onPress={onPress} activeOpacity={0.85}>
        <View style={[styles.skillTileIconBox, { backgroundColor: accent.bg }]}>
          <Icon size={19} color={accent.fg} strokeWidth={2} />
        </View>
        <View>
          <ThemedText style={styles.skillTileLabel} numberOfLines={2}>{label}</ThemedText>
          <View style={styles.skillTileCtaRow}>
            <ThemedText style={[styles.skillTileCtaText, { color: accent.fg }]}>{ctaLabel}</ThemedText>
            <ChevronRight size={13} color={accent.fg} />
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // Its own section, separate from Explore Services — these tap straight
  // into the location picker + a modal (see QuickNeedModal below), not the
  // normal describe-problem wizard, so they read as a distinct category
  // rather than one more tile lost in that row.
  const renderQuickNeedsSection = () => (
    <Reanimated.View entering={FadeInUp.delay(330)} style={styles.skillTilesSection}>
      <ThemedText style={styles.sectionLabel}>Super Fast</ThemedText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.skillTilesRow}
      >
        {QUICK_NEEDS.map(need => renderSkillCard({
          key: `quick_${need.id}`, variant: 'urgent', Icon: need.Icon, label: need.label,
          ctaLabel: 'Get Help', onPress: () => handleQuickNeedTap(need),
        }))}
      </ScrollView>
    </Reanimated.View>
  );

  // Single wide banner, not part of a scroll — there's only one of these
  // (unlike Super Fast's 7 need types), so a horizontal scroll row would
  // look like an empty/broken row with one lonely tile in it.
  const renderPickupDropBanner = () => (
    <Reanimated.View entering={FadeInUp.delay(340)} style={styles.pickupDropBannerWrap}>
      <TouchableOpacity style={styles.pickupDropBanner} onPress={handlePickupDropTrigger} activeOpacity={0.85}>
        <View style={styles.pickupDropIconWrap}>
          <Package size={20} color="#0369A1" />
        </View>
        <View style={{ flex: 1 }}>
          <ThemedText style={styles.pickupDropTitle}>Pickup & Drop</ThemedText>
          <ThemedText style={styles.pickupDropSub}>Groceries, pharmacy & more — picked up and delivered</ThemedText>
        </View>
        <ChevronRight size={18} color="#9CA3AF" />
      </TouchableOpacity>
    </Reanimated.View>
  );

  // Skill shortcuts + the trust promo, as same-sized cards in a single
  // scrollable row.
  const renderSkillTiles = () => (
    <Reanimated.View entering={FadeInUp.delay(350)} style={styles.skillTilesSection}>
      <ThemedText style={styles.sectionLabel}>Explore Services</ThemedText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.skillTilesRow}
      >
        {TOP_SERVICES.map(s => renderSkillCard({
          key: s.id, variant: s.type, Icon: s.Icon, label: s.label,
          ctaLabel: 'Book', onPress: () => handleServiceTap(s, 'manual'),
        }))}
        {renderSkillCard({
          key: 'ad_trust', variant: 'home', Icon: Sparkles, label: 'Verified Pros',
          ctaLabel: 'Learn More', onPress: () => router.push('/offers'),
        })}
      </ScrollView>
    </Reanimated.View>
  );

  // Hidden entirely when empty (a brand-new customer, or nobody re-booked
  // yet) rather than shown as an empty section — same convention as the
  // Deals strip above and Job History on profile.tsx.
  const renderRegularProvidersSection = () => regularProviders.length > 0 && (
    <View style={styles.dealsSection}>
      <View style={styles.dealsSectionHeader}>
        <ThemedText style={[styles.sectionLabel, { marginBottom: 0 }]}>Your Regular Providers</ThemedText>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dealsList}>
        {regularProviders.map((p) => (
          <TouchableOpacity
            key={p.provider_id}
            style={styles.regularProviderCard}
            activeOpacity={0.85}
            onPress={() => router.push({
              pathname: '/provider-details' as any,
              params: { providerId: p.provider_id, viewOnly: 'true' },
            })}
          >
            <View style={styles.regularProviderTopRow}>
              <View>
                {p.profile_image_url ? (
                  <Image source={{ uri: p.profile_image_url }} style={styles.regularProviderAvatar} />
                ) : (
                  <View style={[styles.regularProviderAvatar, styles.regularProviderAvatarFallback]}>
                    <Text style={styles.regularProviderAvatarInitial}>{(p.name[0] ?? '?').toUpperCase()}</Text>
                  </View>
                )}
                {/* Presence dot — a repeat provider being booked on another
                    job right now is exactly the moment a customer would
                    otherwise tap through expecting to book them and find
                    out only after. See is_available's own comment above. */}
                <View style={[
                  styles.regularProviderPresenceDot,
                  { backgroundColor: p.is_available ? '#10B981' : '#9CA3AF' },
                ]} />
              </View>
              <View style={styles.regularProviderBadge}>
                <ThemedText style={styles.regularProviderBadgeText} numberOfLines={1}>{p.jobs_with_you_count}x booked</ThemedText>
              </View>
            </View>
            <ThemedText style={styles.regularProviderName} numberOfLines={1}>{p.name}</ThemedText>
            {p.profession && (
              <ThemedText style={styles.regularProviderProfession} numberOfLines={1}>{p.profession}</ThemedText>
            )}
            <ThemedText style={[styles.regularProviderAvailabilityText, { color: p.is_available ? '#10B981' : '#9CA3AF' }]} numberOfLines={1}>
              {p.is_available ? 'Available now' : 'Currently busy'}
            </ThemedText>
            <View style={styles.regularProviderStatsRow}>
              {/* Ratings are validated 1-5 server-side (see job schemas) —
                  avg_rating can only read exactly 0 via its column default,
                  never a real score, so that's "no reviews yet," not "zero
                  stars." A provider a customer has rebooked but just hasn't
                  rated showing a literal "0.0" would read as damning. */}
              {p.avg_rating > 0 ? (
                <>
                  <Star size={12} color="#F59E0B" fill="#F59E0B" />
                  <ThemedText style={styles.regularProviderStatsText}>{p.avg_rating.toFixed(1)}</ThemedText>
                </>
              ) : (
                <ThemedText style={[styles.regularProviderStatsText, { color: '#9CA3AF' }]} numberOfLines={1}>No ratings yet</ThemedText>
              )}
              {p.is_identity_verified && (
                <ShieldCheck size={12} color="#10B981" style={{ marginLeft: 6 }} />
              )}
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  const renderCultfitHeroCard = () => (
    <Reanimated.View entering={FadeInUp.delay(200)} style={styles.cultfitHeroCard}>
      {/* Title + mascot row — the sparkle sits inline with the title instead
          of its own badge row above, so this card takes noticeably less
          vertical space than a title/subtitle/badge stack would. The
          subtitle is left to wrap (not numberOfLines={1}) since this column
          now shares its width with the mascot — capping it at one line
          risked a mid-sentence ellipsis on narrower screens. */}
      <View style={styles.cultfitHeroTitleRow}>
        <View style={{ flex: 1 }}>
          <View style={styles.cultfitTitleInline}>
            <Sparkles size={16} color="#D97706" />
            <ThemedText style={styles.cultfitHeroTitle}>What do you need help with?</ThemedText>
          </View>
          <ThemedText style={styles.cultfitHeroSub}>
            Just say it — AI finds you a verified pro.
          </ThemedText>
        </View>
        <SkoFyMascot size={48} />
      </View>

      {/* CTA Button Row */}
      <View style={styles.cultfitHeroCtaRow}>
        {/* Dark + gold instead of a competing gradient hue — the one bold
            multi-color flourish in this app is reserved for the persistent
            "Hey Dodorez" orb in the bottom bar; every other surface stays
            branded (charcoal + gold) so that orb keeps reading as special
            instead of one more colorful thing among many. */}
        <TouchableOpacity style={styles.cultfitPrimaryCta} onPress={handleVoiceTrigger} activeOpacity={0.88}>
          <View style={styles.cultfitCtaSolid}>
            <Mic size={17} color="#FFCE48" strokeWidth={2.5} />
            <ThemedText style={styles.cultfitPrimaryCtaText}>Ask Dodorez</ThemedText>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.cultfitSecondaryCta} onPress={handlePostRequestTrigger} activeOpacity={0.88}>
          <Pencil size={15} color="#111827" strokeWidth={2} />
          <ThemedText style={styles.cultfitSecondaryCtaText}>Manual</ThemedText>
        </TouchableOpacity>
      </View>
    </Reanimated.View>
  );

  const renderSkoFyBottomBar = () => (
    <Reanimated.View entering={FadeInUp.delay(300)} style={[styles.skofyBottomBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <View style={styles.navBarRow}>
        {/* 1. Home Tab */}
        <TouchableOpacity style={styles.navTabItem} onPress={() => router.push('/(tabs)/home')} activeOpacity={0.7}>
          <View style={styles.activeTabPill}>
            <Home size={20} color="#111827" strokeWidth={2.5} />
            <ThemedText style={styles.navTabLabelActive}>Home</ThemedText>
          </View>
          <View style={styles.activeTabDot} />
        </TouchableOpacity>

        {/* 2. My Jobs Tab */}
        <TouchableOpacity style={styles.navTabItem} onPress={() => router.push('/my-jobs')} activeOpacity={0.7}>
          <View style={{ position: 'relative' }}>
            <Briefcase size={22} color="#6B7280" strokeWidth={2} />
            {activeJobs.length > 0 && (
              <View style={styles.navBadge}>
                <Text style={styles.navBadgeText}>{activeJobs.length}</Text>
              </View>
            )}
          </View>
          <ThemedText style={styles.navTabLabel}>My Jobs</ThemedText>
        </TouchableOpacity>

        {/* 3. Center Elevated Voice Orb */}
        <View style={styles.centerNavOrbWrapper}>
          <TouchableOpacity onPress={handleVoiceTrigger} activeOpacity={0.88}>
            <RNAnimated.View style={[styles.centerNavOrb, { transform: [{ scale: orbPulse }] }]}>
              <LinearGradient
                colors={['#FFCE48', '#F59E0B']}
                start={{ x: 0.1, y: 0.05 }}
                end={{ x: 0.95, y: 1 }}
                style={styles.centerNavOrbGradient}
              />
              <Mic size={24} color="#111827" strokeWidth={2.5} />
            </RNAnimated.View>
          </TouchableOpacity>
          <ThemedText style={styles.centerNavOrbLabel}>Hey Dodorez</ThemedText>
        </View>

        {/* 4. Book Tab */}
        <TouchableOpacity style={styles.navTabItem} onPress={handlePostRequestTrigger} activeOpacity={0.7}>
          <Pencil size={22} color="#6B7280" strokeWidth={2} />
          <ThemedText style={styles.navTabLabel}>Book</ThemedText>
        </TouchableOpacity>

        {/* 5. Profile Tab */}
        <TouchableOpacity style={styles.navTabItem} onPress={() => router.push('/profile')} activeOpacity={0.7}>
          {profileImageUrl ? (
            <Image
              source={{ uri: profileImageUrl }}
              style={styles.navAvatarImage}
              contentFit="cover"
            />
          ) : (
            <View style={styles.navAvatarFallback}>
              <Text style={styles.navAvatarInitialsText}>
                {userName ? userName[0].toUpperCase() : 'U'}
              </Text>
            </View>
          )}
          <ThemedText style={styles.navTabLabel}>Profile</ThemedText>
        </TouchableOpacity>
      </View>
    </Reanimated.View>
  );

  const renderActiveJobCard = () => {
    if (activeJobs.length === 0) return null;
    return (
      <Reanimated.View entering={FadeInUp.delay(500)} style={styles.floatingJobCard}>
        <FlatList
          data={activeJobs}
          keyExtractor={j => j.id}
          renderItem={renderJobCard}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          snapToInterval={CARD_WIDTH}
          decelerationRate="fast"
          onMomentumScrollEnd={e => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / CARD_WIDTH);
            setCarouselIndex(idx);
          }}
          style={{ borderRadius: 20, overflow: 'hidden' }}
        />
        {activeJobs.length > 1 && (
          <View style={styles.dotRow}>
            {activeJobs.map((_, i) => (
              <View key={i} style={[styles.dot, i === carouselIndex && styles.dotActive]} />
            ))}
          </View>
        )}
      </Reanimated.View>
    );
  };

  if (loading && !location && !isOnline) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <StatusBar barStyle="dark-content" />
        <NoInternetState onRetry={fetchLocationAndRefresh} />
      </ThemedView>
    );
  }

  if (loading && !location) {
    // Only reachable on a genuine first-ever open (or an unreadable cache) —
    // the mount effect above primes `location` from cache otherwise, which
    // already skips past this gate with real content. Shaped like the real
    // header + hero card + quick-needs row below (see the return() JSX)
    // rather than a bare spinner, so the real layout doesn't "pop in" once
    // data arrives — it just fills in.
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" />
        <View style={[styles.headerSection, { paddingTop: Platform.OS === 'ios' ? insets.top + 8 : 36 }]}>
          <View style={styles.headerBrandRow}>
            <View style={styles.headerBrandLeft}>
              <AnimatedBrandMark size={28} nameSize={20} centered={false} />
            </View>
            <Skeleton width={22} height={22} borderRadius={11} />
          </View>
          <Skeleton width="60%" height={22} style={{ marginTop: 14 }} />
          <Skeleton width="45%" height={16} style={{ marginTop: 10 }} />
        </View>
        <View style={{ paddingHorizontal: 20, marginTop: 20, gap: 16 }}>
          <Skeleton width="100%" height={140} borderRadius={20} />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Skeleton width="48%" height={90} borderRadius={16} />
            <Skeleton width="48%" height={90} borderRadius={16} />
          </View>
          <Skeleton width="40%" height={18} />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Skeleton width={72} height={72} borderRadius={16} />
            <Skeleton width={72} height={72} borderRadius={16} />
            <Skeleton width={72} height={72} borderRadius={16} />
            <Skeleton width={72} height={72} borderRadius={16} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

      {/* ── Main scrollable content ── */}
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor="#FFCE48" colors={['#FFCE48']} />
        }
      >
        {/* Notification nudge */}
        {showNotifNudge && (
          <View style={[styles.notifNudge, { marginTop: Platform.OS === 'ios' ? insets.top + 8 : 44 }]}>
            <View style={styles.notifNudgeIconWrap}>
              <Bell size={18} color="#FFCE48" />
            </View>
            <View style={styles.notifNudgeBody}>
              <ThemedText style={styles.notifNudgeTitle}>Turn on notifications</ThemedText>
              <ThemedText style={styles.notifNudgeText}>Get instant alerts when providers apply to your jobs.</ThemedText>
            </View>
            <TouchableOpacity style={styles.notifNudgeBtn} onPress={() => { setShowNotifNudge(false); notifee.openNotificationSettings(); }}>
              <ThemedText style={styles.notifNudgeBtnText}>Enable</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.notifNudgeDismiss} onPress={() => setShowNotifNudge(false)}>
              <XIcon size={16} color="#6B7280" />
            </TouchableOpacity>
          </View>
        )}

        {/* ── Redesigned Header ── */}
        <Reanimated.View entering={FadeInUp.duration(600)} style={[styles.headerSection, { paddingTop: Platform.OS === 'ios' ? insets.top + 8 : 36 }]}>

          {/* Brand Row: Logo + Dodorez name */}
          <View style={styles.headerBrandRow}>
            <View style={styles.headerBrandLeft}>
              <AnimatedBrandMark size={28} nameSize={20} centered={false} />
            </View>
            <TouchableOpacity style={styles.notificationButton} onPress={() => { setUnreadNotifCount(0); router.push('/notifications'); }}>
              <Bell size={22} color="#111827" />
              {unreadNotifCount > 0 && <View style={styles.notifBadge} />}
            </TouchableOpacity>
          </View>

          {/* Greeting — name inline, not its own big line; omitted entirely
              when the profile hasn't loaded (offline/no backend) instead of
              showing a placeholder name. */}
          <ThemedText style={styles.headerGreeting} numberOfLines={1}>
            Good {getTimeGreeting()}{firstName ? `, ${firstName}` : ''} 👋
          </ThemedText>

          {/* Location Pill — tap to view/update current location only */}
          <TouchableOpacity
            style={styles.locationPillRow}
            onPress={() => setShowViewLocationSheet(true)}
            activeOpacity={0.75}
          >
            <View style={styles.locationPillIcon}>
              <Navigation size={13} color="#FFCE48" fill="#FFCE48" />
            </View>
            <ThemedText style={styles.locationPillText} numberOfLines={1}>
              {locationUnavailable ? 'Tap to set location' : address}
            </ThemedText>
            <ChevronRight size={15} color="#6B7280" />
          </TouchableOpacity>
        </Reanimated.View>

        {/* ── Persistent voice-first hero (always visible) — this is the
             app's primary action; Explore Skills below is a secondary
             shortcut lane, not the front door. */}
        {renderCultfitHeroCard()}

        {/* ── Pickup & Drop — pushed to the front, right after the hero. ── */}
        {renderPickupDropBanner()}

        {/* ── Super Fast — predefined urgent needs, its own section. ── */}
        {renderQuickNeedsSection()}

        {/* ── Explore Skills — skill shortcuts + trust/urgency promos,
             one unified scrollable row. ── */}
        {renderSkillTiles()}

        {/* ── Active Job Cards ── */}
        {renderActiveJobCard()}

        {/* ── Nearby Providers Card ── */}
        {/* Used to just vanish silently whenever serviceProviders was empty —
            which happens both for "genuinely nothing nearby" AND "we don't
            know where you are." Distinguishing the two so the location case
            says so instead of the card just not being there with no
            explanation. */}
        {locationUnavailable ? (
          <TouchableOpacity
            style={[styles.nearbyCard, { borderColor: 'rgba(239,68,68,0.2)', shadowColor: '#EF4444' }]}
            onPress={() => { setLoading(true); fetchLocationAndRefresh(); }}
            activeOpacity={0.85}
          >
            <View style={styles.nearbyCardLeft}>
              <View style={[styles.nearbyCardDot, { backgroundColor: '#EF4444', shadowColor: '#EF4444' }]} />
              <View>
                <ThemedText style={styles.nearbyCardTitle}>Providers Near You</ThemedText>
                <ThemedText style={styles.nearbyCardSub}>Enable location to see providers near you</ThemedText>
              </View>
            </View>
          </TouchableOpacity>
        ) : serviceProviders.length > 0 && (
          <TouchableOpacity
            style={styles.nearbyCard}
            onPress={() => router.push({
              pathname: '/provider-map',
              // We already have a real fix here — passing it lets that
              // screen show the map immediately instead of re-fetching
              // location from scratch and, worse, showing its hardcoded
              // San Francisco fallback while it waits.
              params: location ? {
                lat: String(location.coords.latitude),
                lng: String(location.coords.longitude),
              } : undefined,
            } as any)}
            activeOpacity={0.85}
          >
            <View style={styles.nearbyCardLeft}>
              <View style={styles.nearbyCardDot} />
              <View>
                <ThemedText style={styles.nearbyCardTitle}>Providers Near You</ThemedText>
                <ThemedText style={styles.nearbyCardSub}>
                  {serviceProviders.length} nearby · tap to explore
                </ThemedText>
              </View>
            </View>
            <View style={styles.nearbyAvatarRow}>
              {serviceProviders.slice(0, 3).map((p, i) => (
                <View
                  key={p.id}
                  style={[styles.nearbyAvatar, { marginLeft: i > 0 ? -10 : 0, zIndex: 3 - i }]}
                >
                  <Text style={styles.nearbyAvatarText}>{(p.name[0] ?? '?').toUpperCase()}</Text>
                </View>
              ))}
              {serviceProviders.length > 3 && (
                <View style={[styles.nearbyAvatar, styles.nearbyAvatarMore, { marginLeft: -10, zIndex: 0 }]}>
                  <Text style={styles.nearbyAvatarMoreText}>+{serviceProviders.length - 3}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        )}

        {renderRegularProvidersSection()}

        {/* ── Deals for You — real offers only, nothing hardcoded/decorative
             mixed in here anymore (that used to include app-feature ads
             like "Same Day" that aren't offers at all, and two fake
             "20% OFF"/"Refer & Earn" cards with no backing data). Hidden
             entirely rather than shown empty when there's nothing live. */}
        {offers.length > 0 && (
          <View style={styles.dealsSection}>
            <View style={styles.dealsSectionHeader}>
              <ThemedText style={[styles.sectionLabel, { marginBottom: 0 }]}>Deals for You</ThemedText>
              <TouchableOpacity onPress={() => router.push('/offers')} activeOpacity={0.7}>
                <ThemedText style={styles.viewAllLink}>View All</ThemedText>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dealsList}>
              {offers.map((o, index) => {
                const color = OFFER_CARD_COLORS[index % OFFER_CARD_COLORS.length];
                return (
                  <TouchableOpacity
                    key={o.id}
                    style={styles.dealCardShadow}
                    onPress={() => router.push({ pathname: '/offer-detail', params: { offerId: o.id } } as any)}
                    activeOpacity={0.82}
                  >
                    <View style={styles.dealCard}>
                      <View style={[styles.dealAccentBar, { backgroundColor: color }]} />
                      <View style={[styles.dealIconBox, { backgroundColor: `${color}20` }]}>
                        <TicketPercent size={19} color={color} strokeWidth={1.8} />
                      </View>
                      <View style={styles.dealCardContent}>
                        <ThemedText style={styles.dealHeadline} numberOfLines={1}>{discountText(o)} OFF</ThemedText>
                        <ThemedText style={styles.dealSub} numberOfLines={2}>{o.title}</ThemedText>
                      </View>
                      <View style={[styles.dealCta, { backgroundColor: color }]}>
                        <ThemedText style={styles.dealCtaText}>Claim</ThemedText>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* ── Map Box (commented out — re-enable when map feature is ready) ──
        <View style={styles.mapBox}>
          {Platform.OS === 'web' || !MapView ? (
            <View style={[styles.mapInner, { backgroundColor: themeColors.inputFilled, justifyContent: 'center', alignItems: 'center' }]}>
              <MapPin size={48} color="#D93025" fill="#D93025" />
            </View>
          ) : (
            <MapView
              provider={PROVIDER_GOOGLE}
              style={styles.mapInner}
              key="main-map"
              initialRegion={{
                latitude: location?.coords.latitude || 17.3850,
                longitude: location?.coords.longitude || 78.4867,
                latitudeDelta: 0.0015,
                longitudeDelta: 0.0015,
              }}
              onMapReady={() => setMapReady(true)}
              showsUserLocation={true}
              showsMyLocationButton={false}
              showsCompass={false}
              customMapStyle={mapStyle}
              ref={mapRef}
            >
              {location && (
                <Circle
                  center={{ latitude: location.coords.latitude, longitude: location.coords.longitude }}
                  radius={200}
                  fillColor="rgba(255, 206, 72, 0.1)"
                  strokeColor="rgba(255, 206, 72, 0.3)"
                />
              )}
              {serviceProviders.map(p => (
                <Marker key={p.id} coordinate={{ latitude: p.latitude, longitude: p.longitude }} tracksViewChanges={true}>
                  <View style={styles.providerMarkerWrapper}>
                    <View style={styles.providerMarkerInner}>
                      <UserRound size={14} color="#000" fill="#FFCE48" />
                    </View>
                    <View style={styles.markerPointer} />
                  </View>
                </Marker>
              ))}
            </MapView>
          )}
          <TouchableOpacity style={styles.mapLocateBtn} onPress={handleLocateMe}>
            <LocateFixed size={20} color="#000" />
          </TouchableOpacity>
        </View>
        ── end Map Box ── */}

        {/* Bottom padding so content clears the bottom nav bar */}
        <View style={{ height: 100 + insets.bottom }} />
      </ScrollView>

      {/* ── Book Now chooser — Standard Job vs Pickup & Drop, asked before
          location so Pickup & Drop gets its own dedicated flow instead of
          being a toggle inside the standard wizard ── */}
      <Modal visible={bookChoiceModalVisible} transparent animationType="fade" onRequestClose={() => setBookChoiceModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setBookChoiceModalVisible(false)}>
          <Reanimated.View entering={FadeInUp} style={[styles.locationModalContent, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 40 : 24) + 12 }]}>
            <View style={styles.locationModalHeader}>
              <ThemedText style={styles.locationModalTitle}>What do you need?</ThemedText>
              <ThemedText style={styles.locationModalSubtitle}>Choose the kind of job you want to post</ThemedText>
            </View>
            <TouchableOpacity style={styles.locationOption} onPress={handleBookChoiceStandard}>
              <View style={[styles.locationIconBox, { backgroundColor: '#E0F2FE' }]}>
                <Wrench size={20} color="#0EA5E9" />
              </View>
              <View style={styles.locationInfo}>
                <ThemedText style={styles.locationLabel}>Post a Job</ThemedText>
                <ThemedText style={styles.locationText} numberOfLines={1}>Describe a problem, get matched with a provider</ThemedText>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.locationOption} onPress={handleBookChoicePickupDrop}>
              <View style={[styles.locationIconBox, { backgroundColor: '#FEF3C7' }]}>
                <Package size={20} color="#F59E0B" />
              </View>
              <View style={styles.locationInfo}>
                <ThemedText style={styles.locationLabel}>Pickup & Drop</ThemedText>
                <ThemedText style={styles.locationText} numberOfLines={1}>Groceries, pharmacy & more — picked up and delivered</ThemedText>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.closeLocationBtn} onPress={() => setBookChoiceModalVisible(false)}>
              <ThemedText style={styles.closeLocationBtnText}>Cancel</ThemedText>
            </TouchableOpacity>
          </Reanimated.View>
        </TouchableOpacity>
      </Modal>

      {/* ── Location Modal ── */}
      <Modal visible={isLocationModalVisible} transparent animationType="fade" onRequestClose={() => setIsLocationModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setIsLocationModalVisible(false)}>
          <Reanimated.View entering={FadeInUp} style={[styles.locationModalContent, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 40 : 24) + 12 }]}>
            <View style={styles.locationModalHeader}>
              <ThemedText style={styles.locationModalTitle}>Confirm Service Location</ThemedText>
              <ThemedText style={styles.locationModalSubtitle}>Where do you need the service?</ThemedText>
            </View>
            <TouchableOpacity style={styles.locationOption} onPress={() => confirmLocationSelection(address, location?.coords.latitude, location?.coords.longitude)}>
              <View style={[styles.locationIconBox, { backgroundColor: '#E0F2FE' }]}>
                <MapPin size={20} color="#0EA5E9" />
              </View>
              <View style={styles.locationInfo}>
                <ThemedText style={styles.locationLabel}>Current Location</ThemedText>
                <ThemedText style={styles.locationText} numberOfLines={1}>{address}</ThemedText>
              </View>
            </TouchableOpacity>
            <View style={styles.modalDivider}>
              <View style={styles.dividerLine} />
              <ThemedText style={styles.dividerText}>SAVED ADDRESSES</ThemedText>
              <View style={styles.dividerLine} />
            </View>
            {savedAddresses.length === 0 ? (
              <ThemedText style={styles.noAddressText}>No saved addresses yet. Add one from your profile.</ThemedText>
            ) : (
              savedAddresses.map(item => {
                const label = (item.label || '').toLowerCase();
                const IconComp = label === 'home' ? Home : label === 'work' ? Briefcase : MapPin;
                return (
                  <TouchableOpacity key={item.id} style={styles.locationOption} onPress={async () => {
                    if (item.lat != null && item.lng != null) {
                      confirmLocationSelection(item.full_address, item.lat, item.lng);
                    } else {
                      try {
                        const results = await Location.geocodeAsync(item.full_address);
                        confirmLocationSelection(item.full_address, results[0]?.latitude, results[0]?.longitude);
                      } catch { confirmLocationSelection(item.full_address); }
                    }
                  }}>
                    <View style={[styles.locationIconBox, { backgroundColor: '#FEF3C7' }]}>
                      <IconComp size={20} color="#F59E0B" />
                    </View>
                    <View style={styles.locationInfo}>
                      <ThemedText style={styles.locationLabel}>{item.label}</ThemedText>
                      <ThemedText style={styles.locationText} numberOfLines={1}>{item.full_address}</ThemedText>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
            <TouchableOpacity style={styles.closeLocationBtn} onPress={() => setIsLocationModalVisible(false)}>
              <ThemedText style={styles.closeLocationBtnText}>Cancel</ThemedText>
            </TouchableOpacity>
          </Reanimated.View>
        </TouchableOpacity>
      </Modal>

      {/* ── View Location Sheet (header pill tap) ── */}
      <Modal visible={showViewLocationSheet} transparent animationType="slide" onRequestClose={() => setShowViewLocationSheet(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowViewLocationSheet(false)}>
          <Reanimated.View entering={FadeInUp} style={[styles.locationSheetContainer, { paddingBottom: Math.max(insets.bottom, 20) + 12 }]}>
            {/* Top drag handle indicator */}
            <View style={styles.sheetHandleBar} />

            {/* Header section */}
            <View style={styles.sheetHeaderRow}>
              <View style={styles.sheetIconBadge}>
                <MapPin size={20} color="#111827" />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.sheetTitle}>Your Service Location</ThemedText>
                <ThemedText style={styles.sheetSubtitle}>Active GPS location used for nearby provider matching.</ThemedText>
              </View>
            </View>

            {/* GPS Location Card */}
            <View style={styles.sheetLocCard}>
              <View style={styles.sheetLocCardTop}>
                <View style={styles.sheetGpsDotRow}>
                  <View style={styles.sheetGpsGreenDot} />
                  <ThemedText style={styles.sheetGpsTag}>CURRENT GPS FIX</ThemedText>
                </View>
              </View>
              <View style={styles.sheetLocAddressRow}>
                <View style={styles.sheetLocPinBox}>
                  <Navigation size={18} color="#FFCE48" fill="#FFCE48" />
                </View>
                <ThemedText style={styles.sheetAddressText} numberOfLines={2}>
                  {locationUnavailable ? 'Location unavailable — tap re-detect below' : address}
                </ThemedText>
              </View>
            </View>

            {/* Action buttons */}
            <TouchableOpacity
              style={styles.redetectPrimaryBtn}
              onPress={() => {
                setShowViewLocationSheet(false);
                setLoading(true);
                fetchLocationAndRefresh();
              }}
              activeOpacity={0.85}
            >
              <LocateFixed size={18} color="#111827" />
              <ThemedText style={styles.redetectPrimaryBtnText}>Re-detect My Location</ThemedText>
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetCloseBtn} onPress={() => setShowViewLocationSheet(false)} activeOpacity={0.7}>
              <ThemedText style={styles.sheetCloseBtnText}>Close</ThemedText>
            </TouchableOpacity>
          </Reanimated.View>
        </TouchableOpacity>
      </Modal>

      {/* ── Exit Modal ── */}
      <Modal visible={isExitModalVisible} transparent animationType="fade">
        <View style={styles.exitModalOverlay}>
          <View style={styles.exitModalContent}>
            <View style={styles.exitIconContainer}><AlertTriangle size={36} color="#F59E0B" /></View>
            <ThemedText style={styles.exitTitle}>Exit Dodorez?</ThemedText>
            <ThemedText style={styles.exitMessage}>Are you sure you want to close the app?</ThemedText>
            <View style={styles.exitActionRow}>
              <TouchableOpacity style={[styles.exitButton, styles.exitCancelButton]} onPress={() => setIsExitModalVisible(false)}>
                <ThemedText style={styles.exitCancelText}>No</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.exitButton, styles.exitConfirmButton]}
                onPress={() => {
                  // Android doesn't always fully destroy the JS process on
                  // exitApp() — it can keep it alive in the background for
                  // a fast relaunch. Without resetting this first, reopening
                  // resumes the same component state with the modal still
                  // "visible", so it pops right back up on next launch.
                  setIsExitModalVisible(false);
                  BackHandler.exitApp();
                }}
              >
                <ThemedText style={styles.exitConfirmText}>Yes</ThemedText>
                <LogOut size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Location Required Modal ── */}
      <Modal visible={showLocationModal} transparent animationType="fade" onRequestClose={() => setShowLocationModal(false)}>
        <View style={styles.locPermModalOverlay}>
          <Reanimated.View entering={FadeInUp} style={styles.locPermModalCard}>
            <View style={styles.locPermIconWrap}><MapPin size={32} color="#EF4444" /></View>
            <ThemedText style={styles.locPermTitle}>Location Access Needed</ThemedText>
            <ThemedText style={styles.locPermSubtitle}>We need your location to show nearby providers and post jobs accurately. Enable location access for Dodorez in your phone's settings, then come back and try again.</ThemedText>
            <TouchableOpacity style={styles.locPermPrimaryBtn} onPress={() => { setShowLocationModal(false); Linking.openSettings(); }}>
              <ThemedText style={styles.locPermPrimaryBtnText}>Open Settings</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.locPermSecondaryBtn} onPress={() => setShowLocationModal(false)}>
              <ThemedText style={styles.locPermSecondaryBtnText}>Cancel</ThemedText>
            </TouchableOpacity>
          </Reanimated.View>
        </View>
      </Modal>

      {/* ── Voice Post Modal ── */}
      {/* Rate any finished job (incl. disputed) the customer still owes a rating for */}
      <RatingReminder />

      <VoicePostModal
        visible={voiceModalVisible}
        onClose={() => { setVoiceModalVisible(false); setPreselectedProfession(''); }}
        lat={pendingVoiceLat}
        lng={pendingVoiceLng}
        address={pendingVoiceAddress}
        initialProfession={preselectedProfession || undefined}
        onJobPosted={() => { setVoiceModalVisible(false); setPreselectedProfession(''); if (location) refreshDashboard(location.coords.latitude, location.coords.longitude); }}
        onFallbackToManual={() => {
          router.push({ pathname: '/post-requirement/step1', params: { selectedAddress: pendingVoiceAddress, lat: pendingVoiceLat?.toString() ?? '', lng: pendingVoiceLng?.toString() ?? '' } });
        }}
        onPickupDropoffDetected={() => {
          // The voice modal already called onClose() itself — this just
          // hands off to the same dedicated flow the Home banner and "Book
          // Now" chooser use, treating the location this voice session
          // already had as the dropoff point.
          setPendingDropoffLat(pendingVoiceLat);
          setPendingDropoffLng(pendingVoiceLng);
          setPendingDropoffAddress(pendingVoiceAddress);
          setPickupDropModalVisible(true);
        }}
      />

      {/* ── Quick Need (Super Fast) Modal ── */}
      <QuickNeedModal
        visible={quickNeedModalVisible}
        need={selectedQuickNeed}
        lat={pendingQuickLat}
        lng={pendingQuickLng}
        address={pendingQuickAddress}
        onClose={() => setQuickNeedModalVisible(false)}
        onPosted={() => {
          setQuickNeedModalVisible(false);
          if (location) refreshDashboard(location.coords.latitude, location.coords.longitude);
        }}
      />

      {/* ── Pickup & Drop Modal ── */}
      <PickupDropoffModal
        visible={pickupDropModalVisible}
        dropoffAddress={pendingDropoffAddress}
        dropoffLat={pendingDropoffLat}
        dropoffLng={pendingDropoffLng}
        onClose={() => setPickupDropModalVisible(false)}
        onPosted={() => {
          setPickupDropModalVisible(false);
          if (location) refreshDashboard(location.coords.latitude, location.coords.longitude);
        }}
      />

      {/* ── Instagram-Style 5-Tab Fixed Bottom Nav ── */}
      <SkoFyBottomBar
        activeTab="home"
        onBookPress={() => {
          // Same chooser as the triggerBookLocation path below (reached when
          // "Book" is tapped from a different tab/screen) — this is the
          // direct-call path used when the bottom bar is rendered by Home
          // itself (already-focused tab, so no navigation/param round-trip
          // occurs to go through that path instead). Both must show the
          // same chooser, or which one a customer gets depends on which tab
          // they happened to be on — exactly the bug this fixes.
          setPreselectedProfession('');
          setBookChoiceModalVisible(true);
        }}
      />
    </View>
  );
}

const mapStyle = [
  { "featureType": "poi", "elementType": "labels", "stylers": [{ "visibility": "off" }] },
  { "featureType": "transit", "elementType": "labels", "stylers": [{ "visibility": "off" }] }
];

function makeStyles(t: typeof Colors.light) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: t.card },
  onboardingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.card },
  loaderLogoContainer: { marginBottom: 40 },
  loaderContent: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surface, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 20 },
  loaderText: { fontSize: 14, fontFamily: Fonts.poppinsSemiBold, color: t.textSecondary },
  // ── New scrollable layout ──────────────────────────────────────────────────
  headerSection: { paddingHorizontal: 16, paddingBottom: 14, backgroundColor: t.card },
  headerBrandRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 10 },
  headerBrandLeft: { flexDirection: 'row' as const, alignItems: 'center' as const },
  headerTopRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 10 },
  headerGreeting: { fontSize: 16, fontFamily: Fonts.poppinsSemiBold, color: t.textPrimary },
  locationPillRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    backgroundColor: '#F9FAFB', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: '#F3F4F6', gap: 8,
  },
  locationPillIcon: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: '#111827',
    justifyContent: 'center' as const, alignItems: 'center' as const,
  },
  locationPillText: { flex: 1, fontSize: 12, fontFamily: Fonts.poppinsSemiBold, color: '#374151' },
  servicesSection: { paddingHorizontal: 16, paddingBottom: 12 },
  sectionLabel: { fontSize: 16, fontFamily: Fonts.poppinsBold, color: t.textPrimary, marginBottom: 10 },
  servicesList: { gap: 10, paddingRight: 8, alignItems: 'flex-start' as const },
  serviceChip: {
    width: 104, borderRadius: 18, overflow: 'hidden' as const,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, elevation: 4,
    borderWidth: 1,
  },
  serviceChipTop: { paddingTop: 16, paddingBottom: 12, paddingHorizontal: 10, alignItems: 'center' as const, gap: 8 },
  serviceChipIconBox: { width: 48, height: 48, borderRadius: 14, justifyContent: 'center' as const, alignItems: 'center' as const },
  serviceChipLabel: { fontSize: 10.5, fontFamily: Fonts.poppinsSemiBold, textAlign: 'center' as const, lineHeight: 14 },
  serviceChipVoiceBtn: { flexDirection: 'row' as const, borderTopWidth: 1, paddingVertical: 9, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 5 },
  serviceChipBtnLabel: { fontSize: 9, fontFamily: Fonts.poppinsSemiBold, color: '#FFCE48', letterSpacing: 0.3 },
  // ── Explore Skills — compact colored cards (same language the old promo
  // carousel used, just smaller, now folded into this one section) ─────────
  pickupDropBannerWrap: { paddingHorizontal: 16, marginBottom: 20 },
  // White card + soft-blue icon badge — same visual language as the tile
  // system below (see TILE_ACCENTS), not a full-bleed saturated block.
  pickupDropBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#FFFFFF', borderRadius: 18, padding: 16,
    borderWidth: 1, borderColor: '#F1F2F4',
    shadowColor: '#0F172A', shadowOpacity: 0.06, shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  pickupDropIconWrap: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: '#E0F2FE',
    alignItems: 'center', justifyContent: 'center',
  },
  pickupDropTitle: { fontSize: 15, fontFamily: Fonts.poppinsBold, color: '#111827' },
  pickupDropSub: { fontSize: 12, fontFamily: Fonts.poppins, color: '#6B7280', marginTop: 2 },

  skillTilesSection: { paddingHorizontal: 16, marginBottom: 20 },
  skillTilesRow: { gap: 12, paddingRight: 8, paddingVertical: 4 },
  // White card + colored icon badge — one dominant brand color (yellow-gold)
  // stays reserved for primary actions; every tile category gets a small,
  // purposeful icon-badge accent instead of its own full-bleed saturated
  // "mini-brand" card. Matches how Uber/DoorDash/Airbnb actually do category
  // tiles: white/neutral surface, color used sparingly and with intent.
  skillTile: {
    width: 168,
    height: 108,
    borderRadius: 18,
    padding: 14,
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F1F2F4',
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  skillTileIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skillTileLabel: { fontSize: 13.5, fontFamily: Fonts.poppinsBold, lineHeight: 16, color: '#111827' },
  skillTileCtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  skillTileCtaText: { fontSize: 11.5, fontFamily: Fonts.poppinsBold },
  // ── Deals for You strip ───────────────────────────────────────────────────
  dealsSection: { paddingHorizontal: 16, marginBottom: 20 },
  dealsSectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10,
  },
  viewAllLink: { fontSize: 13, fontFamily: Fonts.poppinsSemiBold, color: '#F59E0B' },
  dealsList: { gap: 12, paddingRight: 8, paddingVertical: 8 },
  dealCardShadow: {
    width: 240,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 }, elevation: 6,
  },
  dealCard: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    backgroundColor: '#FFFFFF',
    borderRadius: 18, overflow: 'hidden' as const,
    height: 96, paddingRight: 12, gap: 10,
  },
  // ── Your Regular Providers strip ──────────────────────────────────────────
  regularProviderCard: {
    width: 150,
    borderRadius: 18,
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F1F2F4',
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  regularProviderTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  regularProviderAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  regularProviderAvatarFallback: {
    backgroundColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  regularProviderAvatarInitial: {
    fontSize: 16,
    fontFamily: Fonts.poppinsBold,
    color: '#fff',
  },
  regularProviderBadge: {
    backgroundColor: '#FFF9E6',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  regularProviderBadgeText: {
    fontSize: 10,
    lineHeight: 14,
    fontFamily: Fonts.poppinsBold,
    color: '#F59E0B',
  },
  regularProviderName: {
    fontSize: 13.5,
    fontFamily: Fonts.poppinsBold,
    color: '#111827',
    marginBottom: 2,
  },
  regularProviderProfession: {
    fontSize: 11,
    fontFamily: Fonts.poppins,
    color: '#6B7280',
    marginBottom: 6,
  },
  regularProviderStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  regularProviderStatsText: {
    fontSize: 11.5,
    fontFamily: Fonts.poppinsSemiBold,
    color: '#111827',
  },
  regularProviderPresenceDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  regularProviderAvailabilityText: {
    fontSize: 10.5,
    fontFamily: Fonts.poppinsSemiBold,
    marginTop: 4,
  },
  dealAccentBar: { width: 5, alignSelf: 'stretch' as const },
  dealIconBox: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center' as const, alignItems: 'center' as const },
  dealCardContent: { flex: 1 },
  dealHeadline: { fontSize: 13, fontFamily: Fonts.poppinsBold, color: '#111827' },
  dealSub: { fontSize: 10.5, fontFamily: Fonts.poppins, color: '#6B7280', marginTop: 3, lineHeight: 15 },
  dealCta: { paddingVertical: 7, paddingHorizontal: 11, borderRadius: 20 },
  dealCtaText: { fontSize: 10.5, fontFamily: Fonts.poppinsBold, color: '#FFFFFF' },
  // ──────────────────────────────────────────────────────────────────────────
  mapBox: {
    marginHorizontal: 16, marginBottom: 12, borderRadius: 24, overflow: 'hidden',
    height: 220,
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 12, elevation: 6,
    borderWidth: 1, borderColor: t.borderSubtle,
    position: 'relative' as const,
  },
  mapInner: { flex: 1 },
  mapLocateBtn: {
    position: 'absolute', bottom: 12, left: 12,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: t.card, justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, elevation: 6,
    borderWidth: 1, borderColor: t.borderSubtle,
  },
  // ──────────────────────────────────────────────────────────────────────────
  providerMarkerWrapper: { alignItems: 'center', justifyContent: 'center', width: 40, height: 40 },
  providerMarkerInner: { padding: 6, backgroundColor: '#fff', borderRadius: 12, elevation: 5, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 5, borderWidth: 1.5, borderColor: '#FFCE48', alignItems: 'center', justifyContent: 'center' },
  markerPointer: { width: 8, height: 8, backgroundColor: '#fff', transform: [{ rotate: '45deg' }], marginTop: -5, borderWidth: 1, borderColor: '#FFCE48', borderTopWidth: 0, borderLeftWidth: 0 },

  notifNudge: {
    marginHorizontal: 12,
    backgroundColor: '#fff', borderRadius: 16,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 12, elevation: 8,
    borderLeftWidth: 4, borderLeftColor: '#FFCE48',
    marginBottom: 8,
  },
  notifNudgeIconWrap: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFFBEB',
    alignItems: 'center', justifyContent: 'center',
  },
  notifNudgeBody: { flex: 1 },
  notifNudgeTitle: { fontSize: 13, fontFamily: Fonts.poppinsBold, color: '#111827' },
  notifNudgeText: { fontSize: 11, fontFamily: Fonts.poppins, color: '#6B7280', marginTop: 1 },
  notifNudgeBtn: {
    backgroundColor: '#FFCE48', paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20,
  },
  notifNudgeBtnText: { fontSize: 12, fontFamily: Fonts.poppinsBold, color: '#111827' },
  notifNudgeDismiss: { padding: 4 },
  headerContent: { backgroundColor: t.card, paddingVertical: 16, paddingHorizontal: 12, borderRadius: 28, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 20, elevation: 10, flexDirection: 'row' },
  profileCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#FFF3CD', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' as const },
  profileInitialsText: { fontSize: 19, fontFamily: Fonts.poppinsBold, color: '#92400E' },
  headerTitleContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centeredLogoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  headerLogo: { width: 24, height: 24 },
  headerTitleText: { fontSize: 20, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
  greetingText: { fontSize: 14, fontFamily: Fonts.poppinsSemiBold, color: t.textSecondary, marginBottom: 1 },
  locationContainer: { alignItems: 'center', paddingHorizontal: 10, marginTop: 4 },
  locationBadgeWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 206, 72, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 206, 72, 0.3)',
  },
  locationBadgeLabel: {
    fontSize: 9,
    lineHeight: 15,
    fontFamily: Fonts.poppinsBold,
    color: '#F59E0B',
    letterSpacing: 0.8,
  },
  addressText: { fontSize: 13, fontFamily: Fonts.poppinsSemiBold, color: '#374151', textAlign: 'center' },
  notificationButton: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center', backgroundColor: t.inputFilled, borderRadius: 22 },
  notifBadge: { position: 'absolute', top: 8, right: 8, width: 9, height: 9, borderRadius: 5, backgroundColor: '#EF4444', borderWidth: 1.5, borderColor: '#fff' },

  nearbyCard: {
    marginHorizontal: 16,
    marginBottom: 20,
    backgroundColor: t.card,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.15)',
  },
  nearbyCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  nearbyCardDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#10B981',
    shadowColor: '#10B981', shadowOpacity: 0.6, shadowRadius: 4, elevation: 3,
  },
  nearbyCardTitle: { fontSize: 14, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
  nearbyCardSub: { fontSize: 11, fontFamily: Fonts.poppins, color: t.textMuted },
  nearbyAvatarRow: { flexDirection: 'row', alignItems: 'center' },
  nearbyAvatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#6366F1',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: t.card,
  },
  nearbyAvatarText: { fontSize: 11, fontFamily: Fonts.poppinsBold, color: '#fff' },
  nearbyAvatarMore: { backgroundColor: '#E5E7EB' },
  nearbyAvatarMoreText: { fontSize: 9, fontFamily: Fonts.poppinsBold, color: '#6B7280' },

  floatingJobCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 28,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 15,
    elevation: 12,
    backgroundColor: t.card,
  },
  jobCardContent: { borderRadius: 24, overflow: 'hidden' as const, backgroundColor: t.card, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 12, elevation: 4 },
  jobCardAccentBar: { height: 4 },
  // minHeight + the action row's marginTop:'auto' (see renderJobCard) keep
  // the button anchored to the bottom at a consistent position across every
  // card variant — some jobs render an extra "Waiting on X · Skip" row here
  // and some don't, and without this the button just floated wherever that
  // optional row's absence left it, instead of a fixed spot every card.
  jobCardBody: { padding: 20, minHeight: 232 },
  statusBadge: { alignSelf: 'flex-start' as const, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, marginBottom: 3 },
  dotRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingTop: 8, paddingBottom: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.borderSubtle },
  dotActive: { width: 18, backgroundColor: '#FFCE48' },
  jobHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  statusInfo: { flexDirection: 'row', gap: 10, flex: 1 },
  iconContainer: { width: 40, height: 40, borderRadius: 12, backgroundColor: t.card, justifyContent: 'center', alignItems: 'center', elevation: 2 },
  statusTitle: { fontSize: 9.5, fontFamily: Fonts.poppinsBold, letterSpacing: 0.5 },
  jobTitle: { fontSize: 18, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
  timeText: { fontSize: 10, fontFamily: Fonts.poppinsSemiBold, color: t.textMuted },
  jobLocationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 },
  jobLocationText: { fontSize: 13, fontFamily: Fonts.poppins, color: t.textSecondary },
  directRequestRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: t.card, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12,
  },
  directRequestText: { flex: 1, fontSize: 12, fontFamily: Fonts.poppinsSemiBold, color: t.textSecondary },
  directRequestSkipBtn: { paddingHorizontal: 10, paddingVertical: 4 },
  directRequestSkipText: { fontSize: 12, fontFamily: Fonts.poppinsBold, color: '#6366F1' },
  assignedProviderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#EEF2FF', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12,
  },
  assignedProviderAvatar: { width: 36, height: 36, borderRadius: 18 },
  assignedProviderAvatarFallback: { backgroundColor: '#6366F1', justifyContent: 'center', alignItems: 'center' },
  assignedProviderInitial: { fontSize: 15, fontFamily: Fonts.poppinsBold, color: '#fff' },
  assignedProviderName: { fontSize: 13, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
  assignedProviderProfession: { fontSize: 11, fontFamily: Fonts.poppins, color: t.textMuted },
  notifiedRow: {
    backgroundColor: t.card, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12,
  },
  notifiedText: { fontSize: 12, fontFamily: Fonts.poppinsSemiBold, color: t.textSecondary },
  jobActionRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  viewApplicantsButton: { flexDirection: 'row', height: 50, borderRadius: 16, justifyContent: 'center', alignItems: 'center', gap: 8, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 5 },
  viewApplicantsText: { fontSize: 16, fontFamily: Fonts.poppinsBold, color: '#000' },
  cancelJobButton: { width: 50, height: 50, borderRadius: 16, backgroundColor: '#FEF2F2', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#FEE2E2' },

  // ── Voice-first hero card styles ────────────────────────────────────────
  cultfitHeroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#7C3AED',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  cultfitHeroTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 14,
  },
  cultfitTitleInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3,
  },
  cultfitHeroTitle: {
    fontSize: 17,
    lineHeight: 23,
    fontFamily: Fonts.poppinsBold,
    color: '#111827',
    flexShrink: 1,
  },
  cultfitHeroSub: {
    fontSize: 12.5,
    lineHeight: 18.5,
    fontFamily: Fonts.poppins,
    color: '#6B7280',
  },
  cultfitHeroCtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cultfitPrimaryCta: {
    flex: 1,
    height: 46,
    borderRadius: 15,
    overflow: 'hidden',
  },
  cultfitCtaSolid: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#111827',
  },
  cultfitPrimaryCtaText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Fonts.poppinsBold,
    color: '#FFFFFF',
  },
  cultfitSecondaryCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    height: 46,
    borderRadius: 15,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
  },
  cultfitSecondaryCtaText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Fonts.poppinsSemiBold,
    color: '#374151',
  },
  // ── Quick Action 4-Grid Styles ──────────────────────────────────────────
  quickGridCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  quickGridItem: {
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  quickGridIconBox: {
    width: 48,
    height: 48,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  quickGridLabel: {
    fontSize: 11,
    lineHeight: 17,
    fontFamily: Fonts.poppinsSemiBold,
    color: '#374151',
    textAlign: 'center',
  },

  // ── SkoFy Floating Bottom Navigation Dock Styles ────────────────────────
  skofyBottomBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
    zIndex: 99,
  },
  navBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    height: 62,
    paddingHorizontal: 4,
  },
  navTabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    height: '100%',
  },
  activeTabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  navTabLabel: {
    fontSize: 10,
    lineHeight: 16,
    fontFamily: Fonts.poppinsSemiBold,
    color: '#6B7280',
  },
  navTabLabelActive: {
    fontSize: 11,
    lineHeight: 17,
    fontFamily: Fonts.poppinsBold,
    color: '#111827',
  },
  activeTabDot: {
    position: 'absolute',
    bottom: 2,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#FFCE48',
  },
  navBadge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  navBadgeText: {
    fontSize: 9,
    lineHeight: 15,
    fontFamily: Fonts.poppinsBold,
    color: '#FFFFFF',
  },
  centerNavOrbWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -24,
  },
  centerNavOrb: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FFCE48',
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  centerNavOrbGradient: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 28,
  },
  centerNavOrbLabel: {
    fontSize: 10,
    lineHeight: 16,
    fontFamily: Fonts.poppinsBold,
    color: '#111827',
    marginTop: 3,
  },
  navAvatarImage: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: '#FFCE48',
  },
  navAvatarFallback: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#FFFBEB',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#FFCE48',
  },
  navAvatarInitialsText: {
    fontSize: 11,
    lineHeight: 17,
    fontFamily: Fonts.poppinsBold,
    color: '#D97706',
  },

  // ── 3 independent floating elements ───────────────────────────────────────
  floatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  // Side chips — shared base
  sideChip: {
    width: 80,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 5,
    paddingVertical: 14,
    backgroundColor: t.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: t.borderSubtle,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  sideChipLabel: { fontSize: 10, fontFamily: Fonts.poppinsSemiBold, color: '#6B7280', textAlign: 'center' as const },
  // Book manually chip — highlighted
  bookChip: {
    width: 80,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 5,
    paddingVertical: 14,
    backgroundColor: '#FFFBEB',
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: '#FFCE48',
    shadowColor: '#FFCE48',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  bookChipLabel: { fontSize: 10, fontFamily: Fonts.poppinsSemiBold, color: '#92400E', textAlign: 'center' as const, lineHeight: 14 },
  sideBadge: {
    position: 'absolute' as const,
    top: 6, right: 6,
    minWidth: 18, height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: '#EF4444',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: 2,
    borderColor: t.card,
  },
  sideBadgeText: { color: '#fff', fontSize: 9, fontFamily: Fonts.poppinsBold, lineHeight: 11 },

  // Center orb element
  centerFloat: { alignItems: 'center' as const, gap: 6 },
  orbDotsRow: { flexDirection: 'row' as const, gap: 8, alignItems: 'center' as const },
  orbDot: { width: 8, height: 8, borderRadius: 4 },
  centerOrb: {
    width: 72, height: 72, borderRadius: 36,
    overflow: 'hidden',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6, shadowRadius: 20, elevation: 14,
  },
  centerOrbGradient: { ...StyleSheet.absoluteFillObject },
  centerOrbHighlight: {
    position: 'absolute', top: 12, left: 16,
    width: 22, height: 13, borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.35)',
    transform: [{ rotate: '-20deg' }],
  },
  centerOrbLabel: { fontSize: 13, fontFamily: Fonts.poppinsBold, color: t.textPrimary },

  postButton: { height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center', shadowColor: '#FFCE48', shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },
  postButtonText: { fontSize: 18, fontFamily: Fonts.poppinsBold, color: '#000' },

  // Location Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  locationModalContent: {
    backgroundColor: t.card,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  // ── Redesigned Location Sheet Styles ───────────────────────────────────────
  locationSheetContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -6 },
    elevation: 20,
  },
  sheetHandleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E2E8F0',
    alignSelf: 'center' as const,
    marginBottom: 16,
  },
  sheetHeaderRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    marginBottom: 16,
  },
  sheetIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  sheetTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: Fonts.poppinsBold,
    color: '#1E293B',
  },
  sheetSubtitle: {
    fontSize: 11.5,
    fontFamily: Fonts.poppins,
    color: '#64748B',
    lineHeight: 16,
  },
  sheetLocCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    marginBottom: 16,
  },
  sheetLocCardTop: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 8,
  },
  sheetGpsDotRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  sheetGpsGreenDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#22C55E',
  },
  sheetGpsTag: {
    fontSize: 9.5,
    lineHeight: 15.5,
    fontFamily: Fonts.poppinsBold,
    color: '#15803D',
    letterSpacing: 0.5,
  },
  sheetLocAddressRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
  },
  sheetLocPinBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#111827',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  sheetAddressText: {
    flex: 1,
    fontSize: 13,
    fontFamily: Fonts.poppinsSemiBold,
    color: '#1E293B',
    lineHeight: 18,
  },
  redetectPrimaryBtn: {
    height: 48,
    backgroundColor: '#FFCE48',
    borderRadius: 16,
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 10,
    shadowColor: '#FFCE48',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  redetectPrimaryBtnText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Fonts.poppinsBold,
    color: '#111827',
  },
  sheetCloseBtn: {
    height: 42,
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  sheetCloseBtnText: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Fonts.poppinsSemiBold,
    color: '#64748B',
  },
  locationModalHeader: {
    marginBottom: 24,
  },
  locationModalTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  locationModalSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
    marginTop: 4,
  },
  locationOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.surface,
    padding: 16,
    borderRadius: 20,
    marginBottom: 12,
  },
  locationIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  locationInfo: {
    flex: 1,
  },
  locationLabel: {
    fontSize: 15,
    lineHeight: 21,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  locationText: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
    marginTop: 2,
  },
  modalDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: t.borderSubtle,
  },
  dividerText: {
    fontSize: 10,
    lineHeight: 16,
    fontFamily: Fonts.poppinsBold,
    color: t.textMuted,
    letterSpacing: 1,
  },
  noAddressText: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Fonts.poppins,
    color: t.textMuted,
    textAlign: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  closeLocationBtn: {
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  closeLocationBtnText: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: Fonts.poppinsBold,
    color: t.textSecondary,
  },
  exitModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  exitModalContent: {
    backgroundColor: t.card,
    borderRadius: 32,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 5,
  },
  exitIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FFFBEB',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  exitTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    marginBottom: 8,
  },
  exitMessage: {
    fontSize: 15,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  exitActionRow: {
    flexDirection: 'row',
    gap: 16,
    width: '100%',
  },
  exitButton: {
    flex: 1,
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  exitCancelButton: {
    backgroundColor: t.inputFilled,
  },
  exitCancelText: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: Fonts.poppinsBold,
    color: t.textSecondary,
  },
  exitConfirmButton: {
    backgroundColor: t.textPrimary,
  },
  exitConfirmText: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: Fonts.poppinsBold,
    color: '#fff',
  },
  locPermModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  locPermModalCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  locPermIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FEF2F2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  locPermTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontFamily: Fonts.poppinsBold,
    color: '#111827',
    marginTop: 16,
    textAlign: 'center',
  },
  locPermSubtitle: {
    fontSize: 14,
    fontFamily: Fonts.poppins,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 21,
  },
  locPermPrimaryBtn: {
    backgroundColor: '#FFCE48',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 24,
    width: '100%',
    alignItems: 'center',
  },
  locPermPrimaryBtnText: {
    fontSize: 15,
    lineHeight: 21,
    fontFamily: Fonts.poppinsBold,
    color: '#111827',
  },
  locPermSecondaryBtn: {
    paddingVertical: 12,
    marginTop: 4,
  },
  locPermSecondaryBtnText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Fonts.poppinsSemiBold,
    color: '#9CA3AF',
  },
  });
}
