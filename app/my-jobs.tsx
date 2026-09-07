import { CancelJobModal } from '@/components/cancel-job-modal';
import { SkoFyBottomBar } from '@/components/skofy-bottom-bar';
import { EmptyJobsState } from '@/components/empty-jobs-state';
import { NoInternetState } from '@/components/no-internet-state';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useIsOnline } from '@/hooks/use-is-online';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import {
  CalendarX,
  ChevronLeft,
  Clock,
  Info,
  Pencil,
  Users,
  XCircle
} from 'lucide-react-native';
import { SkoFyApi } from '@/services/api';
import React, { useCallback, useEffect, useState } from 'react';
import {
  BackHandler,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
  View
} from 'react-native';
import { useAppAlert } from '@/components/app-alert';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming
} from 'react-native-reanimated';

interface Job {
  id: string;
  title: string;
  description: string;
  type: 'Urgent' | 'Normal' | 'Booked Slot';
  status: 'Open' | 'Ongoing' | 'Completed' | 'Cancelled' | 'Expired';
  statusLabel: string;
  statusColor: string;
  postedAt: string;
  applicants?: number;
  actionLabel?: string;
  cancellationReason?: string;
}


function JobCard({ item, index, onCancelPress }: { item: Job; index: number; onCancelPress: (jobId: string) => void }) {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);

  const hasApplicants = item.status === 'Open' && (item.applicants ?? 0) > 0;
  const glow = useSharedValue(0.4);

  useEffect(() => {
    if (hasApplicants) {
      glow.value = withRepeat(
        withTiming(1, { duration: 1500 }),
        -1,
        true
      );
    }
  }, [hasApplicants]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      shadowOpacity: glow.value,
      borderWidth: 2,
      borderColor: hasApplicants
        ? `rgba(16, 185, 129, ${glow.value})`
        : 'transparent',
      transform: [{ scale: hasApplicants ? withRepeat(withTiming(1.01, { duration: 1500 }), -1, true) : 1 }]
    };
  });

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 100)}
      style={[styles.card, hasApplicants && animatedStyle]}
    >
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <ThemedText style={styles.jobTitle}>{item.title}</ThemedText>
            {hasApplicants && (
              <View style={styles.newBadge}>
                <ThemedText style={styles.newBadgeText}>NEW</ThemedText>
              </View>
            )}
          </View>
          <ThemedText style={styles.jobDescription} numberOfLines={2}>
            {item.description}
          </ThemedText>
        </View>
        <View style={styles.badgeContainer}>
          <View style={[styles.statusTag, { backgroundColor: themeColors.inputFilled }]}>
            <ThemedText style={styles.statusTagText}>
              {item.status === 'Open' ? 'Open' : item.status === 'Ongoing' ? 'Ongoing' : 'Normal'}
            </ThemedText>
          </View>
        </View>
      </View>

      {item.cancellationReason && (
        <View style={{ backgroundColor: '#FEF2F2', borderRadius: 8, padding: 8, marginBottom: 8 }}>
          <ThemedText style={{ fontSize: 12, color: '#B91C1C' }}>
            {item.cancellationReason}
          </ThemedText>
        </View>
      )}

      {item.status === 'Expired' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F3F4F6', borderRadius: 8, padding: 8, marginBottom: 8 }}>
          <CalendarX size={14} color="#6B7280" />
          <ThemedText style={{ fontSize: 12, color: '#4B5563', flex: 1 }}>
            Deadline passed — no provider was hired. Edit to repost with a new time.
          </ThemedText>
        </View>
      )}

      <View style={styles.metaRow}>
        <View style={[styles.typeBadge, {
          backgroundColor: item.type === 'Urgent' ? '#FFCE48' : item.type === 'Booked Slot' ? '#1F2937' : '#FFCE48'
        }]}>
          <ThemedText style={[styles.typeBadgeText, {
            color: item.type === 'Booked Slot' ? '#fff' : '#000'
          }]}>
            {item.type}
          </ThemedText>
        </View>

        <View style={[styles.statusBadge, { backgroundColor: item.statusColor }]}>
          <ThemedText style={styles.statusBadgeText}>{item.statusLabel}</ThemedText>
        </View>
      </View>

      <View style={styles.footerTopRow}>
        <View style={styles.postedInfo}>
          <Clock size={12} color="#9CA3AF" />
          <ThemedText style={styles.postedText}>{item.postedAt}</ThemedText>
        </View>

        {item.applicants ? (
          <View style={[styles.applicantBadge, hasApplicants && { backgroundColor: '#ECFDF5' }]}>
            <Users size={14} color={hasApplicants ? '#10B981' : '#6B7280'} />
            <ThemedText style={[styles.applicantText, hasApplicants && { color: '#10B981' }]}>
              {item.applicants} Applicants
            </ThemedText>
          </View>
        ) : null}
      </View>

      {(item.status === 'Open' || item.status === 'Expired' || item.actionLabel) && (
        <View style={styles.footerActionsRow}>
          {item.status === 'Open' ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={styles.editButton}
                onPress={() => router.push({ pathname: '/job-details', params: { jobId: item.id } })}
              >
                <Info size={14} color="#6B7280" />
                <ThemedText style={styles.editButtonText}>Details</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelButtonSmall}
                onPress={() => onCancelPress(item.id)}
              >
                <XCircle size={14} color="#EF4444" />
                <ThemedText style={styles.cancelButtonSmallText}>Cancel</ThemedText>
              </TouchableOpacity>
            </View>
          ) : item.status === 'Expired' ? (
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: '#4B5563', borderColor: '#4B5563', flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }]}
              onPress={() => router.push({ pathname: '/edit-job', params: { jobId: item.id } })}
            >
              <Pencil size={14} color="#fff" />
              <ThemedText style={[styles.actionButtonText, { color: '#fff' }]}>Edit & Repost</ThemedText>
            </TouchableOpacity>
          ) : <View />}

          {item.actionLabel && item.status !== 'Expired' && (
            <TouchableOpacity
              style={[styles.actionButton, hasApplicants && { backgroundColor: '#10B981', borderColor: '#10B981' }]}
              onPress={() => {
                if (item.actionLabel === 'Track Provider') {
                  router.push({ pathname: '/track-provider', params: { jobId: item.id } });
                } else {
                  router.push({ pathname: '/applicants', params: { jobId: item.id } });
                }
              }}
            >
              <ThemedText style={[styles.actionButtonText, hasApplicants && { color: '#fff' }]}>{item.actionLabel}</ThemedText>
            </TouchableOpacity>
          )}
        </View>
      )}
    </Animated.View>
  );
}

