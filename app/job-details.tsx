import { useAppAlert } from '@/components/app-alert';
import { OfflineScreen, useOfflinePage } from '@/components/offline-gate';
import { CareSheetSummary } from '@/components/care-sheet-summary';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SkoFyApi } from '@/services/api';
import { kmToMiles } from '@/services/units';
import { Image } from 'expo-image';
import { usePhotoPicker } from '@/components/photo-picker';
import * as Location from 'expo-location';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  ChevronLeft,
  Clock,
  DollarSign,
  MapPin,
  Mic,
  Package,
  Pencil,
  Plus,
  Maximize2,
  Sparkles,
  Video as VideoIcon,
  X,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { padBottom, useBottomInset } from '@/hooks/use-bottom-inset';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { Popup } from '@/components/popup';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Map handled dynamically, same as track-provider.tsx / provider-map.tsx —
// prevents crashes/web errors if react-native-maps isn't available.
let MapView: any;
let Marker: any;
let PROVIDER_GOOGLE: any;
if (Platform.OS !== 'web') {
  try {
    const maps = require('react-native-maps');
    MapView = maps.default;
    Marker = maps.Marker;
    PROVIDER_GOOGLE = maps.PROVIDER_GOOGLE;
  } catch {}
}

const URGENCY_LABELS: Record<string, string> = {
  HIGH: 'Urgent', EMERGENCY: 'Urgent', MEDIUM: 'Normal', LOW: 'Booked Slot',
};
const URGENCY_COLORS: Record<string, string> = {
  Urgent: '#EF4444', 'Booked Slot': '#10B981', Normal: '#F59E0B',
};

function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|m4v|webm)(\?|$)/i.test(url);
}

