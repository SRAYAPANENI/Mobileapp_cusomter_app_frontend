import { useAppAlert } from '@/components/app-alert';
import { CancelJobModal } from '@/components/cancel-job-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { kmToMiles } from '@/services/units';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import {
  Award,
  ChevronLeft,
  MapPin,
  Pencil,
  Sparkles,
  CheckCircle2,
  XCircle,
  Star,
  Briefcase
} from 'lucide-react-native';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
  View,
  Modal
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { SkoFyApi } from '@/services/api';
import { Applicant } from '@/data/applicantsData';
import { useHirePayment } from '@/hooks/use-hire-payment';

const { width } = Dimensions.get('window');


function ApplicantCard({
  item,
  index,
  isHired,
  isHiring,
  jobId,
  onHire,
  onReject
}: {
  item: Applicant;
  index: number;
  isHired: boolean;
  isHiring: boolean;
  jobId?: string;
  onHire: () => void;
  onReject: () => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 100).springify()}
      style={styles.card}
    >
      <TouchableOpacity
        style={styles.cardHeader}
        activeOpacity={0.7}
        onPress={() => isHired
          // push, not replace — replacing left track-provider with nothing
          // behind it in the stack, so the hardware back button exited the
          // app instead of returning to this applicants list.
          ? router.push({ pathname: '/track-provider', params: { jobId: jobId ?? '' } })
          : router.push({
              pathname: '/provider-details' as any,
              params: {
                id: item.id,
                providerId: (item as any).providerId ?? item.id,
                jobId: jobId ?? '',
                skillMatch: String(item.skillMatch ?? ''),
                distance: item.distance ?? '',
              }
            })}
      >
        <Image
          source={{ uri: item.profileImage }}
          style={styles.profileImage}
          contentFit="cover"
        />
        <View style={styles.headerInfo}>
          <View style={styles.nameRow}>
            <ThemedText style={styles.nameText}>{item.name}</ThemedText>
            <View style={[styles.expertiseBadge, { backgroundColor: item.expertise === 'Expert' ? '#10B981' : '#9CA3AF' }]}>
              <ThemedText style={styles.expertiseText}>{item.expertise}</ThemedText>
            </View>
          </View>
          <ThemedText style={styles.professionText}>{item.profession}</ThemedText>
          <View style={styles.ratingRow}>
            <Star size={12} color="#F59E0B" fill="#F59E0B" />
            <ThemedText style={styles.ratingText}>
              {item.rating > 0 ? item.rating.toFixed(1) : 'New'}
            </ThemedText>
            {item.jobsCompleted > 0 && (
              <>
                <Briefcase size={11} color="#9CA3AF" />
                <ThemedText style={styles.jobsText}>{item.jobsCompleted} jobs</ThemedText>
              </>
            )}
          </View>
        </View>
      </TouchableOpacity>

      <View style={styles.statsContainer}>
        {/* "Match Score" — a compatibility/HCI score, distinct from the
            review-based Skill-O-Meter below. Used to share the same
            "Skill-O-Meter" name as that, which made them look like the same
            metric when they measure completely different things. */}
        <View style={styles.skillMeterRow}>
          <ThemedText style={styles.skillLabel}>Match Score:</ThemedText>
          <ThemedText style={styles.skillValue}>{item.skillMatch}%</ThemedText>
        </View>
        <View style={styles.progressBarBackground}>
          <View style={[styles.progressBarActive, { width: `${item.skillMatch}%` }]} />
        </View>

        {/* The real Skill-O-Meter — same review-derived Skill Quality /
            Timeliness figures shown on the provider's own profile, so a
            customer comparing applicants sees the same trust signal the
            provider sees about themselves. */}
        {(item.reviewCount ?? 0) > 0 && (
          <View style={styles.skillOMeterRow}>
            {item.avgSkillRating != null && (
              <View style={[styles.meterTag, { backgroundColor: item.avgSkillRating >= 4.0 ? '#FFFBEB' : '#F9FAFB' }]}>
                <CheckCircle2 size={12} color={item.avgSkillRating >= 4.0 ? '#D97706' : '#9CA3AF'} />
                <ThemedText style={[styles.meterTagText, { color: item.avgSkillRating >= 4.0 ? '#D97706' : '#9CA3AF' }]}>
                  Skill Quality {item.avgSkillRating.toFixed(1)}★
                </ThemedText>
              </View>
            )}
            {item.avgPunctualityRating != null && (
              <View style={[styles.meterTag, { backgroundColor: item.avgPunctualityRating >= 4.0 ? '#F0FDF4' : '#F9FAFB' }]}>
                <CheckCircle2 size={12} color={item.avgPunctualityRating >= 4.0 ? '#16A34A' : '#9CA3AF'} />
                <ThemedText style={[styles.meterTagText, { color: item.avgPunctualityRating >= 4.0 ? '#16A34A' : '#9CA3AF' }]}>
                  Timeliness {item.avgPunctualityRating.toFixed(1)}★
                </ThemedText>
              </View>
            )}
            {item.avgBehaviourRating != null && (
              <View style={[styles.meterTag, { backgroundColor: item.avgBehaviourRating >= 4.0 ? '#EFF6FF' : '#F9FAFB' }]}>
                <CheckCircle2 size={12} color={item.avgBehaviourRating >= 4.0 ? '#3B82F6' : '#9CA3AF'} />
                <ThemedText style={[styles.meterTagText, { color: item.avgBehaviourRating >= 4.0 ? '#3B82F6' : '#9CA3AF' }]}>
                  Behaviour {item.avgBehaviourRating.toFixed(1)}★
                </ThemedText>
              </View>
            )}
            {item.avgCommunicationRating != null && (
              <View style={[styles.meterTag, { backgroundColor: item.avgCommunicationRating >= 4.0 ? '#FDF4FF' : '#F9FAFB' }]}>
                <CheckCircle2 size={12} color={item.avgCommunicationRating >= 4.0 ? '#A855F7' : '#9CA3AF'} />
                <ThemedText style={[styles.meterTagText, { color: item.avgCommunicationRating >= 4.0 ? '#A855F7' : '#9CA3AF' }]}>
                  Communication {item.avgCommunicationRating.toFixed(1)}★
                </ThemedText>
              </View>
            )}
          </View>
        )}

        <View style={styles.detailsGrid}>
          <View style={styles.detailItem}>
            <View style={styles.iconTextRow}>
              <MapPin size={14} color="#6B7280" />
              <ThemedText style={styles.detailText}>{item.distance}</ThemedText>
            </View>
            <View style={[styles.iconTextRow, styles.highlightedScore]}>
              <Award size={14} color="#F59E0B" />
              <ThemedText style={styles.highlightedScoreText}>Match Score: {item.skillMatch}%</ThemedText>
            </View>
          </View>
        </View>
        {/* No quoted price here — bidding is retired. The real price is set
            by the provider's invoice after they inspect the job in person. */}
      </View>

      <View style={styles.buttonRow}>
        {isHired ? (
          <TouchableOpacity
            style={styles.callButton}
            onPress={() => router.push({ pathname: '/track-provider', params: { jobId: jobId ?? '' } })}
          >
            <MapPin size={18} color="#fff" />
            <ThemedText style={styles.callButtonText}>Track Provider</ThemedText>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity style={styles.hireButton} onPress={onHire} disabled={isHiring}>
              {isHiring ? <ActivityIndicator size="small" color="#fff" /> : <ThemedText style={styles.hireButtonText}>Hire</ThemedText>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.rejectButton} onPress={onReject} disabled={isHiring}>
              <ThemedText style={styles.rejectButtonText}>Reject</ThemedText>
            </TouchableOpacity>
          </>
        )}
      </View>
    </Animated.View>
  );
}
function mapApiApplicant(a: any): Applicant & { applicationId: string; providerId: string } {
  const name = a.provider_name ?? a.name ?? 'Provider';
  const hci = a.hci_score ?? 70;
  return {
    id: a.application_id,
    applicationId: a.application_id,
    providerId: a.provider_id,
    name,
    profileImage: a.provider_image ?? a.profile_image_url
      ?? `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=FFCE48&color=000`,
    profession: a.profession ?? 'Service Provider',
    expertise: hci >= 80 ? 'Expert' : hci >= 50 ? 'Intermediate' : 'Beginner',
    distance: a.distance_km ? `${kmToMiles(Number(a.distance_km)).toFixed(1)} mi away` : 'Nearby',
    skillMatch: Math.min(100, Math.round(hci)),
    rating: a.avg_rating ?? 0,
    jobsCompleted: a.jobs_completed ?? 0,
    about: a.bio ?? 'Experienced professional ready to help.',
    skills: [],
    reviews: [],
    workProof: [],
    badges: [],
    avgSkillRating: a.avg_skill_rating ?? null,
    avgPunctualityRating: a.avg_punctuality_rating ?? null,
    avgBehaviourRating: a.avg_behaviour_rating ?? null,
    avgCommunicationRating: a.avg_communication_rating ?? null,
    reviewCount: a.review_count ?? 0,
  } as any;
}

