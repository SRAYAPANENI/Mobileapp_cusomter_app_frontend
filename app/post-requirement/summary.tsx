import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { usePostRequirement } from '@/context/PostRequirementContext';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SkoFyApi } from '@/services/api';
import { milesToKm } from '@/services/units';
import Slider from '@react-native-community/slider';
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
  X,
  Zap
} from 'lucide-react-native';
import { useAppAlert } from '@/components/app-alert';
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, { FadeInUp, SlideInUp, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function JobSummaryScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const insets = useSafeAreaInsets();
  const { data, resetData } = usePostRequirement();
  // This screen had no keyboard handling at all — the inspection fee input
  // near the bottom of the form got covered outright with no way to see
  // what was typed. Scrolling straight to the focused input on its own
  // focus event is the same reliable approach used for the Service Room
  // and track-provider inputs, which don't depend on KeyboardAvoidingView
  // (unreliable inside RN <Modal>, and inconsistent even outside one).
  const scrollRef = useRef<ScrollView>(null);
  const scrollToFocusedInput = () => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
  };

  const alert = useAppAlert();
  const [selectedRange, setSelectedRange] = useState('1-5km');
  const [showManualRangeModal, setShowManualRangeModal] = useState(false);
  // There was no way anywhere in the customer app to actually set this to
  // anything but 0 — hire() would then always skip the PaymentSheet (0 =
  // "Free Inspection" is an intentional, legitimate choice server-side, so
  // this can't just default to some nonzero value instead) and the whole
  // inspection-fee escrow feature was silently unreachable.
  const [inspectionFeeInput, setInspectionFeeInput] = useState('');
  // In miles for the UI (US launch) — converted to km only when actually
  // sent to the backend, via getSearchRadiusKm below.
  const [manualRadius, setManualRadius] = useState(15);
  const [isPosting, setIsPosting] = useState(false);

  const handleConfirmManualRange = () => {
    setSelectedRange(`manual-${manualRadius}mi`);
    setShowManualRangeModal(false);
  };

  // This used to be purely decorative — the customer could pick a radius
  // and see it reflected in the UI (with a claim about pricing being tied to
  // it), but it was never actually sent to the backend at all. Distribution
  // ran on the backend's fixed default (5km, expanding to 25km) regardless
  // of what was selected here.
  const getSearchRadiusKm = (): number => {
    if (selectedRange.startsWith('manual-')) return milesToKm(manualRadius);
    if (selectedRange === '1-5km') return 5;
    if (selectedRange === '6-15km') return 15;
    if (selectedRange === '16-25km') return 25;
    return 5;
  };

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
        // A bare `|| 0` fallback only guards against NaN (empty/non-numeric
        // input) — a typed negative like "-50" is a valid finite number, so
        // it would sail through as-is and only fail later as a confusing
        // Stripe error at hire time instead of being caught here.
        inspection_fee: Math.max(0, parseFloat(inspectionFeeInput) || 0),
        lat: data.lat ?? undefined,
        lng: data.lng ?? undefined,
        search_radius_km: getSearchRadiusKm(),
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
          ref={scrollRef}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
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

        {/* --- Choose Service Range Section --- */}
        <Animated.View entering={FadeInUp.delay(900)} style={styles.rangeSection}>
          <ThemedText style={styles.sectionTitle}>Choose Service Range</ThemedText>

          <View style={styles.rangeList}>
            {[
              // IDs stay km-based internally (matching what getSearchRadiusKm
              // sends to the backend) — only the displayed label is in miles.
              { id: '1-5km', label: 'Range: 1–3 mi', price: '$15' },
              { id: '6-15km', label: 'Range: 4–9 mi', price: '$20' },
              { id: '16-25km', label: 'Range: 10–16 mi', price: '$25' },
            ].map((range) => {
              const isSelected = selectedRange === range.id;
              return (
                <TouchableOpacity
                  key={range.id}
                  onPress={() => setSelectedRange(range.id)}
                  style={[
                    styles.rangeCard,
                    isSelected && { borderColor: themeColors.brand, borderWidth: 2, backgroundColor: '#FFFBEB' }
                  ]}
                >
                  <ThemedText style={[styles.rangeLabel, isSelected && { fontFamily: Fonts.poppinsBold }]}>
                    {range.label}
                  </ThemedText>

                  <View style={styles.priceRow}>
                    <ThemedText style={[styles.rangePrice, isSelected && { fontFamily: Fonts.poppinsBold }]}>
                      {range.price}
                    </ThemedText>
                    {isSelected && (
                      <CheckCircle2 size={18} color={themeColors.brand} fill={themeColors.brand} style={{ marginLeft: 8 }} />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}

            {selectedRange.startsWith('manual-') && (
              <TouchableOpacity
                style={[
                  styles.rangeCard,
                  { borderColor: themeColors.brand, borderWidth: 2, backgroundColor: '#FFFBEB' }
                ]}
                onPress={() => setShowManualRangeModal(true)}
              >
                <ThemedText style={[styles.rangeLabel, { fontFamily: Fonts.poppinsBold }]}>
                  Custom Range: {selectedRange.replace('manual-', '').replace('mi', '')} mi
                </ThemedText>

                <View style={styles.priceRow}>
                  <ThemedText style={[styles.rangePrice, { fontFamily: Fonts.poppinsBold }]}>
                    Calculated
                  </ThemedText>
                  <CheckCircle2 size={18} color={themeColors.brand} fill={themeColors.brand} style={{ marginLeft: 8 }} />
                </View>
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={styles.adjustLink}
            onPress={() => setShowManualRangeModal(true)}
          >
            <ThemedText style={styles.adjustText}>
              Adjust Radius Manually
            </ThemedText>
          </TouchableOpacity>
        </Animated.View>

        {/* --- Inspection Fee Section --- */}
        <Animated.View entering={FadeInUp.delay(1000)} style={styles.rangeSection}>
          <ThemedText style={styles.sectionTitle}>Inspection Fee</ThemedText>
          <ThemedText style={[styles.summarySubtitle, { textAlign: 'left', marginBottom: 16 }]}>
            Held in escrow the moment you hire, and paid out to your provider once they've inspected the job on-site — before any invoice is raised. Leave at $0 for a free inspection.
          </ThemedText>
          <View style={styles.feeInputWrapper}>
            <ThemedText style={styles.feeInputPrefix}>$</ThemedText>
            <TextInput
              style={styles.feeInput}
              placeholder="0"
              placeholderTextColor={themeColors.textMuted}
              keyboardType="decimal-pad"
              value={inspectionFeeInput}
              onChangeText={setInspectionFeeInput}
              onFocus={scrollToFocusedInput}
            />
          </View>
        </Animated.View>
      </ScrollView>

      {/* --- Manual Range Picker Modal --- */}
      <Modal visible={showManualRangeModal} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <Animated.View entering={SlideInUp} style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 40 : 24) + 12 }]}>
            <View style={styles.modalHeader}>
              <ThemedText style={styles.modalTitle}>Set Custom Radius</ThemedText>
              <TouchableOpacity onPress={() => setShowManualRangeModal(false)}>
                <X size={24} color={themeColors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.manualRangeContainer}>
              <ThemedText style={styles.radiusValue}>{manualRadius} mi</ThemedText>
              <ThemedText style={styles.radiusSubtext}>Choose a radius up to 47 mi</ThemedText>

              <Slider
                style={{ width: '100%', height: 40, marginTop: 20 }}
                minimumValue={1}
                maximumValue={47}
                step={1}
                value={manualRadius}
                onValueChange={setManualRadius}
                minimumTrackTintColor={themeColors.brand}
                maximumTrackTintColor={themeColors.border}
                thumbTintColor={themeColors.brand}
              />

              <View style={styles.sliderLabels}>
                <ThemedText style={styles.sliderLabelText}>1 mi</ThemedText>
                <ThemedText style={styles.sliderLabelText}>47 mi</ThemedText>
              </View>

              <View style={styles.infoBox}>
                <ThemedText style={styles.infoBoxText}>
                  The service price will be calculated automatically based on the selected radius.
                </ThemedText>
              </View>

              <TouchableOpacity
                style={[styles.doneButton, { backgroundColor: themeColors.brand, marginTop: 32 }]}
                onPress={handleConfirmManualRange}
              >
                <ThemedText style={styles.doneButtonText}>Apply Radius</ThemedText>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </Modal>

      {/* Footer Button */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 40 : 24) + 12 }]}>
        <TouchableOpacity
          style={[styles.postButton, { backgroundColor: themeColors.brand, opacity: isPosting ? 0.7 : 1 }]}
          onPress={handleProceedToPayment}
          disabled={isPosting}
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
    fontSize: 20,
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
    fontSize: 22,
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
    fontSize: 12,
    fontFamily: Fonts.poppins,
    color: t.textMuted,
  },
  itemValue: {
    fontSize: 15,
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
    fontSize: 14,
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
    fontSize: 18,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    marginBottom: 16,
  },
  rangeList: {
    gap: 12,
  },
  rangeCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: t.card,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.border,
  },
  rangeLabel: {
    fontSize: 15,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textPrimary,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  feeInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.border,
    paddingHorizontal: 20,
    height: 56,
  },
  feeInputPrefix: {
    fontSize: 18,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    marginRight: 6,
  },
  feeInput: {
    flex: 1,
    fontSize: 18,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    height: '100%',
    // Android's default font-padding metrics can make a TextInput's text
    // render larger/lower than a plain Text sibling at the same fontSize
    // sharing a row — this is what made "$" and the typed number look
    // misaligned even with alignItems:'center' on the wrapper.
    textAlignVertical: 'center',
    paddingVertical: 0,
    includeFontPadding: false,
  },
  rangePrice: {
    fontSize: 16,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  adjustLink: {
    alignItems: 'center',
    marginTop: 20,
  },
  adjustText: {
    fontSize: 14,
    fontFamily: Fonts.poppinsSemiBold,
    color: '#3B82F6',
    textDecorationLine: 'underline',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: t.modalBackground,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  manualRangeContainer: {
    alignItems: 'center',
  },
  radiusValue: {
    fontSize: 40,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    lineHeight: 50,
    includeFontPadding: false,
  },
  radiusSubtext: {
    fontSize: 14,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
    marginTop: 4,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 4,
  },
  sliderLabelText: {
    fontSize: 12,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textMuted,
  },
  infoBox: {
    backgroundColor: '#EFF6FF',
    padding: 16,
    borderRadius: 16,
    marginTop: 24,
    width: '100%',
  },
  infoBoxText: {
    fontSize: 13,
    fontFamily: Fonts.poppinsSemiBold,
    color: '#1D4ED8',
    textAlign: 'center',
    lineHeight: 18,
  },
  doneButton: {
    height: 56,
    width: '100%',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  doneButtonText: {
    fontSize: 16,
    fontFamily: Fonts.poppinsBold,
    color: '#000',
  },
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
    fontSize: 18,
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
    fontSize: 22,
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
    fontSize: 13,
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
    fontSize: 16,
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
    fontSize: 16,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textSecondary,
  },
}); }
