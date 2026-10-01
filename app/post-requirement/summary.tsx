import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { usePostRequirement } from '@/context/PostRequirementContext';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SkoFyApi } from '@/services/api';
import { router } from 'expo-router';
import {
  ArrowLeft,
  Briefcase,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  MapPin,
  Sparkles,
  Zap
} from 'lucide-react-native';
import { useAppAlert } from '@/components/app-alert';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, { FadeInUp, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function JobSummaryScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const insets = useSafeAreaInsets();
  const { data, updateData, resetData } = usePostRequirement();
  const alert = useAppAlert();
  const [isPosting, setIsPosting] = useState(false);

  // On-site vs Remote is decided here, as the LAST thing before posting —
  // not up front — same reasoning as CreateJobRequest.service_mode: a
  // REMOTE job (e.g. hiring a remote consultant) needs no location at all,
  // and On-site vs Remote is a decision, not information the customer had
  // to already have when they started describing the problem.
  const handleServiceModeChange = (mode: 'ON_SITE' | 'REMOTE') => {
    if (mode === data.serviceMode) return;
    updateData({ serviceMode: mode });
  };

  // A REMOTE job never needs a location; an ON_SITE one does. Since the
  // choice now happens on this screen, the "is a location required" gate
  // moves here too (previously enforced on step1, before the customer had
  // even said which mode they wanted).
  const hasLocation = data.serviceMode === 'REMOTE'
    ? true
    : (data.lat != null && data.lng != null);

  const urgencyMap: Record<string, string> = {
    Urgent: 'HIGH',
    Normal: 'MEDIUM',
    'Book Slot': 'LOW',
  };

  // data.date/time are friendly display strings ("Today", "09:00 AM - 11:00
  // AM") that can't be reliably parsed back — dateISO/timeHour/timeMinute/
  // timePeriod are the raw values captured alongside them in step2, used
  // here to build the real timestamp that actually gets sent to the
  // backend (previously this was silently never sent at all).
  const computeScheduledAt = (): string | undefined => {
    if (!data.dateISO) return undefined;
    const base = new Date(data.dateISO);
    let hour24 = parseInt(data.timeHour, 10) % 12;
    if (data.timePeriod === 'PM') hour24 += 12;
    base.setHours(hour24, parseInt(data.timeMinute, 10), 0, 0);
    return base.toISOString();
  };

  const handleProceedToPayment = async () => {
    if (!hasLocation) {
      alert.show('error', 'No Location Selected', "Go back to Home and choose a location before posting, or this job won't reach any providers.");
      return;
    }
    setIsPosting(true);
    try {
      // Use the full set of skills selected in step2 (real backend skill IDs)
      let skillIds = data.skill_ids;

      // Fallback: resolve from API if user skipped skill selection entirely
      if (skillIds.length === 0) {
        const skillList: any[] = await SkoFyApi.skills.list(data.profession).catch(() => []);
        const fallbackId = skillList?.[0]?.id;
        if (fallbackId) skillIds = [fallbackId];
      }
      if (skillIds.length === 0) throw new Error('Could not find a matching skill. Please go back and select a skill.');

      const title = data.skills.length > 0
        ? `${data.profession} – ${data.skills[0]}`
        : data.profession;

      // Upload any photos/videos the customer attached in step 1
      let imageUrls: string[] = [];
      if (Array.isArray(data.media) && data.media.length > 0) {
        try {
          const files = data.media.map((m: any) => ({
            uri: m.uri,
            type: m.type === 'video' ? 'video/mp4' : 'image/jpeg',
            name: m.uri.split('/').pop() || 'media.jpg',
          }));
          imageUrls = await SkoFyApi.jobs.uploadMedia(files);
        } catch {
          // Non-fatal — job still posts without images
        }
      }

      await SkoFyApi.jobs.create({
        title,
        description: data.description || `${data.profession} service required.`,
        skill_ids: skillIds,
        urgency: (urgencyMap[data.jobType] || 'MEDIUM') as any,
        lat: data.lat ?? undefined,
        lng: data.lng ?? undefined,
        scheduled_at: computeScheduledAt(),
        images: imageUrls,
        posted_via: 'MANUAL',
        job_type: data.jobKind,
        dropoff_lat: data.jobKind === 'PICKUP_DROPOFF' ? (data.dropoffLat ?? undefined) : undefined,
        dropoff_lng: data.jobKind === 'PICKUP_DROPOFF' ? (data.dropoffLng ?? undefined) : undefined,
        pickup_place_id: data.jobKind === 'PICKUP_DROPOFF' ? (data.pickupPlaceId ?? undefined) : undefined,
        pickup_place_type: data.jobKind === 'PICKUP_DROPOFF' ? (data.pickupPlaceType ?? undefined) : undefined,
        service_mode: data.serviceMode,
      });

      resetData();
      alert.show(
        'success',
        'Requirement Posted!',
        'Nearby providers have been notified and will submit their bids shortly.',
        [
          { text: 'View My Jobs', onPress: () => router.replace('/my-jobs') },
          { text: 'Stay Here', variant: 'secondary' },
        ],
      );
    } catch (err: any) {
      alert.show('error', 'Failed to Post', err?.message || 'Something went wrong. Please try again.');
    } finally {
      setIsPosting(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <ArrowLeft size={24} color={themeColors.text} />
          </TouchableOpacity>
          <ThemedText style={styles.headerTitle}>Job Summary</ThemedText>
        </View>

        {/* --- Summary Main Card --- */}
        <View style={styles.summaryCard}>
          <Animated.View entering={ZoomIn.delay(200)} style={styles.successIconContainer}>
            <View style={[styles.successCircle, { backgroundColor: themeColors.brand }]}>
              <Sparkles size={32} color="#000" />
            </View>
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(400)} style={styles.summaryHeader}>
            <ThemedText style={styles.summaryTitle}>Review Your Requirement</ThemedText>
            <ThemedText style={styles.summarySubtitle}>Double check the details before we find you the best pros.</ThemedText>
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(600)} style={styles.detailsList}>
            <SummaryItem
              styles={styles}
              icon={Briefcase}
              label="Profession"
              value={data.profession}
              color="#3B82F6"
            />
            <SummaryItem
              styles={styles}
              icon={Zap}
              label="Job Type"
              value={data.jobType}
              color="#EF4444"
            />
            {data.skills.length > 0 && (
              <SummaryItem
                styles={styles}
                icon={CheckCircle2}
                label="Selected Skills"
                value={data.skills.join(', ')}
                color="#8B5CF6"
              />
            )}
            <SummaryItem
              styles={styles}
              icon={Calendar}
              label="Date"
              value={data.date}
              color="#10B981"
            />
            <SummaryItem
              styles={styles}
              icon={Clock}
              label="Time Slot"
              value={data.time}
              color="#F59E0B"
            />
            {data.serviceMode === 'REMOTE' ? (
              <SummaryItem
                styles={styles}
                icon={MapPin}
                label="Location"
                value="Remote — no location needed"
                color="#7C3AED"
              />
            ) : (
              <>
                <SummaryItem
                  styles={styles}
                  icon={MapPin}
                  label={data.jobKind === 'PICKUP_DROPOFF' ? 'Pickup from' : 'Location'}
                  value={data.address || 'No location selected'}
                  color="#6366F1"
                />
                {data.jobKind === 'PICKUP_DROPOFF' && (
                  <SummaryItem
                    styles={styles}
                    icon={MapPin}
                    label="Deliver to"
                    value={data.dropoffAddress || 'No drop-off address selected'}
                    color="#0EA5E9"
                  />
                )}
              </>
            )}
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(800)} style={styles.descriptionBox}>
            <ThemedText style={styles.descriptionLabel}>Problem Description</ThemedText>
            <ThemedText style={styles.descriptionText}>
              {data.description || 'No additional description provided.'}
            </ThemedText>
          </Animated.View>
        </View>

        {/* --- On-site / Remote — the last decision before posting --- */}
        <Animated.View entering={FadeInUp.delay(900)} style={styles.rangeSection}>
          <ThemedText style={styles.sectionTitle}>How should this be done?</ThemedText>

          <View style={styles.jobKindRow}>
            <TouchableOpacity
              style={[styles.jobKindChip, data.serviceMode === 'ON_SITE' && styles.jobKindChipActive]}
              onPress={() => handleServiceModeChange('ON_SITE')}
            >
              <MapPin size={16} color={data.serviceMode === 'ON_SITE' ? '#111827' : themeColors.textSecondary} />
              <ThemedText style={[styles.jobKindChipText, data.serviceMode === 'ON_SITE' && styles.jobKindChipTextActive]}>
                On-site
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.jobKindChip, data.serviceMode === 'REMOTE' && styles.jobKindChipActive]}
              onPress={() => handleServiceModeChange('REMOTE')}
            >
              <Sparkles size={16} color={data.serviceMode === 'REMOTE' ? '#111827' : themeColors.textSecondary} />
              <ThemedText style={[styles.jobKindChipText, data.serviceMode === 'REMOTE' && styles.jobKindChipTextActive]}>
                Remote
              </ThemedText>
            </TouchableOpacity>
          </View>

          {data.serviceMode === 'REMOTE' ? (
            <View style={styles.remoteNoticeBox}>
              <ThemedText style={styles.remoteNoticeText}>
                No location needed — this job will be matched to skilled providers by skill and availability, wherever they are.
              </ThemedText>
            </View>
          ) : !hasLocation ? (
            <View style={styles.locationWarningBox}>
              <MapPin size={14} color="#EF4444" />
              <ThemedText style={styles.locationWarningText}>
                No location selected — go back to Home and choose one before posting.
              </ThemedText>
            </View>
          ) : null}
        </Animated.View>
      </ScrollView>

      {/* Footer Button */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 40 : 24) + 12 }]}>
        <TouchableOpacity
          style={[styles.postButton, { backgroundColor: themeColors.brand, opacity: (isPosting || !hasLocation) ? 0.5 : 1 }]}
          onPress={handleProceedToPayment}
          disabled={isPosting || !hasLocation}
        >
          {isPosting
            ? <ActivityIndicator size="small" color="#111827" style={{ marginRight: 8 }} />
            : <CreditCard size={20} color="#111827" style={{ marginRight: 8 }} />
          }
          <ThemedText style={styles.postButtonText}>
            {isPosting ? 'Posting...' : 'Post Requirement'}
          </ThemedText>
        </TouchableOpacity>
      </View>
      </KeyboardAvoidingView>

      {alert.element}
    </ThemedView>
  );
}

