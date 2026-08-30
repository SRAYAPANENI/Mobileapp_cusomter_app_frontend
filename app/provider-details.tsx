import { useAppAlert } from '@/components/app-alert';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SkoFyApi } from '@/services/api';
import { useHirePayment } from '@/hooks/use-hire-payment';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Video, ResizeMode } from 'expo-av';
import {
  Award,
  ChevronLeft,
  Clock,
  Layers,
  MapPin,
  Play,
  ShieldCheck,
  Star,
  Trophy,
  X,
  Maximize2,
  CheckCircle2
} from 'lucide-react-native';
import React, { useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  Modal,
} from 'react-native';
import Animated, {
  FadeInDown,
  FadeInUp,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');

type WorkProofItem = { id: string; type: 'image' | 'video'; url: string; thumbnail: string; skill: string };
type ReviewItem = {
  id: string;
  customer: string;
  date: string;
  rating: number;
  comment: string | null;
  metrics: { skill: number; punctuality: number; behaviour: number; communication: number };
};
type JobHistoryItem = {
  job_id: string;
  title: string;
  status: string;
  created_at: string | null;
  overall_rating: number | null;
  skill_rating: number | null;
  punctuality_rating: number | null;
  behaviour_rating: number | null;
  communication_rating: number | null;
  review_comment: string | null;
};

function formatMemberSince(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export default function ProviderDetailsScreen() {
  const { id, providerId, jobId, skillMatch, distance, inspectionFee, viewOnly } = useLocalSearchParams<{
    id: string; providerId?: string; jobId?: string; skillMatch?: string; distance?: string; inspectionFee?: string; viewOnly?: string;
  }>();
  const isViewOnly = viewOnly === 'true';
  const appAlert = useAppAlert();
  const { hireApplicant, payInspectionFee } = useHirePayment();

  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<'About' | 'Work Proof' | 'Reviews'>('About');
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [feeStatusMessage, setFeeStatusMessage] = useState('');
  const [hiring, setHiring] = useState(false);

  const [profile, setProfile] = useState<any>(null);
  const [workProof, setWorkProof] = useState<WorkProofItem[]>([]);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [jobHistory, setJobHistory] = useState<JobHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // The job's real inspection_fee — bidding is retired, so there's no
  // "quoted price" from this provider anymore, only the (often $0)
  // inspection fee set when the job was posted. Fetched from the job
  // itself rather than trusted from a nav param.
  const [jobInspectionFee, setJobInspectionFee] = useState<number | null>(null);
  // A stale notification/cached list can land here for a job that's already
  // moved on elsewhere (hired someone else, cancelled, completed) — jobData
  // was already being fetched just for inspection_fee below, but its status
  // was never checked, so Hire stayed tappable and threw a raw backend error
  // instead of a clear message. Same fix as applicants.tsx.
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const NOT_HIREABLE_STATUSES = ['COMPLETED', 'CANCELLED', 'DISPUTED', 'EXPIRED', 'ACCEPTED', 'INSPECTING', 'INVOICE_PENDING', 'IN_PROGRESS'];

  useEffect(() => {
    if (!providerId) {
      setLoading(false);
      setLoadError(true);
      return;
    }
    (async () => {
      try {
        const [profileData, docsData, reviewsData, historyData, jobData] = await Promise.all([
          SkoFyApi.providers.getDetail(providerId),
          // No doc_type filter — providers upload work proof under either
          // WORK_PROOF or SKILL_PROOF depending on which screen they used,
          // and customers should see all of it. The backend already
          // excludes ID_PROOF regardless of what's passed here.
          SkoFyApi.providers.getDocuments(providerId),
          SkoFyApi.providers.getReviews(providerId),
          SkoFyApi.providers.getHistory(providerId).catch(() => []),
          jobId ? SkoFyApi.jobs.get(jobId).catch(() => null) : Promise.resolve(null),
        ]);
        setProfile(profileData);
        setJobInspectionFee((jobData as any)?.inspection_fee ?? null);
        setJobStatus((jobData as any)?.status ?? null);
        setWorkProof((Array.isArray(docsData) ? docsData : []).map((d: any) => ({
          id: d.id,
          type: d.media_type === 'VIDEO' ? 'video' : 'image',
          url: d.media_url,
          thumbnail: d.media_url,
          skill: d.skill_name ?? 'Work',
        })));
        setReviews((Array.isArray(reviewsData) ? reviewsData : []).map((r: any) => ({
          id: r.id,
          customer: r.customer_name,
          date: formatMemberSince(r.created_at),
          rating: Math.round(r.overall_rating),
          comment: r.comment,
          metrics: {
            skill: r.skill_rating,
            punctuality: r.punctuality_rating,
            behaviour: r.behaviour_rating,
            communication: r.communication_rating,
          },
        })));
        setJobHistory((Array.isArray(historyData) ? historyData : []).map((h: any) => ({
          job_id: h.job_id,
          title: h.title,
          status: h.status,
          created_at: h.created_at ?? null,
          overall_rating: h.overall_rating ?? null,
          skill_rating: h.skill_rating ?? null,
          punctuality_rating: h.punctuality_rating ?? null,
          behaviour_rating: h.behaviour_rating ?? null,
          communication_rating: h.communication_rating ?? null,
          review_comment: h.review_comment ?? null,
        })));
      } catch {
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [providerId, jobId]);

  // Media Viewer State
  const [viewerVisible, setViewerVisible] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<WorkProofItem | null>(null);
  const videoRef = useRef<Video>(null);

  const openMedia = (item: WorkProofItem) => {
    setSelectedMedia(item);
    setViewerVisible(true);
  };

  const closeMedia = () => {
    setViewerVisible(false);
    setSelectedMedia(null);
  };

  const handleHire = async () => {
    if (!jobId || !id) {
      appAlert.show('error', 'Cannot Hire', 'Missing job or application reference.');
      return;
    }
    // Defense in depth — the footer button is already hidden for these
    // statuses, but guard the action itself too in case of a stale render.
    if (jobStatus && NOT_HIREABLE_STATUSES.includes(jobStatus)) {
      appAlert.show('error', 'Cannot Hire', 'This job is no longer open for hiring.');
      return;
    }
    setHiring(true);
    try {
      const hireResult = await hireApplicant(jobId, id);
      if (hireResult.status !== 'success') {
        if (hireResult.status === 'error') appAlert.show('error', 'Hire Failed', hireResult.message);
        return;
      }
      // Hiring itself has no payment step anymore (bidding is retired) — pay
      // the inspection fee right away, on the same screen. Folded into the
      // same success modal below rather than a competing alert — silently
      // succeeding with zero feedback looked indistinguishable from nothing
      // having happened at all.
      const feeResult = await payInspectionFee(jobId);
      if (feeResult.status === 'error') {
        setFeeStatusMessage(`Inspection fee payment failed: ${feeResult.message}`);
        // Hire already succeeded — don't leave the customer thinking it
        // didn't happen just because the fee payment needs a retry.
      } else if (feeResult.status === 'cancelled') {
        setFeeStatusMessage("You'll need to pay the inspection fee from the Track Provider screen before the provider can start inspecting.");
      } else if (feeResult.charged) {
        setFeeStatusMessage(`$${feeResult.amount.toFixed(2)} inspection fee charged and held in escrow.`);
      } else {
        setFeeStatusMessage('This job has no inspection fee.');
      }
      setShowSuccessModal(true);
    } finally {
      setHiring(false);
    }
  };

  if (loading) {
    return (
      <ThemedView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={themeColors.brand} />
      </ThemedView>
    );
  }

  if (loadError || !profile) {
    return (
      <ThemedView style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
        <ThemedText style={{ fontFamily: Fonts.poppinsSemiBold, fontSize: 16, color: themeColors.textPrimary, marginBottom: 16, textAlign: 'center' }}>
          Couldn't load this provider's profile.
        </ThemedText>
        <TouchableOpacity onPress={() => router.back()} style={styles.hireButton}>
          <ThemedText style={styles.hireButtonText}>Go Back</ThemedText>
        </TouchableOpacity>
      </ThemedView>
    );
  }

  const PROVIDER_DATA = {
    name: profile.name,
    profession: profile.skills?.[0] ?? 'Service Provider',
    profileImage: profile.profile_image_url
      ?? `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.name)}&background=FFCE48&color=000`,
    rating: profile.avg_rating ?? 0,
    jobsCompleted: profile.jobs_completed ?? 0,
    memberSince: formatMemberSince(profile.member_since),
    skillMatch: skillMatch ? Math.round(Number(skillMatch)) : Math.round(profile.hci_score ?? 0),
    distance: distance ?? 'Nearby',
    about: profile.bio ?? 'No bio provided yet.',
    skills: profile.skills ?? [],
    // Real inspection_fee from the job itself — there's no per-provider
    // "quoted price" anymore (bidding is retired); the actual job cost is
    // only ever set by their invoice after they inspect the job in person.
    inspectionFee: jobInspectionFee ?? 0,
  };

  return (
    <ThemedView style={styles.container}>
      {/* Media Viewer Modal */}
      <Modal visible={viewerVisible} transparent animationType="fade" onRequestClose={closeMedia}>
        <View style={styles.viewerContainer}>
          <TouchableOpacity style={styles.closeViewer} onPress={closeMedia}>
            <X size={30} color="#fff" />
          </TouchableOpacity>

          {selectedMedia?.type === 'image' ? (
            <Image
              source={{ uri: selectedMedia.url }}
              style={styles.fullMedia}
              contentFit="contain"
            />
          ) : (
            <Video
              ref={videoRef}
              source={{ uri: selectedMedia?.url || '' }}
              style={styles.fullMedia}
              useNativeControls
              resizeMode={ResizeMode.CONTAIN}
              isLooping
              shouldPlay
            />
          )}

          <View style={styles.viewerFooter}>
            <View style={styles.viewerTag}>
              <Layers size={14} color="#FFCE48" />
              <ThemedText style={styles.viewerTagText}>{selectedMedia?.skill}</ThemedText>
            </View>
          </View>
        </View>
      </Modal>

      {/* Header with Overlay */}
      <View style={styles.header}>
        <Image
          source={{ uri: PROVIDER_DATA.profileImage }}
          style={styles.headerBackground}
          contentFit="cover"
        />
        <View style={styles.overlay} />

        <View style={styles.headerTop}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ChevronLeft size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.profileInfo}>
          <Animated.View entering={FadeInUp.delay(200)}>
            <ThemedText style={styles.nameText}>{PROVIDER_DATA.name}</ThemedText>
            <ThemedText style={styles.professionText}>{PROVIDER_DATA.profession}</ThemedText>
            <View style={styles.ratingRow}>
              <Star size={16} color="#FFCE48" fill="#FFCE48" />
              <ThemedText style={styles.ratingText}>{PROVIDER_DATA.rating} ({PROVIDER_DATA.jobsCompleted} Jobs)</ThemedText>
              <View style={styles.verifiedBadge}>
                <ShieldCheck size={14} color="#34D399" />
                <ThemedText style={styles.verifiedText}>Verified</ThemedText>
              </View>
            </View>
          </Animated.View>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Quick Stats */}
        <Animated.View entering={FadeInUp.delay(300)} style={styles.statsRow}>
          <View style={styles.statItem}>
            <Trophy size={18} color="#FFCE48" />
            <ThemedText style={styles.statValue}>{PROVIDER_DATA.memberSince}</ThemedText>
            <ThemedText style={styles.statLabel}>Member since</ThemedText>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Award size={18} color="#FFCE48" />
            <ThemedText style={styles.statValue}>{PROVIDER_DATA.skillMatch}%</ThemedText>
            <ThemedText style={styles.statLabel}>HCI Meter</ThemedText>
            <ThemedText style={[styles.statLabel, { fontSize: 9 }]}>Human Capital Index</ThemedText>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <MapPin size={18} color="#FFCE48" />
            <ThemedText style={styles.statValue}>{PROVIDER_DATA.distance}</ThemedText>
            <ThemedText style={styles.statLabel}>Away</ThemedText>
          </View>
        </Animated.View>

        {/* Tabs */}
        <View style={styles.tabsContainer}>
          {['About', 'Work Proof', 'Reviews'].map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.activeTab]}
              onPress={() => setActiveTab(tab as any)}
            >
              <ThemedText style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
                {tab}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tab Content */}
        <View style={styles.tabContent}>
          {activeTab === 'About' && (
            <Animated.View entering={FadeInDown}>
              <ThemedText style={styles.sectionTitle}>About</ThemedText>
              <ThemedText style={styles.descriptionText}>{PROVIDER_DATA.about}</ThemedText>

              <ThemedText style={[styles.sectionTitle, { marginTop: 20 }]}>Skills</ThemedText>
              <View style={styles.skillsGrid}>
                {PROVIDER_DATA.skills.map(skill => (
                  <View key={skill} style={styles.skillBadge}>
                    <ThemedText style={styles.skillText}>{skill}</ThemedText>
                  </View>
                ))}
              </View>

              <ThemedText style={[styles.sectionTitle, { marginTop: 20 }]}>Pricing</ThemedText>
              <View style={styles.priceCard}>
                <View>
                  <ThemedText style={styles.priceValue}>$ {PROVIDER_DATA.inspectionFee}</ThemedText>
                  <ThemedText style={styles.priceLabel}>Inspection Fee</ThemedText>
                </View>
                <Clock size={24} color="#9CA3AF" />
              </View>
            </Animated.View>
          )}

          {activeTab === 'Work Proof' && (
            <Animated.View entering={FadeInDown} style={workProof.length ? styles.mediaGrid : undefined}>
              {workProof.length === 0 && (
                <ThemedText style={{ color: themeColors.textSecondary, fontSize: 13, fontFamily: Fonts.poppins, textAlign: 'center', paddingVertical: 20 }}>
                  No work proof added yet.
                </ThemedText>
              )}
              {workProof.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.mediaItem}
                  onPress={() => openMedia(item)}
                  activeOpacity={0.9}
                >
                  <Image
                    source={{ uri: item.type === 'video' ? item.thumbnail : item.url }}
                    style={styles.mediaImage}
                    contentFit="cover"
                  />
                  {/* Skill Tag on top of media */}
                  <View style={styles.mediaSkillTag}>
                    <ThemedText style={styles.mediaSkillText}>{item.skill}</ThemedText>
                  </View>

                  {item.type === 'video' ? (
                    <View style={styles.videoOverlay}>
                      <View style={styles.playCircle}>
                        <Play size={20} color="#fff" fill="#fff" />
                      </View>
                    </View>
                  ) : (
                    <View style={styles.imageOverlay}>
                      <Maximize2 size={16} color="#fff" />
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </Animated.View>
          )}

          {activeTab === 'Reviews' && (
            <Animated.View entering={FadeInDown}>
              {reviews.length === 0 && jobHistory.length === 0 && (
                <ThemedText style={{ color: themeColors.textSecondary, fontSize: 13, fontFamily: Fonts.poppins, textAlign: 'center', paddingVertical: 20 }}>
                  No reviews yet.
                </ThemedText>
              )}
              {reviews.map(review => (
                <View key={review.id} style={styles.reviewCard}>
                  <View style={styles.reviewHeader}>
                    <ThemedText style={styles.customerName}>{review.customer}</ThemedText>
                    <ThemedText style={styles.reviewDate}>{review.date}</ThemedText>
                  </View>
                  <View style={styles.starsRow}>
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} size={12} color={i < review.rating ? '#FFCE48' : '#D1D5DB'} fill={i < review.rating ? '#FFCE48' : 'none'} />
                    ))}
                  </View>
                  {review.comment && (
                    <ThemedText style={styles.reviewComment}>"{review.comment}"</ThemedText>
                  )}
                  <View style={styles.metricsGrid}>
                    {([
                      { label: 'Skill', value: review.metrics.skill },
                      { label: 'Punctuality', value: review.metrics.punctuality },
                      { label: 'Behaviour', value: review.metrics.behaviour },
                      { label: 'Communication', value: review.metrics.communication },
                    ] as const).map(({ label, value }) => (
                      <View key={label} style={styles.metricItem}>
                        <ThemedText style={styles.metricLabel}>{label}</ThemedText>
                        <View style={styles.metricBar}>
                          <View style={[styles.metricFill, { width: `${(value / 5) * 100}%` }]} />
                        </View>
                        <ThemedText style={styles.metricScore}>{value.toFixed(1)}</ThemedText>
                      </View>
                    ))}
                  </View>
                </View>
              ))}

              {jobHistory.length > 0 && (
                <>
                  <ThemedText style={[styles.sectionTitle, { marginTop: reviews.length > 0 ? 24 : 0, marginBottom: 12 }]}>
                    Completed Jobs
                  </ThemedText>
                  {jobHistory.map(job => (
                    <View key={job.job_id} style={styles.historyCard}>
                      <View style={styles.historyTop}>
                        <View style={styles.historyDot} />
                        <View style={{ flex: 1 }}>
                          <ThemedText style={styles.historyTitle} numberOfLines={1}>{job.title}</ThemedText>
                          <ThemedText style={styles.historyDate}>
                            {job.created_at
                              ? new Date(job.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                              : '—'}
                          </ThemedText>
                        </View>
                        {job.overall_rating != null ? (
                          <View style={styles.historyRatingBadge}>
                            <Star size={11} color="#F59E0B" fill="#F59E0B" />
                            <ThemedText style={styles.historyRatingText}>{job.overall_rating.toFixed(1)}</ThemedText>
                          </View>
                        ) : (
                          <View style={styles.historyBadge}>
                            <ThemedText style={styles.historyBadgeText}>Done</ThemedText>
                          </View>
                        )}
                      </View>
                      {job.overall_rating != null && (
                        <View style={styles.historyMetrics}>
                          {([
                            { label: 'Skill', value: job.skill_rating },
                            { label: 'Punctuality', value: job.punctuality_rating },
                            { label: 'Behaviour', value: job.behaviour_rating },
                            { label: 'Communication', value: job.communication_rating },
                          ] as const).filter(m => m.value != null).map(({ label, value }) => (
                            <View key={label} style={styles.metricItem}>
                              <ThemedText style={styles.metricLabel}>{label}</ThemedText>
                              <View style={styles.metricBar}>
                                <View style={[styles.metricFill, { width: `${((value as number) / 5) * 100}%` }]} />
                              </View>
                              <ThemedText style={styles.metricScore}>{(value as number).toFixed(1)}</ThemedText>
                            </View>
                          ))}
                          {job.review_comment ? (
                            <ThemedText style={styles.historyComment}>"{job.review_comment}"</ThemedText>
                          ) : null}
                        </View>
                      )}
                    </View>
                  ))}
                </>
              )}
            </Animated.View>
          )}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Footer Actions — hidden in view-only mode (e.g. checking an
          already-hired provider's profile from the tracking screen) since
          hiring again doesn't make sense there. Also hidden (with an
          explanatory message instead) when the job itself has already moved
          on — hired someone else, cancelled, completed — since a stale
          notification/cached list is the usual way to land here with a
          job that's no longer actually hireable, and tapping Hire would
          otherwise just throw a raw backend error. */}
      {!isViewOnly && jobStatus && NOT_HIREABLE_STATUSES.includes(jobStatus) ? (
        <View style={[styles.footer, { bottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 40 : 20) + 12, paddingTop: 16 }]}>
          <ThemedText style={{ fontSize: 14, color: '#6B7280', textAlign: 'center', marginBottom: 12 }}>
            {['ACCEPTED', 'INSPECTING', 'INVOICE_PENDING', 'IN_PROGRESS'].includes(jobStatus)
              ? "You've already hired a provider for this job."
              : 'This job is no longer open.'}
          </ThemedText>
          <TouchableOpacity
            style={styles.hireButton}
            onPress={() => router.replace(
              ['ACCEPTED', 'INSPECTING', 'INVOICE_PENDING', 'IN_PROGRESS'].includes(jobStatus)
                ? ({ pathname: '/track-provider', params: { jobId: jobId ?? '' } } as any)
                : ('/my-jobs' as any)
            )}
          >
            <ThemedText style={styles.hireButtonText}>
              {['ACCEPTED', 'INSPECTING', 'INVOICE_PENDING', 'IN_PROGRESS'].includes(jobStatus) ? 'Track Provider' : 'Go to My Jobs'}
            </ThemedText>
          </TouchableOpacity>
        </View>
      ) : !isViewOnly && (
        <View style={[styles.footer, { bottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 40 : 20) + 12 }]}>
          <TouchableOpacity style={styles.hireButton} onPress={handleHire} disabled={hiring}>
            <ThemedText style={styles.hireButtonText}>
              {hiring ? 'Hiring...' : `Hire ${PROVIDER_DATA.name.split(' ')[0]}`}
            </ThemedText>
          </TouchableOpacity>
        </View>
      )}

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
              You have hired {PROVIDER_DATA.name} for your requirement.
            </ThemedText>
            {!!feeStatusMessage && (
              <ThemedText style={[styles.successSubtitle, { marginTop: 4, fontSize: 13, color: '#6B7280' }]}>
                {feeStatusMessage}
              </ThemedText>
            )}
            <TouchableOpacity
              style={styles.successButton}
              onPress={() => {
                setShowSuccessModal(false);
                // push, not replace — replacing left track-provider with
                // nothing behind it in the stack, so the hardware back
                // button exited the app instead of returning here.
                router.push({ pathname: '/track-provider', params: { jobId: jobId ?? '' } });
              }}
            >
              <ThemedText style={styles.successButtonText}>Got it</ThemedText>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>
      {appAlert.element}
    </ThemedView>
  );
}

