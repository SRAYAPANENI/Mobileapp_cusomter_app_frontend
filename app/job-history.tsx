import { RatingModal, RatingDimensions } from '@/components/ui/rating-modal';
import { useOfflinePage } from '@/components/offline-gate';
import { NoInternetState } from '@/components/no-internet-state';
import type { OffAppAnswer } from '@/components/off-app-question';
import { TipSheet } from '@/components/tip-sheet';
import { GuaranteeSheet } from '@/components/guarantee-sheet';
import { RepeatBookingSheet } from '@/components/repeat-booking-sheet';
import { useAppAlert } from '@/components/app-alert';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SkoFyApi } from '@/services/api';
import { markRatingSkipped } from '@/services/ratingReminders';
import { router } from 'expo-router';
import {
  Calendar,
  CheckCircle2,
  ChevronLeft,
  DollarSign,
  Gift,
  Repeat,
  ShieldCheck,
  Star,
  User,
  XCircle
} from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, StyleSheet, TouchableOpacity, View, ScrollView } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { padBottom, useBottomInset } from '@/hooks/use-bottom-inset';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { usePagedTabs } from '@/hooks/use-paged-tabs';

// Finished from the customer's side — DISPUTED too, it can still be rated.
const HISTORY_STATUSES = ['COMPLETED', 'DISPUTED', 'CANCELLED'];
const HISTORY_PAGE_SIZE = 20;
const HISTORY_MAX_READ = 100;

interface JobReview {
  skill_rating: number;
  punctuality_rating: number;
  behaviour_rating: number;
  communication_rating: number;
  overall_rating: number;
  comment: string | null;
}

interface CustomerReview {
  overall: number;
  payment: number;
  behaviour: number;
  negotiation: number;
  environment: number;
  comment: string | null;
}