function SummaryItem({ styles, icon: Icon, label, value, color }: any) {
  return (
    <View style={styles.summaryItem}>
      <View style={[styles.itemIconContainer, { backgroundColor: color + '15' }]}>
        <Icon size={20} color={color} />
      </View>
      <View style={styles.itemContent}>
        <ThemedText style={styles.itemLabel}>{label}</ThemedText>
        <ThemedText style={styles.itemValue}>{value}</ThemedText>
      </View>
    </View>
  );
}

function makeStyles(t: typeof Colors.light) { return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.surface,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 120,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 20, lineHeight: 25,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  summaryCard: {
    backgroundColor: t.card,
    borderRadius: 32,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 4,
    marginBottom: 24,
  },
  successIconContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  successCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FFCE48',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  summaryHeader: {
    alignItems: 'center',
    marginBottom: 32,
  },
  summaryTitle: {
    fontSize: 22, lineHeight: 28,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    textAlign: 'center',
  },
  summarySubtitle: {
    fontSize: 13,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 18,
  },
  detailsList: {
    gap: 16,
    marginBottom: 32,
  },
  summaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  itemIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemContent: {
    flex: 1,
  },
  itemLabel: {
    fontSize: 12, lineHeight: 16,
    fontFamily: Fonts.poppins,
    color: t.textMuted,
  },
  itemValue: {
    fontSize: 15, lineHeight: 19,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  descriptionBox: {
    backgroundColor: t.surface,
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: t.inputFilled,
  },
  descriptionLabel: {
    fontSize: 14, lineHeight: 18,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    marginBottom: 8,
  },
  descriptionText: {
    fontSize: 14,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
    lineHeight: 20,
  },
  // Range Styles
  rangeSection: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18, lineHeight: 22,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    marginBottom: 16,
  },
  jobKindRow: { flexDirection: 'row', gap: 10 },
  jobKindChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12,
    borderWidth: 1, borderColor: t.border, backgroundColor: t.card,
  },
  jobKindChipActive: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  jobKindChipText: { fontSize: 13, fontFamily: Fonts.poppinsSemiBold, color: t.textSecondary },
  jobKindChipTextActive: { color: '#111827', fontFamily: Fonts.poppinsBold },
  remoteNoticeBox: {
    backgroundColor: '#F5F3FF', borderRadius: 12, borderWidth: 1, borderColor: '#DDD6FE',
    paddingHorizontal: 14, paddingVertical: 12, marginTop: 16,
  },
  remoteNoticeText: { fontSize: 12.5, fontFamily: Fonts.poppinsSemiBold, color: '#5B21B6', lineHeight: 18 },
  locationWarningBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 16,
  },
  locationWarningText: { fontSize: 12, color: '#EF4444', flex: 1, fontFamily: Fonts.poppins },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    backgroundColor: t.card,
    borderTopWidth: 1,
    borderTopColor: t.inputFilled,
  },
  postButton: {
    height: 60,
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FFCE48',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  postButtonText: {
    fontSize: 18, lineHeight: 22,
    fontFamily: Fonts.poppinsBold,
    color: '#000',
  },
  // Success Modal Styles
  successModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  blurOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  successCard: {
    backgroundColor: t.card,
    borderRadius: 32,
    padding: 32,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.15,
    shadowRadius: 30,
    elevation: 10,
  },
  successIconOuter: {
    width: 90,
    height: 90,
    borderRadius: 45,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  successIconInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  successTitle: {
    fontSize: 22, lineHeight: 28,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    textAlign: 'center',
    marginBottom: 12,
  },
  successMessage: {
    fontSize: 15,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.inputFilled,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 32,
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F59E0B',
  },
  statusText: {
    fontSize: 13, lineHeight: 17,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textSecondary,
  },
  successButtonContainer: {
    width: '100%',
    gap: 12,
  },
  primaryModalButton: {
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FFCE48',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryModalButtonText: {
    fontSize: 16, lineHeight: 20,
    fontFamily: Fonts.poppinsBold,
    color: '#000',
  },
  secondaryModalButton: {
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.border,
  },
  secondaryModalButtonText: {
    fontSize: 16, lineHeight: 20,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textSecondary,
  },
}); }