function mapApiJob(j: any): Job {
  const urgencyMap: Record<string, Job['type']> = {
    HIGH: 'Urgent', EMERGENCY: 'Urgent',
    MEDIUM: 'Normal', LOW: 'Booked Slot',
  };
  const statusMap: Record<string, { status: Job['status']; label: string; color: string }> = {
    POSTED:      { status: 'Open',      label: 'Waiting for bids', color: '#10B981' },
    DISTRIBUTED: { status: 'Open',      label: 'Finding providers', color: '#F59E0B' },
    ACCEPTED:    { status: 'Ongoing',   label: 'Provider hired',   color: '#3B82F6' },
    // Bidding is retired — price is only ever set after the provider
    // inspects the job in person. Without these two, a job in either state
    // fell through to the "Open"/"Waiting for bids" fallback below, hiding
    // it from the Ongoing tab and losing its "Track Provider" action.
    INSPECTING:      { status: 'Ongoing', label: 'Inspecting the job', color: '#8B5CF6' },
    INVOICE_PENDING: { status: 'Ongoing', label: 'Invoice ready',      color: '#F59E0B' },
    IN_PROGRESS: { status: 'Ongoing',   label: 'In progress',      color: '#6366F1' },
    COMPLETED:   { status: 'Completed', label: 'Completed',        color: '#4B5563' },
    CANCELLED:   { status: 'Cancelled', label: 'Cancelled',        color: '#EF4444' },
    DISPUTED:    { status: 'Ongoing',   label: 'Disputed',         color: '#DC2626' },
    EXPIRED:     { status: 'Expired',   label: 'Deadline Passed',  color: '#6B7280' },
  };
  const mapped = statusMap[j.status] ?? { status: 'Open', label: j.status, color: '#9CA3AF' };
  const actionLabel =
    mapped.status === 'Open' && j.applicant_count > 0 ? 'View Applicants' :
    mapped.status === 'Ongoing' ? 'Track Provider' : undefined;
  const postedAt = j.created_at
    ? `Posted ${new Date(j.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : 'Just posted';
  return {
    id: j.id,
    title: j.title,
    description: j.description || '',
    type: urgencyMap[j.urgency] ?? 'Normal',
    status: mapped.status,
    statusLabel: mapped.label,
    statusColor: mapped.color,
    postedAt,
    applicants: j.applicant_count > 0 ? j.applicant_count : undefined,
    actionLabel,
    cancellationReason: j.cancellation_reason ?? undefined,
  };
}

export default function MyJobsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const appAlert = useAppAlert();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const isOnline = useIsOnline();
  const [refreshing, setRefreshing] = useState(false);
  const TABS = ['Waiting for Bids', 'Ongoing', 'Cancelled'] as const;
  const [activeTab, setActiveTab] = useState<typeof TABS[number]>('Waiting for Bids');
  const [cancelJobId, setCancelJobId] = useState<string | null>(null);

  const loadJobs = async () => {
    try {
      const data: any[] = await SkoFyApi.jobs.list();
      setJobs(Array.isArray(data) ? data.map(mapApiJob) : []);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(useCallback(() => {
    loadJobs();
    const backAction = () => {
      router.canGoBack() ? router.back() : router.replace('/(tabs)/home');
      return true;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, []));

  const filteredJobs = jobs.filter(j => {
    if (activeTab === 'Waiting for Bids') return j.status === 'Open';
    if (activeTab === 'Ongoing') return j.status === 'Ongoing';
    return j.status === 'Cancelled' || j.status === 'Expired';
  });

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/home')}>
          <ChevronLeft size={24} color="#000" />
        </TouchableOpacity>
        <ThemedText style={styles.headerTitle}>Your Jobs</ThemedText>
        <Image
          source={require('@/assets/images/logo-mark.png')}
          style={styles.logo}
          contentFit="contain"
        />
      </View>

      <View style={styles.tabsRow}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tabBtn, activeTab === tab && styles.tabBtnActive]}
            onPress={() => setActiveTab(tab)}
          >
            <ThemedText style={[styles.tabBtnText, activeTab === tab && styles.tabBtnTextActive]}>
              {tab}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        !isOnline ? (
          <NoInternetState onRetry={loadJobs} />
        ) : (
          <View style={{ paddingHorizontal: 16, paddingTop: 16, gap: 14 }}>
            {[0, 1, 2, 3].map(i => (
              <View key={i} style={{ gap: 8 }}>
                <Skeleton width="70%" height={16} />
                <Skeleton width="45%" height={12} />
                <Skeleton width="100%" height={64} borderRadius={14} />
              </View>
            ))}
          </View>
        )
      ) : (
        <FlatList
          data={filteredJobs}
          renderItem={({ item, index }) => (
            <JobCard item={item} index={index} onCancelPress={setCancelJobId} />
          )}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadJobs(); }}
              colors={['#FFCE48']}
              tintColor="#FFCE48"
            />
          }
          ListEmptyComponent={
            activeTab === 'Ongoing' ? (
              <EmptyJobsState title="No ongoing jobs" subtitle="Once you hire a provider, they'll show up here." />
            ) : activeTab === 'Cancelled' ? (
              <EmptyJobsState title="No cancelled jobs" subtitle="Cancelled jobs will show up here." />
            ) : (
              <EmptyJobsState
                title="Nothing here yet"
                subtitle="You haven't posted any jobs yet. Tap below to post your first one!"
                onPress={() => {
                  // This used to jump straight into step1 with no location at
                  // all — the only place that actually captures lat/lng is the
                  // location-picker modal on Home, so a job posted via this
                  // button would silently get created with no coordinates and
                  // never reach any provider (the backend skips distribution
                  // entirely when lat/lng are missing), with no error shown.
                  // Fixed by reusing the same triggerBookLocation hop the
                  // bottom bar's "Book" tab already uses — Home picks this up
                  // and opens the location-confirm modal straight into manual
                  // post mode, so "Post a Job" here actually posts a job in
                  // one hop instead of dead-ending in an alert.
                  router.replace({ pathname: '/(tabs)/home', params: { triggerBookLocation: 'true' } });
                }}
                buttonLabel="Post a Job"
              />
            )
          }
        />
      )}
      {cancelJobId && (
        <CancelJobModal
          visible={!!cancelJobId}
          jobId={cancelJobId}
          onClose={() => setCancelJobId(null)}
          onCancelled={(message) => {
            setCancelJobId(null);
            loadJobs();
            const reopened = message.toLowerCase().includes('other applicant');
            appAlert.show(
              reopened ? 'success' : 'warning',
              reopened ? 'Other Applicants Available' : 'Job Cancelled',
              message,
            );
          }}
        />
      )}
      {/* ── Fixed Bottom Navigation Dock ── */}
      <SkoFyBottomBar activeTab="my-jobs" />

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
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: Fonts.poppinsBold,
    color: '#000',
  },
  logo: {
    width: 32,
    height: 32,
  },
  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
    backgroundColor: t.card,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: t.inputFilled,
    alignItems: 'center',
  },
  tabBtnActive: {
    backgroundColor: '#FFCE48',
  },
  tabBtnText: {
    fontSize: 12,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textSecondary,
  },
  tabBtnTextActive: {
    color: '#000',
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
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  jobTitle: {
    fontSize: 18,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  newBadge: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  newBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontFamily: Fonts.poppinsBold,
  },
  jobDescription: {
    fontSize: 14,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
    marginTop: 4,
  },
  badgeContainer: {
    alignItems: 'flex-end',
  },
  statusTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusTagText: {
    fontSize: 11,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textSecondary,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  typeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  typeBadgeText: {
    fontSize: 12,
    fontFamily: Fonts.poppinsSemiBold,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusBadgeText: {
    fontSize: 12,
    fontFamily: Fonts.poppinsSemiBold,
    color: '#fff',
  },
  footerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: t.borderSubtle,
    paddingTop: 16,
  },
  footerActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  postedInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  postedText: {
    fontSize: 12,
    fontFamily: Fonts.poppins,
    color: t.textMuted,
  },
  applicantBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: t.surface,
  },
  applicantText: {
    fontSize: 12,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textSecondary,
  },
  actionButton: {
    borderWidth: 1,
    borderColor: '#000',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
  },
  actionButtonText: {
    fontSize: 13,
    fontFamily: Fonts.poppinsBold,
    color: '#000',
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: t.inputFilled,
  },
  editButtonText: {
    fontSize: 12,
    fontFamily: Fonts.poppinsSemiBold,
    color: '#6B7280',
  },
  cancelButtonSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#FEF2F2',
  },
  cancelButtonSmallText: {
    fontSize: 12,
    fontFamily: Fonts.poppinsSemiBold,
    color: '#EF4444',
  }
}); }
