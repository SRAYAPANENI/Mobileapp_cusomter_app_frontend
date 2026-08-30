import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  LayoutChangeEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import { ChevronLeft, LocateFixed, Navigation2, RefreshCw, Search, Star, X } from 'lucide-react-native';
import { Fonts } from '@/constants/theme';
import { SkoFyApi } from '@/services/api';
import { VoicePostModal } from '@/components/voice-post-modal';

let MapView: any;
let PROVIDER_GOOGLE: any;
if (Platform.OS !== 'web') {
  try {
    const maps = require('react-native-maps');
    MapView = maps.default;
    PROVIDER_GOOGLE = maps.PROVIDER_GOOGLE;
  } catch {}
}

type NearbyProvider = {
  provider_id: string;
  name: string;
  profession?: string | null;
  avg_rating: number;
  jobs_completed: number;
  hci_score: number;
  distance_km: number;
  is_available: boolean;
  profile_image_url?: string | null;
  lat: number;
  lng: number;
  last_seen: number;
  skills?: string[];
};

type MapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

// Equirectangular approximation — accurate enough at city-block zoom levels — so pin
// screen position is plain synchronous math from the live region, no async native
// bridge call. That's what lets pins track the map in real time during a drag instead
// of freezing until the gesture ends.
function projectToScreen(lat: number, lng: number, region: MapRegion, width: number, height: number) {
  const x = ((lng - (region.longitude - region.longitudeDelta / 2)) / region.longitudeDelta) * width;
  const y = ((region.latitude + region.latitudeDelta / 2 - lat) / region.latitudeDelta) * height;
  return { x, y };
}

const AVATAR_PALETTE = ['#6366F1', '#10B981', '#F97316', '#3B82F6', '#EC4899', '#8B5CF6', '#EF4444', '#14B8A6'];

// Fixed pin footprint: avatar (top-left) + pin tail + label card (right).
// The tail tip is the true map coordinate; MARKER_ANCHOR gives its position as a
// fraction of the box so screen placement is `point - anchor * boxSize`.
const MARKER_BOX_W = 168;
const MARKER_BOX_H = 64;
const MARKER_ANCHOR = { x: 26 / MARKER_BOX_W, y: 62 / MARKER_BOX_H };

function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function makeDummyProviders(lat: number, lng: number): NearbyProvider[] {
  const now = Date.now();
  return [
    {
      provider_id: 'dummy-1', name: 'Marcus Johnson', profession: 'Plumber',
      avg_rating: 4.8, jobs_completed: 127, hci_score: 0.9, distance_km: 2.1,
      is_available: true, profile_image_url: null,
      lat: lat + 0.012, lng: lng + 0.008,
      last_seen: now - 120_000, skills: ['Plumbing', 'Pipe Repair', 'Leak Fix'],
    },
    {
      provider_id: 'dummy-2', name: 'Sarah Chen', profession: 'Electrician',
      avg_rating: 4.9, jobs_completed: 89, hci_score: 0.95, distance_km: 3.4,
      is_available: true, profile_image_url: null,
      lat: lat - 0.008, lng: lng + 0.015,
      last_seen: now - 45_000, skills: ['Wiring', 'Panel Upgrade', 'Smart Home'],
    },
    {
      provider_id: 'dummy-3', name: 'David Park', profession: 'Handyman',
      avg_rating: 4.6, jobs_completed: 203, hci_score: 0.82, distance_km: 1.8,
      is_available: false, profile_image_url: null,
      lat: lat + 0.005, lng: lng - 0.012,
      last_seen: now - 300_000, skills: ['General Repairs', 'Assembly', 'Painting'],
    },
    {
      provider_id: 'dummy-4', name: 'Priya Sharma', profession: 'House Cleaner',
      avg_rating: 5.0, jobs_completed: 56, hci_score: 0.98, distance_km: 4.2,
      is_available: true, profile_image_url: null,
      lat: lat - 0.015, lng: lng - 0.009,
      last_seen: now - 20_000, skills: ['Deep Clean', 'Move-in/out', 'Laundry'],
    },
    {
      provider_id: 'dummy-5', name: 'James Rivera', profession: 'HVAC Tech',
      avg_rating: 4.7, jobs_completed: 74, hci_score: 0.88, distance_km: 5.1,
      is_available: false, profile_image_url: null,
      lat: lat + 0.018, lng: lng - 0.004,
      last_seen: now - 480_000, skills: ['AC Repair', 'Furnace', 'Duct Work'],
    },
  ];
}