export default function ApplicantsScreen() {
  const { jobId } = useLocalSearchParams<{ jobId?: string }>();
  const appAlert = useAppAlert();
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const insets = useSafeAreaInsets();
  const { hireApplicant, payInspectionFee } = useHirePayment();
  const [applicants, setApplicants] = useState<(Applicant & { applicationId?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [hiredIds, setHiredIds] = useState<string[]>([]);
  const [hiringId, setHiringId] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [lastHiredName, setLastHiredName] = useState('');
  const [feeStatusMessage, setFeeStatusMessage] = useState('');

  const [loadError, setLoadError] = useState(false);
  // Distinguishes "the job is permanently gone/inaccessible" (404/403 — a
  // stale notification tap landing here after the job expired, got deleted,
  // or was never this customer's) from a transient fetch failure. The old
  // single loadError state showed "pull down to retry" for both, which is
  // actively misleading for the permanent case — retrying can never work.
  const [jobGone, setJobGone] = useState(false);
  // Job loaded fine (not gone/404) but is already in a terminal status —
  // a stale notification tap can land here after the job completed or got
  // cancelled elsewhere. Distinct from jobGone: the applicants themselves
  // are still real, just no longer actionable (hiring would 400).
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);

  const TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED', 'DISPUTED', 'EXPIRED'];
  // A stale "new applicant" notification is just as likely to land here
  // AFTER a provider was already hired (from this same screen, or via
  // "Hire Using AI", or a direct request) as after the job fully ended —
  // these weren't "terminal" in the completed/cancelled sense, so the old
  // check let the stale applicant list render as if still open, and tapping
  // Hire threw a raw backend error instead of a clear "already hired" message.
  const ALREADY_HIRED_STATUSES = ['ACCEPTED', 'INSPECTING', 'INVOICE_PENDING', 'IN_PROGRESS'];

  const loadApplicants = React.useCallback((isRefresh = false) => {
    if (!jobId) {
      // This used to show DUMMY_APPLICANTS — fake, named mock people — if
      // the screen somehow got opened without a real jobId. Same problem as
      // the fetch-failure case: a real bug (missing navigation param) looked
      // identical to "here are some real applicants".
      setApplicants([]);
      setLoadError(true);
      setLoading(false);
      return;
    }
    setLoadError(false);
    setJobGone(false);
    if (isRefresh) setRefreshing(true);
    // Fetching the full job (not just the old getApplicants wrapper, which
    // discarded everything except .applicants) so the job's own status is
    // available to gate hiring — getApplicants succeeding was never proof
    // the job could still actually be acted on.
    SkoFyApi.jobs.get(jobId)
      .then((job: any) => {
        setJobStatus(job?.status ?? null);
        const data = job?.applicants;
        // A real empty array (genuinely zero applicants yet) or a fetch
        // failure both used to fall back to DUMMY_APPLICANTS — fake, named
        // mock people rendered as if they were real applicants. That meant
        // a transient network failure (or just checking before any bids
        // came in) looked identical to "nobody applied", and a real
        // applicant arriving after a stale fetch would never show up
        // without a fresh navigation, since this only ran once on mount.
        setApplicants(Array.isArray(data)
          ? data.filter((a: any) => a.status !== 'WITHDRAWN').map(mapApiApplicant)
          : []);
      })
      .catch((err) => {
        console.error('Failed to fetch applicants:', err);
        setApplicants([]);
        // NOT_FOUND/FORBIDDEN mean the job is permanently gone or was never
        // this customer's — usually a stale notification tap after the job
        // expired/got deleted. "Pull down to retry" is actively wrong there.
        if (err?.error_code === 'NOT_FOUND' || err?.error_code === 'FORBIDDEN') {
          setJobGone(true);
        } else {
          setLoadError(true);
        }
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [jobId]);

  useFocusEffect(
    React.useCallback(() => {
      loadApplicants();
    }, [loadApplicants])
  );

  const handleHire = async (applicationId: string, name: string) => {
    if (!jobId || !applicationId) {
      // A missing param here means a stale/malformed deep link or notification
      // landed on this screen without what it needs to actually hire — not a
      // real success. Showing the success modal anyway (as this used to)
      // told the customer they'd hired and paid when neither API call ever
      // ran, and the resulting "hired" card linked to Track Provider with an
      // empty job id.
      appAlert.show('error', 'Something Went Wrong', "Couldn't hire this applicant — please go back and try again.");
      return;
    }
    setHiringId(applicationId);
    try {
      const hireResult = await hireApplicant(jobId, applicationId);
      if (hireResult.status !== 'success') {
        if (hireResult.status === 'error') appAlert.show('error', 'Hire Failed', hireResult.message);
        return;
      }
      // Hiring itself has no payment step anymore (bidding is retired) — pay
      // the inspection fee right away, on the same screen, so the provider
      // can be asked for the inspection OTP as soon as they arrive. Folded
      // into the same success modal below rather than a competing alert —
      // silently succeeding with zero feedback looked indistinguishable from
      // nothing having happened at all.
      const feeResult = await payInspectionFee(jobId);
      if (feeResult.status === 'pending') {
        // Charged, just slow to confirm — "failed" would be actively wrong
        // here and could push the customer into an unnecessary retry.
        setFeeStatusMessage(feeResult.message);
      } else if (feeResult.status === 'error') {
        setFeeStatusMessage(`Visiting fee payment failed: ${feeResult.message}`);
        // Hire already succeeded — don't leave the customer thinking it
        // didn't happen just because the fee payment needs a retry.
      } else if (feeResult.status === 'cancelled') {
        setFeeStatusMessage("You'll need to pay the visiting fee from the Track Provider screen before the provider can start inspecting.");
      } else if (feeResult.charged) {
        setFeeStatusMessage(`$${feeResult.amount.toFixed(2)} visiting fee charged and held in escrow.`);
      } else {
        setFeeStatusMessage('This provider has no visiting fee.');
      }
      setHiredIds(prev => [...prev, applicationId]);
      setLastHiredName(name);
      setShowSuccessModal(true);
    } finally {
      setHiringId(null);
    }
  };

  const handleReject = async (applicationId: string) => {
    if (!jobId || !applicationId) return;
    try {
      await SkoFyApi.jobs.rejectApplicant(jobId, applicationId);
      setApplicants(prev => prev.filter(a => (a as any).applicationId !== applicationId));
    } catch (err: any) {
      appAlert.show('error', 'Reject Failed', err?.message ?? 'Failed to reject applicant.');
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={24} color="#000" />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Image
            source={require('@/assets/images/logo-mark.png')}
            style={styles.logo}
            contentFit="contain"
          />
          <ThemedText style={styles.headerTitle}>Applicants</ThemedText>
        </View>

        {jobId && !jobGone && !(jobStatus && (TERMINAL_STATUSES.includes(jobStatus) || ALREADY_HIRED_STATUSES.includes(jobStatus))) ? (
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.push({ pathname: '/edit-job', params: { jobId } })}>
              <Pencil size={20} color="#6B7280" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.backButton} onPress={() => setShowCancelModal(true)}>
              <XCircle size={22} color="#EF4444" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#FFCE48" />
        </View>
      ) : jobGone ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, gap: 16 }}>
          <ThemedText style={{ fontSize: 16, color: '#6B7280', textAlign: 'center' }}>
            This job is no longer available — it may have expired, been cancelled, or already been closed out.
          </ThemedText>
          <TouchableOpacity
            style={{ backgroundColor: '#FFCE48', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 }}
            onPress={() => router.replace('/my-jobs' as any)}
          >
            <ThemedText style={{ fontWeight: '700', color: '#111827' }}>Go to My Jobs</ThemedText>
          </TouchableOpacity>
        </View>
      ) : jobStatus && TERMINAL_STATUSES.includes(jobStatus) ? (
        // Job loaded fine and these applicants are real — but the job itself
        // is already closed (completed/cancelled/disputed/expired), so
        // hiring is impossible. A stale notification tap is the usual way
        // to land here; showing the normal actionable list would just let
        // you tap Hire and get a "Hire Failed" error after the fact.
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, gap: 16 }}>
          <ThemedText style={{ fontSize: 16, color: '#6B7280', textAlign: 'center' }}>
            {jobStatus === 'COMPLETED'
              ? 'This job is already completed.'
              : jobStatus === 'CANCELLED'
              ? 'This job was cancelled.'
              : jobStatus === 'DISPUTED'
              ? 'This job is under dispute review.'
              : 'This job has expired.'}
          </ThemedText>
          <TouchableOpacity
            style={{ backgroundColor: '#FFCE48', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 }}
            onPress={() => router.replace('/my-jobs' as any)}
          >
            <ThemedText style={{ fontWeight: '700', color: '#111827' }}>Go to My Jobs</ThemedText>
          </TouchableOpacity>
        </View>
      ) : jobStatus && ALREADY_HIRED_STATUSES.includes(jobStatus) ? (
        // Someone was already hired for this job (from this exact screen
        // earlier, "Hire Using AI", or a direct request) — the applicant
        // list here is now stale by definition, so show that plainly instead
        // of a tappable list that can only ever fail.
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, gap: 16 }}>
          <ThemedText style={{ fontSize: 16, color: '#6B7280', textAlign: 'center' }}>
            You've already hired a provider for this job.
          </ThemedText>
          <TouchableOpacity
            style={{ backgroundColor: '#FFCE48', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 }}
            onPress={() => router.replace({ pathname: '/track-provider', params: { jobId: jobId ?? '' } } as any)}
          >
            <ThemedText style={{ fontWeight: '700', color: '#111827' }}>Track Provider</ThemedText>
          </TouchableOpacity>
        </View>
      ) : (
      <FlatList
        data={applicants}
        renderItem={({ item, index }) => (
          <ApplicantCard
            item={item}
            index={index}
            isHired={hiredIds.includes(item.id)}
            isHiring={hiringId === ((item as any).applicationId ?? item.id)}
            jobId={jobId}
            onHire={() => handleHire((item as any).applicationId ?? item.id, item.name)}
            onReject={() => handleReject((item as any).applicationId ?? item.id)}
          />
        )}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => loadApplicants(true)} colors={['#FFCE48']} tintColor="#FFCE48" />
        }
        ListEmptyComponent={
          <View style={{ padding: 40, alignItems: 'center' }}>
            <ThemedText style={{ color: loadError ? '#EF4444' : '#9CA3AF', fontSize: 16 }}>
              {loadError ? "Couldn't load applicants — pull down to retry." : 'No applicants yet.'}
            </ThemedText>
          </View>
        }
      />
      )}

      <View style={[styles.bottomActions, { bottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 40 : 20) + 12 }]}>
        <TouchableOpacity style={styles.aiButton}>
          <View style={styles.aiIconContainer}>
            <Sparkles size={16} color="#000" />
          </View>
          <ThemedText style={styles.aiButtonText}>Hire Using AI</ThemedText>
        </TouchableOpacity>
      </View>

      {/* Success Modal */}
      <Modal
        visible={showSuccessModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSuccessModal(false)}
      >
        <View style={styles.modalOverlay}>
          <Animated.View
            entering={FadeInDown.springify()}
            style={styles.successCard}
          >
            <View style={styles.successIconContainer}>
              <CheckCircle2 size={50} color="#10B981" />
            </View>
            <ThemedText style={styles.successTitle}>Hired Successfully!</ThemedText>
            <ThemedText style={styles.successSubtitle}>
              You have hired {lastHiredName} for your requirement.
            </ThemedText>
            {!!feeStatusMessage && (
              <ThemedText style={[styles.successSubtitle, { marginTop: 4, fontSize: 13, color: '#6B7280' }]}>
                {feeStatusMessage}
              </ThemedText>
            )}
            <TouchableOpacity
              style={styles.successButton}
              onPress={() => setShowSuccessModal(false)}
            >
              <ThemedText style={styles.successButtonText}>Got it</ThemedText>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>
      {jobId && (
        <CancelJobModal
          visible={showCancelModal}
          jobId={jobId}
          onClose={() => setShowCancelModal(false)}
          onCancelled={(message) => {
            setShowCancelModal(false);
            const reopened = message.toLowerCase().includes('other applicant');
            appAlert.show(
              reopened ? 'success' : 'warning',
              reopened ? 'Other Applicants Available' : 'Job Cancelled',
              message,
              [{ text: 'OK', onPress: () => router.back() }],
            );
          }}
        />
      )}
      {appAlert.element}
    </ThemedView>
  );
}