function formatScheduledAt(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/**
 * The job's map — its place (the pickup, for a delivery) and the drop-off.
 * Used by the small preview and the full-screen view, so both show the same.
 * It never sends anyone out to Google Maps (no toolbar).
 */
function JobMap({ job, styles, full = false }: { job: any; styles: ReturnType<typeof makeStyles>; full?: boolean }) {
  const mapRef = useRef<any>(null);
  const dropoff = job.job_type === 'PICKUP_DROPOFF' && job.dropoff_lat != null && job.dropoff_lng != null
    ? { latitude: job.dropoff_lat, longitude: job.dropoff_lng }
    : null;

  // Full screen: both pins in view, clear of the close button (the card is below the map).
  const fitAll = () => {
    if (!full || !dropoff) return;
    mapRef.current?.fitToCoordinates(
      [{ latitude: job.lat, longitude: job.lng }, dropoff],
      { edgePadding: { top: 110, right: 60, bottom: 60, left: 60 }, animated: false },
    );
  };

  return (
    <MapView
      ref={mapRef}
      // No Google toolbar: tapping a pin must not send people out to Google Maps.
      toolbarEnabled={false}
      provider={PROVIDER_GOOGLE}
      style={styles.map}
      initialRegion={{
        latitude: job.lat,
        longitude: job.lng,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      }}
      zoomEnabled
      pitchEnabled={full}
      rotateEnabled={full}
      onMapReady={fitAll}
    >
      {/* image prop, not children — the reliable native icon path,
          same reasoning as track-provider.tsx's markers. */}
      <Marker
        coordinate={{ latitude: job.lat, longitude: job.lng }}
        image={require('@/assets/images/destination-pin.png')}
        anchor={{ x: 0.5, y: 1.0 }}
      />
      {dropoff && <Marker coordinate={dropoff} pinColor="#0EA5E9" />}
    </MapView>
  );
}

export default function JobDetailsScreen() {
  const bottomInset = useBottomInset();
  const topInset = useSafeAreaInsets().top;
  const [mapFull, setMapFull] = useState(false);
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const alert = useAppAlert();
  // Camera or gallery, in the app's own popup (components/photo-picker.tsx).
  const photoPicker = usePhotoPicker();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [job, setJob] = useState<any>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [resolvedDropoffAddress, setResolvedDropoffAddress] = useState<string | null>(null);
  const hasLoadedOnceRef = useRef(false);
  const geocodedForJobIdRef = useRef<string | null>(null);
  const geocodedDropoffForJobIdRef = useRef<string | null>(null);

  // Every job posted through this app is created with raw lat/lng, never a
  // saved address_id (confirmed — no job in the DB has one set), so
  // full_address from the backend is always null. home.tsx already hit this
  // exact gap for its own job list and worked around it the same way: reverse
  // geocode client-side. Runs once per job (not on every refocus-triggered
  // reload) since it's a real network call.
  useEffect(() => {
    if (!job || job.full_address || job.lat == null || job.lng == null) return;
    if (geocodedForJobIdRef.current === job.id) return;
    geocodedForJobIdRef.current = job.id;
    Location.reverseGeocodeAsync({ latitude: job.lat, longitude: job.lng })
      .then(results => {
        if (results.length === 0) return;
        const g = results[0];
        const addr = [g.name, g.street, g.city, g.region].filter(Boolean).join(', ');
        if (addr) setResolvedAddress(addr);
      })
      .catch(() => {}); // leave blank — matches home.tsx's same fallback
  }, [job]);

  // Same reverse-geocode gap, for the drop-off point of a pickup/dropoff job
  // — the backend has no formatted address for it either, only raw coords.
  useEffect(() => {
    if (!job || job.job_type !== 'PICKUP_DROPOFF' || job.dropoff_lat == null || job.dropoff_lng == null) return;
    if (geocodedDropoffForJobIdRef.current === job.id) return;
    geocodedDropoffForJobIdRef.current = job.id;
    Location.reverseGeocodeAsync({ latitude: job.dropoff_lat, longitude: job.dropoff_lng })
      .then(results => {
        if (results.length === 0) return;
        const g = results[0];
        const addr = [g.name, g.street, g.city, g.region].filter(Boolean).join(', ');
        if (addr) setResolvedDropoffAddress(addr);
      })
      .catch(() => {});
  }, [job]);

  // useFocusEffect (not a plain mount-only useEffect) — returning here after
  // saving in edit-job.tsx, or after adding/removing a photo from a job that
  // was navigated to twice, must show fresh data, not whatever this screen
  // instance last had in state. Only the very first load shows the full-page
  // spinner; refocus reloads happen silently in the background so the
  // already-visible content doesn't flash away and back on every return trip.
  const loadJob = useCallback(() => {
    if (!jobId) {
      setLoading(false);
      setLoadError(true);
      return;
    }
    const isFirstLoad = !hasLoadedOnceRef.current;
    if (isFirstLoad) {
      setLoading(true);
      setLoadError(false);
    }
    return SkoFyApi.jobs.get(jobId)
      .then((data: any) => {
        setJob(data);
        hasLoadedOnceRef.current = true;
      })
      .catch(() => {
        if (isFirstLoad) setLoadError(true);
        // A silent refresh failing shouldn't blow away already-visible,
        // still-probably-fine content with a full error screen.
      })
      .finally(() => { if (isFirstLoad) setLoading(false); });
  }, [jobId]);

  useFocusEffect(useCallback(() => { loadJob(); }, [loadJob]));
  // After the first load, reloads are already quiet.
  const refreshControl = usePullRefresh(loadJob);

  const canEditPhotos = (job?.applicant_count ?? 0) === 0;

  const handleAddPhoto = async () => {
    if (!jobId || uploadingPhoto) return;
    // Photos are shrunk to send quickly; videos go as they are.
    const picked = await photoPicker.pickPhotos({ title: 'Add Photos', videos: true, multiple: true });
    if (picked.length === 0) return;

    setUploadingPhoto(true);
    try {
      const files = picked.map(item => {
        const isVideo = item.kind === 'video';
        const ext = item.uri.split('.').pop()?.toLowerCase();
        const mime = isVideo
          ? (ext === 'mov' ? 'video/quicktime' : 'video/mp4')
          : 'image/jpeg';
        return { uri: item.uri, type: mime, name: item.uri.split('/').pop() || `media.${ext || (isVideo ? 'mp4' : 'jpg')}` };
      });
      const uploadedUrls = await SkoFyApi.jobs.uploadMedia(files);
      const nextImages = [...(job.images || []), ...uploadedUrls];
      await SkoFyApi.jobs.update(jobId, { images: nextImages });
      setJob({ ...job, images: nextImages });
    } catch (err: any) {
      alert.show('error', 'Upload Failed', err?.message ?? 'Could not add that photo. Please try again.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = async (url: string) => {
    if (!jobId) return;
    const nextImages = (job.images || []).filter((u: string) => u !== url);
    const prevImages = job.images;
    setJob({ ...job, images: nextImages }); // optimistic
    try {
      await SkoFyApi.jobs.update(jobId, { images: nextImages });
    } catch (err: any) {
      setJob({ ...job, images: prevImages }); // roll back
      alert.show('error', 'Could Not Remove Photo', err?.message ?? 'Please try again.');
    }
  };

  // Offline with nothing loaded: the shared page; reloads when back online.
  const offline = useOfflinePage(!!job, () => { void loadJob(); });
  if (offline) return <OfflineScreen onRetry={() => { void loadJob(); }} />;

  if (loading) {
    return (
      <ThemedView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={themeColors.brand} />
      </ThemedView>
    );
  }

  if (loadError || !job) {
    return (
      <ThemedView style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
        <ThemedText style={styles.errorTitle}>
          This job's details couldn't be loaded.
        </ThemedText>
        <ThemedText style={styles.errorHint}>
          Check your connection and try again.
        </ThemedText>
        {!!jobId && (
          <TouchableOpacity style={[styles.editButton, styles.errorButton]} onPress={loadJob}>
            <ThemedText style={styles.editButtonText}>Try Again</ThemedText>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.errorBackButton} onPress={() => router.back()}>
          <ThemedText style={styles.errorBackText}>Go Back</ThemedText>
        </TouchableOpacity>
      </ThemedView>
    );
  }

  const scheduledLabel = formatScheduledAt(job.scheduled_at);
  const radiusMi = job.search_radius_km != null ? kmToMiles(job.search_radius_km) : null;
  const canEditDetails = job.status === 'POSTED' || job.status === 'DISTRIBUTED';
  const urgencyLabel = URGENCY_LABELS[job.urgency] ?? job.urgency;
  const urgencyColor = URGENCY_COLORS[urgencyLabel] ?? '#F59E0B';
  const hasLocation = job.lat != null && job.lng != null;

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={24} color="#000" />
        </TouchableOpacity>
        <ThemedText style={styles.headerTitle}>Job Details</ThemedText>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView refreshControl={refreshControl} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.mainCard}>
          <View style={styles.titleRow}>
            <ThemedText style={styles.title}>{job.title}</ThemedText>
            <View style={[styles.urgencyBadge, { backgroundColor: urgencyColor }]}>
              <ThemedText style={styles.urgencyBadgeText}>{urgencyLabel}</ThemedText>
            </View>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            <View style={[styles.badge, styles.postedViaBadge, { alignSelf: 'flex-start' }]}>
              {job.posted_via === 'VOICE' ? <Mic size={12} color="#7C3AED" /> : <Pencil size={12} color="#7C3AED" />}
              <ThemedText style={[styles.badgeText, { color: '#7C3AED' }]}>
                {job.posted_via === 'VOICE' ? 'Posted via Voice Assistant' : 'Posted Manually'}
              </ThemedText>
            </View>
            {job.service_mode === 'REMOTE' && (
              <View style={[styles.badge, { backgroundColor: '#F5F3FF', alignSelf: 'flex-start' }]}>
                <ThemedText style={[styles.badgeText, { color: '#7C3AED' }]}>Remote Engagement</ThemedText>
              </View>
            )}
          </View>

          {hasLocation && MapView && (
            <View style={styles.mapContainer}>
              <JobMap job={job} styles={styles} />
              {/* Opens the same map full screen, inside the app, with the job's details. */}
              <TouchableOpacity
                style={styles.mapExpandButton}
                onPress={() => setMapFull(true)}
                accessibilityRole="button"
                accessibilityLabel="Show the map full screen"
                hitSlop={8}
              >
                <Maximize2 size={16} color="#111827" />
              </TouchableOpacity>
            </View>
          )}
          {(job.full_address || resolvedAddress) && (
            <View style={[styles.metaRow, { marginTop: hasLocation ? 12 : 0 }]}>
              <View style={[styles.metaIconCircle, { backgroundColor: '#FEF2F2' }]}>
                <MapPin size={16} color="#DC2626" />
              </View>
              <ThemedText style={styles.metaText} numberOfLines={2}>
                {job.job_type === 'PICKUP_DROPOFF' ? 'Pickup: ' : ''}{job.full_address || resolvedAddress}
              </ThemedText>
            </View>
          )}
          {job.job_type === 'PICKUP_DROPOFF' && (job.dropoff_lat != null || job.dropoff_address || resolvedDropoffAddress) && (
            <View style={[styles.metaRow, { marginTop: 8 }]}>
              <View style={[styles.metaIconCircle, { backgroundColor: '#EFF6FF' }]}>
                <MapPin size={16} color="#0EA5E9" />
              </View>
              <ThemedText style={styles.metaText} numberOfLines={2}>
                Deliver to: {job.dropoff_address || resolvedDropoffAddress || 'Resolving address…'}
              </ThemedText>
            </View>
          )}
          {job.pickup_source === 'PERSON' && !!job.pickup_item && (
            <View style={[styles.metaRow, { marginTop: 8 }]}>
              <View style={[styles.metaIconCircle, { backgroundColor: '#FFFBEB' }]}>
                <Package size={16} color="#B45309" />
              </View>
              <ThemedText style={styles.metaText} numberOfLines={2}>
                {job.pickup_details?.recipient_name ? `Sending to ${job.pickup_details.recipient_name}` : 'From a person'}: {job.pickup_item}
                {job.item_value != null ? ` (worth $${Number(job.item_value).toFixed(2)})` : ''}
              </ThemedText>
            </View>
          )}
          {!!job.pickup_refusal && (
            <View style={[styles.metaRow, { marginTop: 8 }]}>
              <View style={[styles.metaIconCircle, { backgroundColor: '#FEF2F2' }]}>
                <X size={16} color="#DC2626" />
              </View>
              <ThemedText style={styles.metaText} numberOfLines={3}>
                The provider didn't take the item: {String(job.pickup_refusal).toLowerCase()}. Their trip fee was kept.
              </ThemedText>
            </View>
          )}
        </View>

        <CareSheetSummary custody={job.shape?.custody} sheet={job.care_sheet} />

        <View style={styles.mainCard}>
          <ThemedText style={styles.sectionLabel}>Description</ThemedText>
          <ThemedText style={styles.description}>{job.description}</ThemedText>

          {job.required_skills?.length > 0 && (
            <>
              <ThemedText style={styles.sectionLabel}>Skills Requested</ThemedText>
              <View style={styles.skillsRow}>
                {job.required_skills.map((s: any) => (
                  <View key={s.skill_id} style={styles.skillChip}>
                    <ThemedText style={styles.skillChipText}>{s.name}</ThemedText>
                  </View>
                ))}
              </View>
            </>
          )}

          <View style={styles.metaGrid}>
            {scheduledLabel && (
              <View style={styles.metaRow}>
                <View style={[styles.metaIconCircle, { backgroundColor: '#EFF6FF' }]}>
                  <Clock size={16} color="#2563EB" />
                </View>
                <ThemedText style={styles.metaText}>{scheduledLabel}</ThemedText>
              </View>
            )}
            {(job.budget_min != null || job.budget_max != null) && (
              <View style={styles.metaRow}>
                <View style={[styles.metaIconCircle, { backgroundColor: '#ECFDF5' }]}>
                  <DollarSign size={16} color="#059669" />
                </View>
                <ThemedText style={styles.metaText}>
                  {job.budget_min != null ? `$${job.budget_min}` : ''}
                  {job.budget_min != null && job.budget_max != null ? ' – ' : ''}
                  {job.budget_max != null ? `$${job.budget_max}` : ''}
                </ThemedText>
              </View>
            )}
            {radiusMi != null && (
              <View style={styles.metaRow}>
                <View style={[styles.metaIconCircle, { backgroundColor: '#FFFBEB' }]}>
                  <MapPin size={16} color="#B45309" />
                </View>
                <ThemedText style={styles.metaText}>Posted within {radiusMi.toFixed(0)} mi</ThemedText>
              </View>
            )}
          </View>
        </View>

        <View style={styles.mainCard}>
          <View style={styles.photosHeaderRow}>
            <ThemedText style={[styles.sectionLabel, { marginTop: 0 }]}>Photos & Videos</ThemedText>
            {!canEditPhotos && (
              <ThemedText style={styles.lockedNote}>Locked — a provider has already applied</ThemedText>
            )}
          </View>
          <View style={styles.photoGrid}>
            {(job.images || []).map((url: string) => (
              <View key={url} style={styles.photoThumbWrapper}>
                {isVideoUrl(url) ? (
                  // A video file fed into <Image> renders blank/broken —
                  // it's not a still frame. A plain placeholder is simpler
                  // and more reliable here than pulling in video-thumbnail
                  // generation just for this grid.
                  <View style={[styles.photoThumb, styles.videoThumbPlaceholder]}>
                    <VideoIcon size={22} color="#fff" />
                  </View>
                ) : (
                  <Image source={{ uri: url }} style={styles.photoThumb} contentFit="cover" />
                )}
                {canEditPhotos && (
                  <TouchableOpacity style={styles.removePhotoBtn} onPress={() => handleRemovePhoto(url)}>
                    <X size={12} color="#fff" />
                  </TouchableOpacity>
                )}
              </View>
            ))}
            {canEditPhotos && (
              <TouchableOpacity style={styles.addPhotoThumb} onPress={handleAddPhoto} disabled={uploadingPhoto}>
                {uploadingPhoto ? (
                  <ActivityIndicator size="small" color={themeColors.brand} />
                ) : (
                  <Plus size={22} color={themeColors.textSecondary} />
                )}
              </TouchableOpacity>
            )}
          </View>
          {(job.images || []).length === 0 && !canEditPhotos && (
            <ThemedText style={styles.metaText}>No photos were attached to this job.</ThemedText>
          )}
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>

      {canEditDetails && (
        <View style={padBottom(styles.footer, bottomInset)}>
          <TouchableOpacity
            style={styles.editButton}
            onPress={() => router.push({ pathname: '/edit-job', params: { jobId } })}
          >
            <Sparkles size={16} color="#000" />
            <ThemedText style={styles.editButtonText}>Edit Details</ThemedText>
          </TouchableOpacity>
        </View>
      )}

      {alert.element}
      {photoPicker.element}
      {/* The map, full screen — still inside the app, with the job's details. */}
      {hasLocation && MapView && (
        <Popup closeOn="back" visible={mapFull} animationType="slide" onClose={() => setMapFull(false)} statusBarTranslucent navigationBarTranslucent>
          <View style={[styles.mapFullScreen, { backgroundColor: themeColors.background }]}>
            {/* The map fills what the card leaves — the card never covers it
                (nor Google's logo in its corner). */}
            <View style={styles.mapFullArea}>
              <JobMap job={job} styles={styles} full />

              <TouchableOpacity
                style={[styles.mapFullClose, { top: topInset + 12 }]}
                onPress={() => setMapFull(false)}
                accessibilityRole="button"
                accessibilityLabel="Close the map"
                hitSlop={8}
              >
                <X size={22} color="#111827" />
              </TouchableOpacity>
            </View>

            <View style={[styles.mapFullCard, { paddingBottom: bottomInset + 16 }]}>
              <ThemedText style={styles.mapFullTitle} numberOfLines={2}>{job.title}</ThemedText>
              {(job.full_address || resolvedAddress) && (
                <View style={styles.mapFullRow}>
                  <MapPin size={16} color="#DC2626" />
                  <ThemedText style={styles.mapFullText} numberOfLines={2}>
                    {job.job_type === 'PICKUP_DROPOFF' ? 'Pickup: ' : ''}{job.full_address || resolvedAddress}
                  </ThemedText>
                </View>
              )}
              {job.job_type === 'PICKUP_DROPOFF' && (job.dropoff_address || resolvedDropoffAddress) && (
                <View style={styles.mapFullRow}>
                  <MapPin size={16} color="#0EA5E9" />
                  <ThemedText style={styles.mapFullText} numberOfLines={2}>
                    Deliver to: {job.dropoff_address || resolvedDropoffAddress}
                  </ThemedText>
                </View>
              )}
              <View style={styles.mapFullStats}>
                <View style={styles.mapFullStat}>
                  <Clock size={14} color="#2563EB" />
                  <ThemedText style={styles.mapFullStatText}>{scheduledLabel ?? 'As soon as possible'}</ThemedText>
                </View>
                {(job.budget_min != null || job.budget_max != null) && (
                  <View style={styles.mapFullStat}>
                    <DollarSign size={14} color="#059669" />
                    <ThemedText style={styles.mapFullStatText}>
                      {job.budget_min != null ? `$${job.budget_min}` : ''}
                      {job.budget_min != null && job.budget_max != null ? ' – ' : ''}
                      {job.budget_max != null ? `$${job.budget_max}` : ''}
                    </ThemedText>
                  </View>
                )}
              </View>
            </View>
          </View>
        </Popup>
      )}
    </ThemedView>
  );
}

function makeStyles(t: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.inputFilled },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: Platform.OS === 'ios' ? 60 : 40,
      paddingBottom: 20,
      backgroundColor: t.card,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    backButton: { width: 40, height: 40, justifyContent: 'center' },
    headerTitle: { fontSize: 18, lineHeight: 22, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
    scrollContent: { padding: 16, paddingBottom: 40 },
    mainCard: {
      backgroundColor: t.card,
      borderRadius: 20,
      padding: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.05,
      shadowRadius: 10,
      elevation: 3,
      marginBottom: 16,
    },
    titleRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 10,
      marginBottom: 12,
    },
    title: { flex: 1, fontSize: 22, lineHeight: 28, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
    urgencyBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    urgencyBadgeText: {
      fontSize: 11, lineHeight: 15, fontFamily: Fonts.poppinsBold, color: '#fff',
      textTransform: 'uppercase', letterSpacing: 0.5,
    },
    badge: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: t.card, paddingHorizontal: 12, paddingVertical: 6,
      borderRadius: 10, borderWidth: 1, borderColor: t.border,
    },
    postedViaBadge: { backgroundColor: '#F5F3FF', borderColor: '#DDD6FE' },
    badgeText: { fontSize: 12, lineHeight: 16, fontFamily: Fonts.poppinsSemiBold, color: t.textSecondary },
    mapContainer: { height: 160, borderRadius: 16, overflow: 'hidden' },
    mapExpandButton: {
      // Top-right: the bottom-left corner is Google's logo, which must stay visible.
      position: 'absolute', top: 10, right: 10, width: 34, height: 34, borderRadius: 17,
      backgroundColor: 'rgba(255, 255, 255, 0.95)', alignItems: 'center', justifyContent: 'center',
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.15, shadowRadius: 3, elevation: 3,
    },
    mapFullScreen: { flex: 1 },
    mapFullArea: { flex: 1, overflow: 'hidden' },
    mapFullClose: {
      position: 'absolute', left: 16, width: 42, height: 42, borderRadius: 21,
      backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 4, elevation: 4,
    },
    mapFullCard: {
      // Square top: it sits below the map, so rounded corners would show gaps.
      backgroundColor: t.card, paddingHorizontal: 20, paddingTop: 18, gap: 8,
      shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 10,
    },
    mapFullTitle: { fontSize: 18, lineHeight: 24, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
    mapFullRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    mapFullText: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: Fonts.poppins, color: t.textSecondary },
    mapFullStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
    mapFullStat: {
      flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6,
      borderRadius: 14, backgroundColor: 'rgba(255, 206, 72, 0.14)',
    },
    mapFullStatText: { fontSize: 12, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: t.textPrimary },
    map: { flex: 1 },
    sectionLabel: {
      fontSize: 13, lineHeight: 17, fontFamily: Fonts.poppinsSemiBold, color: t.textSecondary,
      marginBottom: 8, marginTop: 20,
    },
    description: { fontSize: 14, fontFamily: Fonts.poppins, color: t.textPrimary, lineHeight: 21 },
    skillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    skillChip: {
      backgroundColor: '#EFF6FF', paddingHorizontal: 14, paddingVertical: 8,
      borderRadius: 10, borderWidth: 1, borderColor: '#BFDBFE',
    },
    skillChipText: { fontSize: 13, lineHeight: 17, fontFamily: Fonts.poppinsBold, color: '#1D4ED8' },
    metaGrid: { marginTop: 20, gap: 10 },
    metaRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: t.inputFilled, borderRadius: 14, padding: 10,
    },
    metaIconCircle: {
      width: 32, height: 32, borderRadius: 16,
      alignItems: 'center', justifyContent: 'center',
    },
    metaText: { fontSize: 14, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: t.textPrimary, flexShrink: 1 },
    photosHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    lockedNote: { fontSize: 11, lineHeight: 15, fontFamily: Fonts.poppins, color: t.textMuted },
    photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    photoThumbWrapper: { width: 84, height: 84, borderRadius: 12, overflow: 'hidden' },
    photoThumb: { width: '100%', height: '100%' },
    videoThumbPlaceholder: { backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
    removePhotoBtn: {
      position: 'absolute', top: 4, right: 4,
      width: 20, height: 20, borderRadius: 10,
      backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
    },
    addPhotoThumb: {
      width: 84, height: 84, borderRadius: 12,
      backgroundColor: t.inputFilled, borderWidth: 1, borderColor: t.border, borderStyle: 'dashed',
      alignItems: 'center', justifyContent: 'center',
    },
    footer: {
      padding: 20,
      backgroundColor: t.card,
      borderTopWidth: 1,
      borderTopColor: t.border,
    },
    editButton: {
      flexDirection: 'row', gap: 8,
      backgroundColor: t.brand,
      height: 56,
      borderRadius: 28,
      justifyContent: 'center',
      alignItems: 'center',
    },
    editButtonText: {
      fontSize: 16, lineHeight: 20,
      fontFamily: Fonts.poppinsBold,
      color: '#000',
    },
    errorTitle: {
      fontFamily: Fonts.poppinsSemiBold, fontSize: 16, lineHeight: 22,
      color: t.textPrimary, textAlign: 'center',
    },
    errorHint: {
      fontFamily: Fonts.poppins, fontSize: 13, lineHeight: 19,
      color: t.textSecondary, textAlign: 'center', marginTop: 6, marginBottom: 24,
    },
    errorButton: {
      alignSelf: 'stretch',
      paddingHorizontal: 32,
    },
    errorBackButton: {
      marginTop: 12,
      paddingVertical: 12,
      paddingHorizontal: 32,
    },
    errorBackText: {
      fontFamily: Fonts.poppinsSemiBold, fontSize: 15, lineHeight: 21,
      color: t.textSecondary,
    },
  });
}