function makeStyles(t: typeof Colors.light) { return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.surface,
  },
  header: {
    height: 300,
    backgroundColor: '#000',
    position: 'relative',
  },
  headerBackground: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 20,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileInfo: {
    position: 'absolute',
    bottom: 30,
    left: 20,
    right: 20,
  },
  nameText: {
    fontSize: 28,
    fontFamily: Fonts.poppinsBold,
    color: '#fff',
  },
  professionText: {
    fontSize: 16,
    fontFamily: Fonts.poppinsSemiBold,
    color: '#E5E7EB',
    marginTop: -4,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 6,
  },
  ratingText: {
    fontSize: 14,
    fontFamily: Fonts.poppinsSemiBold,
    color: '#fff',
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(52, 211, 153, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 4,
    marginLeft: 8,
  },
  verifiedText: {
    fontSize: 10,
    fontFamily: Fonts.poppinsBold,
    color: '#34D399',
  },
  scrollContent: {
    paddingTop: 20,
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: t.card,
    marginHorizontal: 20,
    marginTop: 10,
    borderRadius: 24,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: 16,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    marginTop: 4,
  },
  statLabel: {
    fontSize: 11,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textSecondary,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: t.borderSubtle,
  },
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginTop: 25,
    gap: 12,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.border,
  },
  activeTab: {
    backgroundColor: t.textPrimary,
    borderColor: t.textPrimary,
  },
  tabText: {
    fontSize: 13,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textSecondary,
  },
  activeTabText: {
    color: '#fff',
  },
  tabContent: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    marginBottom: 10,
  },
  descriptionText: {
    fontSize: 14,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
    lineHeight: 22,
  },
  skillsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  skillBadge: {
    backgroundColor: t.inputFilled,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  skillText: {
    fontSize: 12,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textPrimary,
  },
  priceCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: t.card,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.border,
  },
  priceValue: {
    fontSize: 20,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  priceLabel: {
    fontSize: 12,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
  },
  mediaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  mediaItem: {
    width: (width - 52) / 2,
    height: 160,
    borderRadius: 20,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.border,
  },
  mediaImage: {
    width: '100%',
    height: '100%',
  },
  mediaSkillTag: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(17, 24, 39, 0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    zIndex: 2,
  },
  mediaSkillText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: Fonts.poppinsBold,
  },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 206, 72, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  imageOverlay: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Viewer Modal Styles
  viewerContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeViewer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    right: 20,
    zIndex: 10,
    width: 44,
    height: 44,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullMedia: {
    width: width,
    height: width * 1.5,
  },
  viewerFooter: {
    position: 'absolute',
    bottom: 50,
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  viewerTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  viewerTagText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: Fonts.poppinsBold,
  },
  reviewCard: {
    backgroundColor: t.card,
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: t.border,
  },
  reviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  customerName: {
    fontSize: 14,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  reviewDate: {
    fontSize: 11,
    fontFamily: Fonts.poppins,
    color: t.textMuted,
  },
  starsRow: {
    flexDirection: 'row',
    gap: 2,
    marginBottom: 8,
  },
  reviewComment: {
    fontSize: 13,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
    fontStyle: 'italic',
    marginBottom: 12,
  },
  metricsGrid: {
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: t.borderSubtle,
    paddingTop: 12,
  },
  metricItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  metricLabel: {
    fontSize: 11,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textSecondary,
    width: 80,
  },
  metricBar: {
    flex: 1,
    height: 4,
    backgroundColor: t.inputFilled,
    borderRadius: 2,
  },
  metricFill: {
    height: '100%',
    backgroundColor: '#FFCE48',
    borderRadius: 2,
  },
  metricScore: {
    fontSize: 11,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    width: 28,
    textAlign: 'right',
  },
  historyCard: {
    backgroundColor: t.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: t.border,
  },
  historyTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  historyDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#10B981',
  },
  historyTitle: {
    fontSize: 13,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textPrimary,
  },
  historyDate: {
    fontSize: 11,
    fontFamily: Fonts.poppins,
    color: t.textMuted,
    marginTop: 2,
  },
  historyBadge: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  historyBadgeText: {
    fontSize: 11,
    fontFamily: Fonts.poppinsBold,
    color: '#059669',
  },
  historyRatingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FEF3C7',
  },
  historyRatingText: {
    fontSize: 11,
    fontFamily: Fonts.poppinsBold,
    color: '#D97706',
  },
  historyMetrics: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: t.borderSubtle,
    gap: 8,
  },
  historyComment: {
    fontSize: 12,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
    fontStyle: 'italic',
    marginTop: 6,
  },
  footer: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 40 : 20,
    left: 20,
    right: 20,
    flexDirection: 'row',
    gap: 12,
  },
  hireButton: {
    flex: 1,
    height: 60,
    backgroundColor: '#FFCE48',
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FFCE48',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  hireButtonText: {
    fontSize: 16,
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
    fontFamily: Fonts.poppinsBold,
    textAlign: 'center',
  },
}); }