function makeStyles(t: typeof Colors.light) { return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.inputFilled,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 20,
    backgroundColor: t.card,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logo: {
    width: 28,
    height: 28,
  },
  headerTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontFamily: Fonts.poppinsBold,
    color: '#000',
  },
  headerSpacer: {
    width: 40,
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  card: {
    backgroundColor: t.card,
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  profileImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: t.inputFilled,
  },
  headerInfo: {
    flex: 1,
    marginLeft: 16,
  },
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  nameText: {
    fontSize: 18,
    lineHeight: 24,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  expertiseBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  expertiseText: {
    color: '#fff',
    fontSize: 11,
    lineHeight: 17,
    fontFamily: Fonts.poppinsBold,
  },
  professionText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
    marginTop: 2,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  ratingText: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: Fonts.poppinsSemiBold,
    color: '#F59E0B',
  },
  jobsText: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: Fonts.poppins,
    color: '#9CA3AF',
  },
  statsContainer: {
    marginBottom: 20,
  },
  skillMeterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  skillLabel: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textPrimary,
  },
  skillValue: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textSecondary,
  },
  progressBarBackground: {
    height: 6,
    backgroundColor: t.inputFilled,
    borderRadius: 3,
    marginBottom: 16,
  },
  progressBarActive: {
    height: '100%',
    backgroundColor: '#FFCE48',
    borderRadius: 3,
  },
  skillOMeterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  meterTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 4,
    borderWidth: 0.5,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  meterTagText: {
    fontSize: 11,
    lineHeight: 17,
    fontFamily: Fonts.poppinsSemiBold,
  },
  detailsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  detailItem: {
    gap: 6,
  },
  iconTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailText: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textSecondary,
  },
  highlightedScore: {
    backgroundColor: '#FFF9E6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FEF3C7',
  },
  highlightedScoreText: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: Fonts.poppinsBold,
    color: '#D97706',
  },
  priceItem: {
    alignItems: 'flex-end',
  },
  priceValue: {
    fontSize: 20,
    lineHeight: 26,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  priceLabel: {
    fontSize: 11,
    lineHeight: 17,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  hireButton: {
    flex: 1,
    height: 48,
    backgroundColor: '#FFCE48',
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hireButtonText: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: Fonts.poppinsBold,
    color: '#000',
  },
  rejectButton: {
    flex: 1,
    height: 48,
    backgroundColor: t.card,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: t.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rejectButtonText: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  chatButton: {
    flex: 1,
    height: 48,
    backgroundColor: t.card,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: t.border,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  chatButtonText: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: Fonts.poppinsBold,
    color: '#000',
  },
  callButton: {
    flex: 1,
    height: 48,
    backgroundColor: t.textPrimary,
    borderRadius: 24,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  callButtonText: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: Fonts.poppinsBold,
    color: '#fff',
  },
  bottomActions: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 40 : 20,
    left: 20,
    right: 20,
  },
  aiButton: {
    height: 60,
    backgroundColor: '#FFCE48',
    borderRadius: 30,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#FFCE48',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  aiIconContainer: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  aiButtonText: {
    fontSize: 18,
    lineHeight: 24,
    fontFamily: Fonts.poppinsBold,
    color: '#000',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  successCard: {
    backgroundColor: t.modalBackground,
    borderRadius: 32,
    padding: 30,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
  },
  successIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#F0FDF4',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  successTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    textAlign: 'center',
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 14,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  successButton: {
    backgroundColor: t.textPrimary,
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 20,
    width: '100%',
  },
  successButtonText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 22,
    fontFamily: Fonts.poppinsBold,
    textAlign: 'center',
  },
}); }