export default function ProviderMapScreen() {
  const insets = useSafeAreaInsets();
  // Dashboard already has a real fix by the time you tap "Providers Near
  // You" — passed along as params so this screen can show the map
  // immediately instead of re-fetching location from scratch (and, worse,
  // showing its hardcoded fallback region while it waits).
  const params = useLocalSearchParams<{ lat?: string; lng?: string }>();
  const initialCoords = useMemo(() => {
    const lat = parseFloat(params.lat ?? '');
    const lng = parseFloat(params.lng ?? '');
    return Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : null;
  }, []);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(initialCoords);
  // Kept separate, not one-replaces-the-other: dummy pins make the map usable
  // for demos when only one or two real providers are registered, while real
  // ones are fetched live so a real device can be direct-booked/notified for
  // testing. Merged (real first) into `providers` below for everything else
  // in this screen to consume unchanged.
  const [dummyProviders, setDummyProviders] = useState<NearbyProvider[]>([]);
  const [realProviders, setRealProviders] = useState<NearbyProvider[]>([]);
  const providers = useMemo(() => {
    const seen = new Set(realProviders.map(p => p.provider_id));
    return [...realProviders, ...dummyProviders.filter(p => !seen.has(p.provider_id))];
  }, [realProviders, dummyProviders]);
  const [selected, setSelected] = useState<NearbyProvider | null>(null);
  const [region, setRegion] = useState<MapRegion | null>(null);
  const [voiceVisible, setVoiceVisible] = useState(false);
  const [targetProvider, setTargetProvider] = useState<{ id: string; name: string; profession: string | null } | undefined>();
  const [queuedProviders, setQueuedProviders] = useState<{ id: string; name: string; profession: string | null }[]>();
  const [, setTick] = useState(0);
  const [locating, setLocating] = useState(!initialCoords);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const [search, setSearch] = useState('');
  // Direct-request shortlist being built from the map, in the order they'll be asked
  const [shortlist, setShortlist] = useState<NearbyProvider[]>([]);
  const sheetY = useRef(new Animated.Value(600)).current;
  const mapRef = useRef<any>(null);
  const regionDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shared by the initial load, the 30s poll, region-change, and manual
  // refresh — always sets (not merges with) realProviders, since it's already
  // kept separate from dummyProviders and each call is a full fresh snapshot.
  const fetchRealProviders = useCallback(async (lat: number, lng: number, radiusKm: number) => {
    try {
      const data = await SkoFyApi.dashboard.getNearbyProviders(lat, lng, radiusKm, true);
      const real = (data as any[]).filter(p => p.lat != null && p.lng != null)
        .map(p => ({ ...p, last_seen: Date.now(), skills: [] })) as NearbyProvider[];
      setRealProviders(real);
    } catch {}
  }, []);

  // Get location + seed dummy providers immediately, and kick off the first
  // real fetch right away too — previously this waited for the first 30s
  // poll tick, so a real registered provider wouldn't show up for a while.
  useEffect(() => {
    // Already have a real fix passed in from the dashboard — show the map
    // with it right away instead of blocking on a fresh GPS read, then
    // quietly refine in the background once a more precise fix comes in.
    if (initialCoords) {
      setDummyProviders(makeDummyProviders(initialCoords.latitude, initialCoords.longitude));
      fetchRealProviders(initialCoords.latitude, initialCoords.longitude, 40);
      mapRef.current?.animateToRegion(
        { latitude: initialCoords.latitude, longitude: initialCoords.longitude, latitudeDelta: 0.06, longitudeDelta: 0.06 },
        800,
      );
      Location.requestForegroundPermissionsAsync()
        .then(({ status }) => status === 'granted' ? Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }) : null)
        .then((loc) => { if (loc) setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude }); })
        .catch(() => {});
      return;
    }

    (async () => {
      setLocating(true);
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') { setLocating(false); return; }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setLocation(coords);
        setDummyProviders(makeDummyProviders(coords.latitude, coords.longitude));
        fetchRealProviders(coords.latitude, coords.longitude, 40);
        mapRef.current?.animateToRegion(
          { latitude: coords.latitude, longitude: coords.longitude, latitudeDelta: 0.06, longitudeDelta: 0.06 },
          800,
        );
      } finally {
        setLocating(false);
      }
    })();
  }, []);

  // 10-second ticker for live timeAgo labels
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  // 30s polling — keeps realProviders fresh (last_seen, availability, new
  // registrations); dummyProviders are untouched by this
  useEffect(() => {
    if (!location) return;
    const interval = setInterval(() => {
      const radiusKm = region ? (region.latitudeDelta * 111) / 2 : 40;
      fetchRealProviders(location.latitude, location.longitude, radiusKm);
    }, 30_000);
    return () => clearInterval(interval);
  }, [location, region, fetchRealProviders]);

  // Sheet slide animation
  useEffect(() => {
    Animated.spring(sheetY, {
      toValue: selected ? 0 : 600,
      useNativeDriver: true,
      tension: 70,
      friction: 12,
    }).start();
  }, [selected]);

  // Pins are plain RN views positioned by screen pixel, not Marker children —
  // react-native-maps' Android bitmap-snapshot path clips complex custom markers
  // (elevation + multi-child layouts get cropped unreliably), so instead we project
  // each provider's lat/lng onto the map with plain math (projectToScreen) and render
  // real Text/View on top of the map. onRegionChange fires continuously during a
  // pan/zoom gesture, so pins update every frame instead of jumping only at the end.
  const onRegionChange = useCallback((r: MapRegion) => {
    setRegion(r);
  }, []);

  const onRegionChangeComplete = useCallback((r: MapRegion) => {
    setRegion(r);
    if (!location) return;
    if (regionDebounce.current) clearTimeout(regionDebounce.current);
    regionDebounce.current = setTimeout(() => {
      const radiusKm = (r.latitudeDelta * 111) / 2;
      fetchRealProviders(location.latitude, location.longitude, radiusKm);
    }, 600);
  }, [location, fetchRealProviders]);

  const locateMe = () => {
    if (!location || !mapRef.current) return;
    // Zoom in tight so customer can see themselves + nearby providers clearly
    mapRef.current.animateToRegion(
      { latitude: location.latitude, longitude: location.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 },
      500,
    );
  };

  const refresh = useCallback(async () => {
    if (isRefreshing || !location) return;
    setIsRefreshing(true);
    setDummyProviders(makeDummyProviders(location.latitude, location.longitude));
    const radiusKm = region ? (region.latitudeDelta * 111) / 2 : 40;
    await fetchRealProviders(location.latitude, location.longitude, radiusKm);
    setIsRefreshing(false);
  }, [location, region, isRefreshing, fetchRealProviders]);

  const MAX_SHORTLIST = 3;

  const toggleShortlist = (p: NearbyProvider) => {
    setShortlist(prev => {
      if (prev.some(x => x.provider_id === p.provider_id)) {
        return prev.filter(x => x.provider_id !== p.provider_id);
      }
      if (prev.length >= MAX_SHORTLIST) return prev;
      return [...prev, p];
    });
  };

  // First provider gets asked immediately; the rest wait in order — declines
  // or a timeout auto-advance to the next one (server-side, job_service.py's
  // _advance_or_broadcast), never two providers holding an open offer at once.
  const sendShortlistRequest = () => {
    if (shortlist.length === 0) return;
    const [first, ...rest] = shortlist;
    setTargetProvider({ id: first.provider_id, name: first.name, profession: first.profession ?? null });
    setQueuedProviders(rest.map(p => ({ id: p.provider_id, name: p.name, profession: p.profession ?? null })));
    setSelected(null);
    setShortlist([]);
    setTimeout(() => setVoiceVisible(true), 300);
  };

  // Distinct professions present nearby right now — powers the quick-filter chips.
  const professions = useMemo(() => {
    const set = new Set<string>();
    providers.forEach(p => { if (p.profession) set.add(p.profession); });
    return Array.from(set);
  }, [providers]);

  // Client-side filter against profession + skills. Cheap at current provider counts;
  // once getNearbyProviders is live over larger radii, pass `search` as a query param
  // instead so filtering happens server-side (PostGIS + skill join).
  const filteredProviders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return providers;
    return providers.filter(p =>
      (p.profession ?? '').toLowerCase().includes(q) ||
      (p.skills ?? []).some(sk => sk.toLowerCase().includes(q)),
    );
  }, [providers, search]);

  // Providers registered from the same spot (e.g. testing several accounts
  // in one room) land at nearly-identical lat/lng — at typical zoom that's
  // under a pixel apart on screen, so later pins fully cover earlier ones
  // and only the last one drawn is visible/tappable. Detect screen-space
  // overlap and spread those pins in a small circle so every one of them
  // stays distinguishable and tappable, without touching their real geo data.
  const OVERLAP_PX = 36;
  const positionedProviders = useMemo(() => {
    if (!region || mapSize.width === 0) return [];
    const base = filteredProviders.map(p => ({
      p, ...projectToScreen(p.lat, p.lng, region, mapSize.width, mapSize.height),
    }));
    const used = new Set<number>();
    const groups: (typeof base)[] = [];
    base.forEach((item, i) => {
      if (used.has(i)) return;
      const group = [item];
      used.add(i);
      for (let j = i + 1; j < base.length; j++) {
        if (used.has(j)) continue;
        const dx = base[j].x - item.x, dy = base[j].y - item.y;
        if (Math.sqrt(dx * dx + dy * dy) < OVERLAP_PX) {
          group.push(base[j]);
          used.add(j);
        }
      }
      groups.push(group);
    });
    const result: { p: NearbyProvider; x: number; y: number }[] = [];
    groups.forEach(group => {
      if (group.length === 1) {
        result.push(group[0]);
        return;
      }
      const cx = group.reduce((s, g) => s + g.x, 0) / group.length;
      const cy = group.reduce((s, g) => s + g.y, 0) / group.length;
      const spreadRadius = 28;
      group.forEach((item, idx) => {
        const angle = (idx / group.length) * Math.PI * 2;
        result.push({ p: item.p, x: cx + Math.cos(angle) * spreadRadius, y: cy + Math.sin(angle) * spreadRadius });
      });
    });
    return result;
  }, [filteredProviders, region, mapSize]);

  const radiusMiForModal = region ? ((region.latitudeDelta * 111) / 2) / 1.60934 : 25;

  if (!MapView) {
    return (
      <View style={s.fallback}>
        <Text style={s.fallbackText}>Map not available on web</Text>
      </View>
    );
  }

  const available = filteredProviders.filter(p => p.is_available).length;
  const DEFAULT_REGION = { latitude: 37.7749, longitude: -122.4194, latitudeDelta: 0.12, longitudeDelta: 0.12 };
  // initialRegion only applies once, on mount — it's not reactive like
  // `region`, so setting it to the SF placeholder unconditionally meant the
  // map always flashed San Francisco first regardless of the animateToRegion
  // call in the effect above, even when we already had the real location
  // passed in from the dashboard. Seed it with that real fix when available.
  const startRegion = initialCoords
    ? { latitude: initialCoords.latitude, longitude: initialCoords.longitude, latitudeDelta: 0.06, longitudeDelta: 0.06 }
    : DEFAULT_REGION;

  return (
    <View style={s.root}>
      {/* Map always rendered — animates to user location on GPS resolve */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={startRegion}
        onLayout={(e: LayoutChangeEvent) => setMapSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
        onRegionChange={onRegionChange}
        onRegionChangeComplete={onRegionChangeComplete}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
      />

      {/*
        Provider pins — plain RN views positioned by screen pixel via projectToScreen,
        NOT Marker children. react-native-maps converts Marker children into a bitmap
        on Android, and that snapshot pipeline unreliably clips multi-child/elevated
        custom views. Rendering real Text/View on top of the map sidesteps it entirely,
        and recomputing from `region` on every onRegionChange tick (not just at gesture
        end) is what makes the pins glide with the map instead of freezing then snapping.
      */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {positionedProviders.map(({ p, x, y }) => {
          const pos = { x, y };
          const color = avatarColor(p.provider_id);
          const secsSinceSeen = (Date.now() - p.last_seen) / 1000;
          const ringColor = p.is_available
            ? '#10B981'                          // green  — available
            : secsSinceSeen > 1800
              ? '#EF4444'                        // red    — not seen >30m
              : '#F97316';                       // orange — busy / recent
          const firstName = p.name.split(' ')[0];
          const prof = p.profession ?? 'Provider';
          const ago = timeAgo(p.last_seen);

          return (
            <TouchableOpacity
              key={p.provider_id}
              activeOpacity={0.8}
              onPress={() => setSelected(p)}
              style={[
                s.markerBox,
                { left: pos.x - MARKER_ANCHOR.x * MARKER_BOX_W, top: pos.y - MARKER_ANCHOR.y * MARKER_BOX_H },
              ]}
            >
              <View style={[s.markerAvatarRing, { borderColor: ringColor }]}>
                {p.profile_image_url ? (
                  <Image source={{ uri: p.profile_image_url }} style={s.markerAvatarImg} />
                ) : (
                  <View style={[s.markerAvatarClip, { backgroundColor: color }]}>
                    <Text style={s.markerAvatarInitial}>{(p.name[0] ?? '?').toUpperCase()}</Text>
                  </View>
                )}
              </View>
              <View style={[s.markerTail, { borderTopColor: ringColor }]} />

              <View style={s.markerCard}>
                <View style={s.markerCardTail} />
                <Text style={s.markerName} numberOfLines={1}>{firstName}</Text>
                <Text style={s.markerProf} numberOfLines={1}>{prof}</Text>
                <Text style={s.markerTime} numberOfLines={1}>{ago}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* GPS loading pill */}
      {locating && (
        <View style={s.locatingOverlay} pointerEvents="none">
          <View style={s.locatingPill}>
            <ActivityIndicator size="small" color="#111827" />
            <Text style={s.locatingText}>Getting your location…</Text>
          </View>
        </View>
      )}

      {/* ── Floating UI (header + FABs) ─────────────────────────── */}
      <View style={s.overlay} pointerEvents="box-none">
        {/* Header */}
        <View style={[s.header, { paddingTop: insets.top + 8 }]} pointerEvents="auto">
          <TouchableOpacity style={s.headerBtn} onPress={() => router.back()}>
            <ChevronLeft size={22} color="#111827" />
          </TouchableOpacity>
          <View style={s.headerMid}>
            <Text style={s.headerTitle}>Providers Near You</Text>
            <View style={s.headerSubRow}>
              <View style={[s.headerDot, { backgroundColor: available > 0 ? '#10B981' : '#9CA3AF' }]} />
              <Text style={s.headerSub}>{available} available · {filteredProviders.length} nearby</Text>
            </View>
          </View>
          <TouchableOpacity style={s.headerBtn} onPress={refresh}>
            {isRefreshing
              ? <ActivityIndicator size="small" color="#6366F1" />
              : <RefreshCw size={20} color="#374151" />}
          </TouchableOpacity>
        </View>

        {/* Search + quick-filter chips — filters pins by profession/skill, client-side */}
        <View style={s.searchWrap} pointerEvents="auto">
          <View style={s.searchBar}>
            <Search size={16} color="#9CA3AF" />
            <TextInput
              style={s.searchInput}
              placeholder="Search by profession (e.g. Electrician)"
              placeholderTextColor="#9CA3AF"
              value={search}
              onChangeText={setSearch}
              returnKeyType="search"
            />
            {!!search && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <X size={16} color="#9CA3AF" />
              </TouchableOpacity>
            )}
          </View>
          {professions.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={s.chipsScroll}
              contentContainerStyle={s.chipsContent}
            >
              {professions.map(prof => {
                const active = search.toLowerCase() === prof.toLowerCase();
                return (
                  <TouchableOpacity
                    key={prof}
                    style={[s.chip, active && s.chipActive]}
                    onPress={() => setSearch(active ? '' : prof)}
                  >
                    <Text style={[s.chipText, active && s.chipTextActive]}>{prof}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* Locate-me FAB */}
        <View style={[s.locateWrap, { bottom: insets.bottom + 24 }]} pointerEvents="auto">
          <TouchableOpacity style={s.locateBtn} onPress={locateMe}>
            <LocateFixed size={22} color="#111827" />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Detail Bottom Sheet ──────────────────────────────────── */}
      {!!selected && (
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={() => setSelected(null)} />
      )}
      <Animated.View
        style={[s.sheet, { paddingBottom: insets.bottom + 16, transform: [{ translateY: sheetY }] }]}
        pointerEvents={selected ? 'auto' : 'none'}
      >
        {selected && (
          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            <View style={s.sheetHandle} />

            {/* Close button */}
            <TouchableOpacity style={s.sheetClose} onPress={() => setSelected(null)}>
              <X size={18} color="#6B7280" />
            </TouchableOpacity>

            <View style={s.sheetTop}>
              {/* Avatar */}
              <View style={[s.sheetRing, { borderColor: selected.is_available ? '#10B981' : '#F97316' }]}>
                <View style={[s.sheetAvatarClip, { backgroundColor: avatarColor(selected.provider_id) }]}>
                  {selected.profile_image_url ? (
                    <Image source={{ uri: selected.profile_image_url }} style={s.sheetAvatarImg} />
                  ) : (
                    <Text style={s.sheetAvatarInitial}>{(selected.name[0] ?? '?').toUpperCase()}</Text>
                  )}
                </View>
              </View>

              <View style={s.sheetInfo}>
                <Text style={s.sheetName}>{selected.name}</Text>
                <Text style={s.sheetProfession}>{selected.profession ?? 'Service Provider'}</Text>
                <View style={s.sheetStatusRow}>
                  <View style={[s.statusDot, { backgroundColor: selected.is_available ? '#10B981' : '#F97316' }]} />
                  <Text style={[s.statusText, { color: selected.is_available ? '#10B981' : '#F97316' }]}>
                    {selected.is_available ? 'Available now' : 'On a job'}
                  </Text>
                  <Text style={s.seenText}> · {timeAgo(selected.last_seen)}</Text>
                </View>
              </View>
            </View>

            {/* Stats row */}
            <View style={s.sheetStatsRow}>
              <View style={s.sheetStatBox}>
                <Text style={s.sheetStatVal}>{selected.avg_rating.toFixed(1)}</Text>
                <Text style={s.sheetStatLabel}>Rating</Text>
              </View>
              <View style={s.sheetStatDivider} />
              <View style={s.sheetStatBox}>
                <Text style={s.sheetStatVal}>{selected.jobs_completed}</Text>
                <Text style={s.sheetStatLabel}>Jobs</Text>
              </View>
              <View style={s.sheetStatDivider} />
              <View style={s.sheetStatBox}>
                <Text style={s.sheetStatVal}>{selected.distance_km.toFixed(1)} km</Text>
                <Text style={s.sheetStatLabel}>Away</Text>
              </View>
            </View>

            {(selected.skills ?? []).length > 0 && (
              <View style={s.skillsRow}>
                {(selected.skills ?? []).map(sk => (
                  <View key={sk} style={s.skillPill}>
                    <Text style={s.skillText}>{sk}</Text>
                  </View>
                ))}
              </View>
            )}

            <TouchableOpacity
              style={s.viewProfileBtn}
              activeOpacity={0.7}
              onPress={() => router.push({
                pathname: '/provider-details' as any,
                params: { id: selected.provider_id, providerId: selected.provider_id, jobId: '', viewOnly: 'true' },
              })}
            >
              <Text style={s.viewProfileBtnText}>View full profile</Text>
            </TouchableOpacity>

            {(() => {
              const inList = shortlist.some(p => p.provider_id === selected.provider_id);
              const full = !inList && shortlist.length >= MAX_SHORTLIST;
              return (
                <TouchableOpacity
                  style={[
                    s.directBtn,
                    (!selected.is_available || full) && s.directBtnDisabled,
                    inList && s.directBtnActive,
                  ]}
                  activeOpacity={selected.is_available && !full ? 0.85 : 1}
                  onPress={() => {
                    if (!selected.is_available || full) return;
                    toggleShortlist(selected);
                    // Auto-close only on ADD, so picking several providers in
                    // a row doesn't need a manual close between each pin —
                    // removal stays on this sheet in case they want to
                    // reconsider without re-tapping the same pin again.
                    if (!inList) setSelected(null);
                  }}
                >
                  <Text style={[
                    s.directBtnText,
                    (!selected.is_available || full) && s.directBtnTextDim,
                    inList && s.directBtnTextActive,
                  ]}>
                    {!selected.is_available
                      ? `${selected.name.split(' ')[0]} is currently busy`
                      : inList
                      ? `Remove ${selected.name.split(' ')[0]} from request`
                      : full
                      ? `Request is full (max ${MAX_SHORTLIST})`
                      : `Add ${selected.name.split(' ')[0]} to request`}
                  </Text>
                </TouchableOpacity>
              );
            })()}
          </ScrollView>
        )}
      </Animated.View>

      {/* Shortlist bar — build a request to 2-3 providers, asked one at a time.
          Hidden while the detail sheet is open so it can't overlap the sheet's
          own CTA button; reappears once the sheet is closed. */}
      {shortlist.length > 0 && !selected && (
        <View style={[s.shortlistBar, { bottom: insets.bottom + 88 }]} pointerEvents="box-none">
          <View style={s.shortlistPill}>
            {/* Each provider removable individually — previously this was one
                joined "Marcus → Sarah" string with a single clear-all X, so
                removing just one meant re-finding their pin on the map again. */}
            {shortlist.map((p, idx) => (
              <View key={p.provider_id} style={s.shortlistChip}>
                {idx > 0 && <Text style={s.shortlistChipArrow}>→</Text>}
                <Text style={s.shortlistChipText} numberOfLines={1}>{p.name.split(' ')[0]}</Text>
                <TouchableOpacity onPress={() => toggleShortlist(p)} hitSlop={8}>
                  <X size={11} color="#6B7280" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
          <TouchableOpacity style={s.shortlistSendBtn} onPress={sendShortlistRequest}>
            <Text style={s.shortlistSendText}>Send to {shortlist.length}</Text>
          </TouchableOpacity>
        </View>
      )}

      <VoicePostModal
        visible={voiceVisible}
        onClose={() => { setVoiceVisible(false); setTargetProvider(undefined); setQueuedProviders(undefined); }}
        lat={location?.latitude}
        lng={location?.longitude}
        onJobPosted={() => { setVoiceVisible(false); setTargetProvider(undefined); setQueuedProviders(undefined); }}
        targetProvider={targetProvider}
        queuedProviders={queuedProviders}
        initialRadiusMi={radiusMiForModal}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#E8EAF0' },
  fallback: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F9FAFB' },
  fallbackText: { fontSize: 16, fontFamily: Fonts.poppins, color: '#6B7280' },

  // ── Provider pin overlay — plain views positioned by screen pixel ──
  markerBox: { position: 'absolute', width: MARKER_BOX_W, height: MARKER_BOX_H },

  markerAvatarRing: {
    position: 'absolute', left: 0, top: 0,
    width: 52, height: 52, borderRadius: 26,
    borderWidth: 3, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  markerAvatarClip: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center',
  },
  markerAvatarImg: { width: 42, height: 42, borderRadius: 21 },
  markerAvatarInitial: { color: '#fff', fontSize: 16, fontWeight: '800' },

  markerTail: {
    position: 'absolute', left: 20, top: 52,
    width: 0, height: 0,
    borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 10,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
  },

  markerCard: {
    position: 'absolute', left: 60, top: 4,
    width: MARKER_BOX_W - 60, minHeight: 44,
    backgroundColor: '#1F2937', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 6,
    justifyContent: 'center',
  },
  markerCardTail: {
    position: 'absolute', left: -6, top: 17,
    width: 0, height: 0,
    borderTopWidth: 5, borderBottomWidth: 5, borderRightWidth: 6,
    borderTopColor: 'transparent', borderBottomColor: 'transparent',
    borderRightColor: '#1F2937',
  },
  markerName: { color: '#fff', fontSize: 12, fontWeight: '800' },
  markerProf: { color: '#D1D5DB', fontSize: 10, fontWeight: '500', marginTop: 1 },
  markerTime: { color: '#FBBF24', fontSize: 10, fontWeight: '700', marginTop: 1 },

  // ── Floating overlay ──
  overlay: { ...StyleSheet.absoluteFillObject, flexDirection: 'column' },

  // ── Header ──
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingBottom: 14,
    backgroundColor: '#fff',
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 }, elevation: 5,
  },
  headerBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerMid: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 16, fontFamily: Fonts.poppinsBold, color: '#111827' },
  headerSubRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  headerDot: { width: 6, height: 6, borderRadius: 3 },
  headerSub: { fontSize: 12, fontFamily: Fonts.poppins, color: '#6B7280' },

  // ── Search + quick-filter chips ──
  searchWrap: {
    backgroundColor: '#fff',
    paddingBottom: 10,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16,
    backgroundColor: '#F3F4F6', borderRadius: 14,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  searchInput: {
    flex: 1, fontSize: 14, fontFamily: Fonts.poppins, color: '#111827', padding: 0,
  },
  chipsScroll: { marginTop: 10 },
  chipsContent: { paddingHorizontal: 16 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: '#F3F4F6', marginRight: 8,
  },
  chipActive: { backgroundColor: '#FFCE48' },
  chipText: { fontSize: 12, fontFamily: Fonts.poppinsSemiBold, color: '#6B7280' },
  chipTextActive: { color: '#111827' },

  // ── Locate FAB ──
  locateWrap: { position: 'absolute', right: 16 },
  locateBtn: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#fff',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 }, elevation: 6,
  },

  // ── GPS loading overlay ──
  locatingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  locatingPill: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff',
    paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 30,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
  locatingText: { fontSize: 14, fontFamily: Fonts.poppinsSemiBold, color: '#111827' },

  // ── Bottom Provider Shelf ──
  shelf: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 16,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 }, elevation: 10,
  },
  shelfHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, marginBottom: 12,
  },
  shelfHeadTitle: { fontSize: 15, fontFamily: Fonts.poppinsBold, color: '#111827' },
  shelfHeadSub: { fontSize: 12, fontFamily: Fonts.poppins, color: '#6B7280' },
  shelfScroll: { paddingHorizontal: 16, paddingBottom: 4, gap: 10 },

  shelfCard: {
    width: 110,
    backgroundColor: '#fff',
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  shelfCardBar: { height: 4 },
  shelfCardInner: { padding: 12, alignItems: 'center' },

  // Avatar in shelf card: split outer ring (border/elevation) + inner clip
  shelfAvatarRing: {
    width: 50, height: 50, borderRadius: 25,
    borderWidth: 2.5,
    backgroundColor: '#fff',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 8,
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  shelfAvatarClip: {
    width: 42, height: 42, borderRadius: 21,
    overflow: 'hidden',
    justifyContent: 'center', alignItems: 'center',
  },
  shelfAvatarImg: { width: 42, height: 42 },
  shelfAvatarInitial: { fontSize: 18, fontFamily: Fonts.poppinsBold, color: '#fff' },

  shelfName: { fontSize: 12, fontFamily: Fonts.poppinsBold, color: '#111827', textAlign: 'center' },
  shelfProf: { fontSize: 10, fontFamily: Fonts.poppins, color: '#6B7280', textAlign: 'center', marginTop: 2 },
  shelfRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 6 },
  shelfRating: { fontSize: 11, fontFamily: Fonts.poppinsSemiBold, color: '#374151' },
  shelfStatusPill: {
    marginTop: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20,
  },
  shelfStatusText: { fontSize: 10, fontFamily: Fonts.poppinsSemiBold },
  shelfTime: { fontSize: 9, fontFamily: Fonts.poppins, color: '#9CA3AF', marginTop: 4 },

  // ── Detail Bottom Sheet ──
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 30, borderTopRightRadius: 30,
    paddingTop: 12, paddingHorizontal: 20,
    maxHeight: '70%',
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 24,
    shadowOffset: { width: 0, height: -6 }, elevation: 16,
  },
  sheetHandle: {
    width: 44, height: 5, borderRadius: 3,
    backgroundColor: '#E5E7EB', alignSelf: 'center', marginBottom: 8,
  },
  sheetClose: {
    position: 'absolute', top: 16, right: 20,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center', alignItems: 'center',
  },

  sheetTop: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 16, marginBottom: 16 },

  // Sheet avatar: outer ring (border/elevation) + inner clip
  sheetRing: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 3,
    backgroundColor: '#fff',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
  sheetAvatarClip: {
    width: 62, height: 62, borderRadius: 31,
    overflow: 'hidden',
    justifyContent: 'center', alignItems: 'center',
  },
  sheetAvatarImg: { width: 62, height: 62 },
  sheetAvatarInitial: { fontSize: 26, fontFamily: Fonts.poppinsBold, color: '#fff' },

  sheetInfo: { flex: 1, gap: 2 },
  sheetName: { fontSize: 20, fontFamily: Fonts.poppinsBold, color: '#111827' },
  sheetProfession: { fontSize: 13, fontFamily: Fonts.poppins, color: '#6B7280' },
  sheetStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontFamily: Fonts.poppinsSemiBold },
  seenText: { fontSize: 11, fontFamily: Fonts.poppins, color: '#9CA3AF' },

  // Stats 3-box row
  sheetStatsRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F9FAFB', borderRadius: 18,
    paddingVertical: 14, marginBottom: 16,
  },
  sheetStatBox: { flex: 1, alignItems: 'center' },
  sheetStatVal: { fontSize: 18, fontFamily: Fonts.poppinsBold, color: '#111827' },
  sheetStatLabel: { fontSize: 11, fontFamily: Fonts.poppins, color: '#6B7280', marginTop: 2 },
  sheetStatDivider: { width: 1, height: 32, backgroundColor: '#E5E7EB' },

  skillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  skillPill: {
    backgroundColor: '#EEF2FF', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  skillText: { fontSize: 12, fontFamily: Fonts.poppinsSemiBold, color: '#4F46E5' },

  viewProfileBtn: {
    borderRadius: 18, borderWidth: 1.5, borderColor: '#E5E7EB',
    paddingVertical: 13, alignItems: 'center', marginBottom: 10,
  },
  viewProfileBtnText: { fontSize: 14, fontFamily: Fonts.poppinsSemiBold, color: '#4B5563' },

  directBtn: {
    backgroundColor: '#FFCE48', borderRadius: 18,
    paddingVertical: 15, alignItems: 'center', marginBottom: 8,
  },
  directBtnDisabled: { backgroundColor: '#F3F4F6' },
  directBtnActive: { backgroundColor: '#111827' },
  directBtnText: { fontSize: 15, fontFamily: Fonts.poppinsBold, color: '#111827' },
  directBtnTextDim: { color: '#9CA3AF' },
  directBtnTextActive: { color: '#fff' },

  // ── Shortlist bar — build a multi-provider direct request from the map ──
  shortlistBar: {
    position: 'absolute', left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  shortlistPill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6,
    backgroundColor: '#fff', borderRadius: 16,
    paddingHorizontal: 10, paddingVertical: 8,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 }, elevation: 6,
  },
  shortlistChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#F3F4F6', borderRadius: 12,
    paddingHorizontal: 8, paddingVertical: 5,
  },
  shortlistChipArrow: { fontSize: 11, color: '#9CA3AF', marginRight: -2 },
  shortlistChipText: { fontSize: 12, fontFamily: Fonts.poppinsSemiBold, color: '#111827', maxWidth: 70 },
  shortlistText: { flex: 1, fontSize: 13, fontFamily: Fonts.poppinsSemiBold, color: '#111827' },
  shortlistSendBtn: {
    backgroundColor: '#FFCE48', borderRadius: 16,
    paddingHorizontal: 18, paddingVertical: 14,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 }, elevation: 6,
  },
  shortlistSendText: { fontSize: 13, fontFamily: Fonts.poppinsBold, color: '#111827' },
});
