import { useAppAlert } from '@/components/app-alert';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SkoFyApi } from '@/services/api';
import { kmToMiles } from '@/services/units';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  ChevronLeft,
  Clock,
  DollarSign,
  MapPin,
  Mic,
  Pencil,
  Plus,
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

export default function JobDetailsScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const alert = useAppAlert();

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
  useFocusEffect(
    useCallback(() => {
      if (!jobId) {
        setLoading(false);
        setLoadError(true);
        return;
      }
      const isFirstLoad = !hasLoadedOnceRef.current;
      if (isFirstLoad) setLoading(true);
      SkoFyApi.jobs.get(jobId)
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
    }, [jobId])
  );

  const canEditPhotos = (job?.applicant_count ?? 0) === 0;

  const handleAddPhoto = async () => {
    if (!jobId || uploadingPhoto) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return;

    setUploadingPhoto(true);
    try {
      const files = result.assets.map(asset => {
        const isVideo = asset.type === 'video' || !!asset.duration;
        const ext = asset.uri.split('.').pop()?.toLowerCase();
        const mime = isVideo
          ? (ext === 'mov' ? 'video/quicktime' : 'video/mp4')
          : 'image/jpeg';
        return { uri: asset.uri, type: mime, name: asset.uri.split('/').pop() || `media.${ext || (isVideo ? 'mp4' : 'jpg')}` };
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
        <ThemedText style={{ fontFamily: Fonts.poppinsSemiBold, fontSize: 15, color: themeColors.textPrimary, textAlign: 'center', marginBottom: 16 }}>
          This job's details couldn't be loaded.
        </ThemedText>
        <TouchableOpacity style={styles.editButton} onPress={() => router.back()}>
          <ThemedText style={styles.editButtonText}>Go Back</ThemedText>
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

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
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
              <MapView
                provider={PROVIDER_GOOGLE}
                style={styles.map}
                initialRegion={{
                  latitude: job.lat,
                  longitude: job.lng,
                  latitudeDelta: 0.02,
                  longitudeDelta: 0.02,
                }}
                zoomEnabled
                pitchEnabled={false}
                rotateEnabled={false}
              >
                {/* image prop, not children — the reliable native icon path,
                    same reasoning as track-provider.tsx's markers. */}
                <Marker
                  coordinate={{ latitude: job.lat, longitude: job.lng }}
                  image={require('@/assets/images/destination-pin.png')}
                  anchor={{ x: 0.5, y: 1.0 }}
                />
                {job.job_type === 'PICKUP_DROPOFF' && job.dropoff_lat != null && job.dropoff_lng != null && (
                  <Marker
                    coordinate={{ latitude: job.dropoff_lat, longitude: job.dropoff_lng }}
                    pinColor="#0EA5E9"
                  />
                )}
              </MapView>
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
          {job.job_type === 'PICKUP_DROPOFF' && (job.dropoff_lat != null || resolvedDropoffAddress) && (
            <View style={[styles.metaRow, { marginTop: 8 }]}>
              <View style={[styles.metaIconCircle, { backgroundColor: '#EFF6FF' }]}>
                <MapPin size={16} color="#0EA5E9" />
              </View>
              <ThemedText style={styles.metaText} numberOfLines={2}>
                Deliver to: {resolvedDropoffAddress || 'Resolving address…'}
              </ThemedText>
            </View>
          )}
        </View>

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
        <View style={styles.footer}>
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
  });
}