interface JobHistoryItem {
  id: string;
  title: string;
  professional: string;
  date: string;
  price: string;
  /** The agreed quote, if there was one — suggested as a repeat booking's limit. */
  lastPrice: number | null;
  status: 'Completed' | 'Disputed' | 'Cancelled';
  /** As the server sent it (to the microsecond): where the next page starts. */
  createdAt: string;
  review: JobReview | null;           // what customer gave provider
  customer_review: CustomerReview | null; // what provider gave customer
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

const STATUS_COLORS: Record<JobHistoryItem['status'], { bg: string; fg: string }> = {
  Completed: { bg: '#ECFDF5', fg: '#10B981' },
  Disputed: { bg: '#FFFBEB', fg: '#D97706' },
  Cancelled: { bg: '#FEF2F2', fg: '#EF4444' },
};

export default function JobHistoryScreen() {
  const bottomInset = useBottomInset();
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  // Read a page at a time, more on scrolling: this used to be the newest 50
  // jobs of every kind, filtered here — older finished jobs never showed, so
  // they couldn't be rated, tipped, claimed or booked again.
  const feed = usePagedTabs<'history', JobHistoryItem>(async (_, last, limit) => {
    const jobs = await SkoFyApi.jobs.listByStatus(
      HISTORY_STATUSES, limit, last && { created_at: last.createdAt, id: last.id },
    );
    return (Array.isArray(jobs) ? jobs : []).map(toHistoryItem);
  }, HISTORY_PAGE_SIZE, HISTORY_MAX_READ);
  const shown = feed.page('history');
  const history = shown.items;
  const loading = !shown.loaded;
  const loadError = shown.failed;
  // Offline with nothing loaded: the shared page; reloads when back online.
  const offline = useOfflinePage(history.length > 0, () => { void fetchHistory(); });
  const [ratingTarget, setRatingTarget] = useState<{ jobId: string; providerName: string } | null>(null);
  const [tipTarget, setTipTarget] = useState<{ jobId: string; providerName: string } | null>(null);
  const appAlert = useAppAlert();
  const [guaranteeJob, setGuaranteeJob] = useState<string | null>(null);
  const [repeatJob, setRepeatJob] = useState<{ jobId: string; providerName: string; lastPrice: number | null } | null>(null);

  // Read again from the top, as far down as was shown; a failed read keeps
  // what's shown (an empty list says it couldn't load).
  const fetchHistory = useCallback(async (_quiet = false) => {
    await feed.reload('history');
  }, [feed.reload]);

  function toHistoryItem(j: any): JobHistoryItem {
      return ({
        id: j.id,
        title: j.title,
        professional: j.assigned_provider?.name ?? 'No provider assigned',
        date: formatDate(j.updated_at ?? j.created_at),
        price: `$ ${j.inspection_fee ?? 0}`,
        lastPrice: j.invoice?.final_amount ?? null,
        status: j.status === 'COMPLETED' ? 'Completed' : j.status === 'DISPUTED' ? 'Disputed' : 'Cancelled',
        createdAt: j.created_at,
        review: j.review ?? null,
        customer_review: j.customer_review ? {
          overall: j.customer_review.overall_rating,
          payment: j.customer_review.payment_rating,
          behaviour: j.customer_review.behaviour_rating,
          negotiation: j.customer_review.negotiation_rating,
          environment: j.customer_review.environment_rating,
          comment: j.customer_review.comment ?? null,
        } : null,
      });
  }

  useEffect(() => { fetchHistory(); }, [fetchHistory]);
  // Quiet unless the error is showing: then a good reload replaces it.
  const refreshControl = usePullRefresh(() => fetchHistory(!loadError));

  const handleRatingSubmit = async (ratings: RatingDimensions, comment: string, offApp: OffAppAnswer) => {
    if (!ratingTarget) throw new Error('No job selected');
    await SkoFyApi.jobs.submitReview(ratingTarget.jobId, { ...ratings, comment, ...offApp });
    fetchHistory();
  };

  const renderItem = ({ item, index }: { item: JobHistoryItem; index: number }) => (
    <Animated.View
      // Only the first few are staggered: read a page at a time, a card far
      // down would wait seconds to appear.
      entering={FadeInDown.delay(Math.min(index, 5) * 100)}
      style={styles.card}
    >
      <View style={styles.cardHeader}>
        <View style={styles.titleInfo}>
          <ThemedText style={styles.jobTitle}>{item.title}</ThemedText>
          <View style={styles.professionalRow}>
            <User size={14} color="#6B7280" />
            <ThemedText style={styles.professionalName}>{item.professional}</ThemedText>
          </View>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status].bg }]}>
          {item.status === 'Completed' ? (
            <CheckCircle2 size={12} color={STATUS_COLORS[item.status].fg} />
          ) : (
            <XCircle size={12} color={STATUS_COLORS[item.status].fg} />
          )}
          <ThemedText style={[styles.statusText, { color: STATUS_COLORS[item.status].fg }]}>
            {item.status}
          </ThemedText>
        </View>
      </View>

      <View style={styles.infoGrid}>
        <View style={styles.infoItem}>
          <Calendar size={14} color="#6B7280" />
          <ThemedText style={styles.infoText}>{item.date}</ThemedText>
        </View>
        <View style={styles.infoItem}>
          <DollarSign size={14} color="#6B7280" />
          <ThemedText style={styles.infoValue}>{item.price}</ThemedText>
        </View>
      </View>

      {(item.status === 'Completed' || item.status === 'Disputed') && !item.review && (
        <>
          <View style={styles.divider} />
          <TouchableOpacity
            style={styles.rateBtn}
            onPress={() => setRatingTarget({ jobId: item.id, providerName: item.professional })}
            activeOpacity={0.8}
          >
            <Star size={15} color="#111827" />
            <ThemedText style={styles.rateBtnText}>Rate this job</ThemedText>
          </TouchableOpacity>
        </>
      )}

      {item.status === 'Completed' && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={[styles.rateBtn, { flex: 1 }]} onPress={() => setTipTarget({ jobId: item.id, providerName: item.professional })}
            activeOpacity={0.8}>
            <Gift size={15} color="#111827" />
            <ThemedText style={styles.rateBtnText}>Tip</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.rateBtn, { flex: 1 }]} onPress={() => setGuaranteeJob(item.id)} activeOpacity={0.8}>
            <ShieldCheck size={15} color="#111827" />
            <ThemedText style={styles.rateBtnText}>Guarantee</ThemedText>
          </TouchableOpacity>
        </View>
      )}
      {item.status === 'Completed' && (
        <TouchableOpacity style={styles.rateBtn} activeOpacity={0.8}
          onPress={() => setRepeatJob({ jobId: item.id, providerName: item.professional, lastPrice: item.lastPrice })}>
          <Repeat size={15} color="#111827" />
          <ThemedText style={styles.rateBtnText}>Book regularly</ThemedText>
        </TouchableOpacity>
      )}

      {item.review && (
        <>
          <View style={styles.divider} />
          <View style={styles.ratingOverview}>
            <ThemedText style={styles.sectionLabel}>Your Rating</ThemedText>
            <View style={styles.overallRow}>
              <Star size={16} color="#FFCE48" fill="#FFCE48" />
              <ThemedText style={styles.overallNumber}>{item.review.overall_rating.toFixed(1)}</ThemedText>
            </View>
          </View>

          {item.review.comment && (
            <ThemedText style={styles.commentBox}>"{item.review.comment}"</ThemedText>
          )}

          <View style={styles.metricsGrid}>
            <View style={styles.metricCard}>
              <ThemedText style={styles.metricLabel}>Skill</ThemedText>
              <ThemedText style={styles.metricValue}>{item.review.skill_rating}/5</ThemedText>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${(item.review.skill_rating / 5) * 100}%` }]} />
              </View>
            </View>
            <View style={styles.metricCard}>
              <ThemedText style={styles.metricLabel}>Punctuality</ThemedText>
              <ThemedText style={styles.metricValue}>{item.review.punctuality_rating}/5</ThemedText>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${(item.review.punctuality_rating / 5) * 100}%` }]} />
              </View>
            </View>
          </View>
          <View style={[styles.metricsGrid, { marginTop: 8 }]}>
            <View style={styles.metricCard}>
              <ThemedText style={styles.metricLabel}>Behaviour</ThemedText>
              <ThemedText style={styles.metricValue}>{item.review.behaviour_rating}/5</ThemedText>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${(item.review.behaviour_rating / 5) * 100}%` }]} />
              </View>
            </View>
            <View style={styles.metricCard}>
              <ThemedText style={styles.metricLabel}>Communication</ThemedText>
              <ThemedText style={styles.metricValue}>{item.review.communication_rating}/5</ThemedText>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${(item.review.communication_rating / 5) * 100}%` }]} />
              </View>
            </View>
          </View>
        </>
      )}

      {item.customer_review && (
        <>
          <View style={styles.divider} />
          <View style={styles.ratingOverview}>
            <ThemedText style={[styles.sectionLabel, { color: '#6366F1' }]}>Rating from Provider</ThemedText>
            <View style={styles.overallRow}>
              <Star size={16} color="#FFCE48" fill="#FFCE48" />
              <ThemedText style={styles.overallNumber}>{item.customer_review.overall.toFixed(1)}</ThemedText>
            </View>
          </View>

          {item.customer_review.comment && (
            <ThemedText style={[styles.commentBox, { borderLeftWidth: 3, borderLeftColor: '#6366F1' }]}>
              "{item.customer_review.comment}"
            </ThemedText>
          )}

          <View style={styles.metricsGrid}>
            <View style={[styles.metricCard, styles.providerMetricCard]}>
              <ThemedText style={styles.metricLabel}>Payment</ThemedText>
              <ThemedText style={styles.metricValue}>{item.customer_review.payment}/5</ThemedText>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, styles.providerProgressFill, { width: `${(item.customer_review.payment / 5) * 100}%` }]} />
              </View>
            </View>
            <View style={[styles.metricCard, styles.providerMetricCard]}>
              <ThemedText style={styles.metricLabel}>Behaviour</ThemedText>
              <ThemedText style={styles.metricValue}>{item.customer_review.behaviour}/5</ThemedText>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, styles.providerProgressFill, { width: `${(item.customer_review.behaviour / 5) * 100}%` }]} />
              </View>
            </View>
          </View>
          <View style={[styles.metricsGrid, { marginTop: 8 }]}>
            <View style={[styles.metricCard, styles.providerMetricCard]}>
              <ThemedText style={styles.metricLabel}>Negotiation</ThemedText>
              <ThemedText style={styles.metricValue}>{item.customer_review.negotiation}/5</ThemedText>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, styles.providerProgressFill, { width: `${(item.customer_review.negotiation / 5) * 100}%` }]} />
              </View>
            </View>
            <View style={[styles.metricCard, styles.providerMetricCard]}>
              <ThemedText style={styles.metricLabel}>Environment</ThemedText>
              <ThemedText style={styles.metricValue}>{item.customer_review.environment}/5</ThemedText>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, styles.providerProgressFill, { width: `${(item.customer_review.environment / 5) * 100}%` }]} />
              </View>
            </View>
          </View>
        </>
      )}
    </Animated.View>
  );

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={24} color="#000" />
        </TouchableOpacity>
        <ThemedText style={styles.headerTitle}>Full Job History</ThemedText>
        <View style={{ width: 40 }} />
      </View>

      {offline ? (
        <NoInternetState onRetry={() => { void fetchHistory(); }} />
      ) : loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={themeColors.brand} />
        </View>
      ) : loadError ? (
        <ScrollView refreshControl={refreshControl} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <ThemedText style={{ fontFamily: Fonts.poppinsSemiBold, color: themeColors.textSecondary, textAlign: 'center' }}>
            Couldn't load your job history. Pull down to try again.
          </ThemedText>
        </ScrollView>
      ) : history.length === 0 ? (
        <ScrollView refreshControl={refreshControl} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <ThemedText style={{ fontFamily: Fonts.poppinsSemiBold, color: themeColors.textSecondary, textAlign: 'center' }}>
            No completed or cancelled jobs yet.
          </ThemedText>
        </ScrollView>
      ) : (
        <FlatList keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
          // Keyboard-aware: a box in a row scrolls up above the keyboard.
          renderScrollComponent={(props) => <KeyboardAwareScrollView {...props} bottomOffset={24} />}
          data={history}
          onEndReached={() => { void feed.loadMore('history'); }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={shown.loadingMore ? (
            <ActivityIndicator color={themeColors.brand} style={{ paddingVertical: 20 }} />
          ) : null}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          contentContainerStyle={padBottom(styles.listContent, bottomInset)}
          showsVerticalScrollIndicator={false}
        />
      )}

      {appAlert.element}
      <RepeatBookingSheet
        job={repeatJob}
        onClose={() => setRepeatJob(null)}
        onMessage={(kind, title, message) => appAlert.show(kind, title, message)}
      />
      <GuaranteeSheet
        jobId={guaranteeJob}
        onClose={() => setGuaranteeJob(null)}
        onMessage={(kind, title, message) => appAlert.show(kind, title, message)}
      />
      <TipSheet
        jobId={tipTarget?.jobId ?? null}
        providerName={tipTarget?.providerName ?? 'your provider'}
        onClose={() => setTipTarget(null)}
        onMessage={(kind, title, message) => appAlert.show(kind, title, message)}
      />

      <RatingModal
        visible={!!ratingTarget}
        providerName={ratingTarget?.providerName ?? ''}
        onClose={() => setRatingTarget(null)}
        onTip={() => { if (ratingTarget) setTipTarget(ratingTarget); setRatingTarget(null); }}
        onSubmit={handleRatingSubmit}
        onSkip={() => {
          if (ratingTarget) markRatingSkipped(ratingTarget.jobId);
          setRatingTarget(null);
        }}
      />
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
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 20,
    backgroundColor: t.card,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18, lineHeight: 22,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: t.card,
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  titleInfo: {
    flex: 1,
  },
  jobTitle: {
    fontSize: 17, lineHeight: 21,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  professionalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  professionalName: {
    fontSize: 13, lineHeight: 17,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textSecondary,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11, lineHeight: 15,
    fontFamily: Fonts.poppinsBold,
  },
  infoGrid: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 4,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoText: {
    fontSize: 13, lineHeight: 17,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
  },
  infoValue: {
    fontSize: 14, lineHeight: 18,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  divider: {
    height: 1,
    backgroundColor: t.borderSubtle,
    marginVertical: 16,
  },
  rateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFCE48',
    borderRadius: 14,
    paddingVertical: 11,
  },
  rateBtnText: {
    fontSize: 14, lineHeight: 18,
    fontFamily: Fonts.poppinsBold,
    color: '#111827',
  },
  ratingOverview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 12, lineHeight: 16,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  overallRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  overallNumber: {
    fontSize: 18, lineHeight: 22,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  commentBox: {
    fontSize: 14,
    fontFamily: Fonts.poppins,
    fontStyle: 'italic',
    color: t.textPrimary,
    backgroundColor: t.surface,
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
    lineHeight: 20,
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  metricCard: {
    flex: 1,
    backgroundColor: t.card,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.borderSubtle,
  },
  metricLabel: {
    fontSize: 10, lineHeight: 14,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textSecondary,
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 14, lineHeight: 18,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    marginBottom: 8,
  },
  progressTrack: {
    height: 4,
    backgroundColor: t.inputFilled,
    borderRadius: 2,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FFCE48',
    borderRadius: 2,
  },
  providerMetricCard: {
    borderColor: '#EEF2FF',
    backgroundColor: '#FAFAFE',
  },
  providerProgressFill: {
    backgroundColor: '#6366F1',
  },
}); }
