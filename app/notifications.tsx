import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SkoFyApi } from '@/services/api';
import { useAppAlert } from '@/components/app-alert';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import {
  Bell,
  Briefcase,
  CheckCircle2,
  ChevronLeft,
  Clock,
  FileText,
  KeyRound,
  MessageSquare,
  Phone,
  Star,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  RefreshControl,
  SectionList,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { openJobScreen } from '@/services/jobScreens';

interface NotifItem {
  id: string;
  title: string;
  body: string;
  notif_type: string;
  job_id: string | null;
  is_read: boolean;
  created_at: string;
  image_url: string | null;
  ticket_id?: string | null;
}

function getIcon(type: string) {
  switch (type) {
    case 'new_applicant':
      return { icon: UserPlus, color: '#3B82F6', bg: '#EFF6FF' };
    case 'job_cancelled':
      return { icon: XCircle, color: '#EF4444', bg: '#FEF2F2' };
    case 'chat_message':
      return { icon: MessageSquare, color: '#8B5CF6', bg: '#F5F3FF' };
    case 'incoming_call':
    case 'call_cancelled':
      return { icon: Phone, color: '#10B981', bg: '#ECFDF5' };
    case 'review':
      return { icon: Star, color: '#F59E0B', bg: '#FFFBEB' };
    case 'hired':
    case 'new_job':
      return { icon: Briefcase, color: '#FFCE48', bg: '#FFFDE7' };
    case 'job_completed':
      return { icon: CheckCircle2, color: '#10B981', bg: '#ECFDF5' };
    case 'inspection_otp':
    case 'inspection_started':
      return { icon: KeyRound, color: '#8B5CF6', bg: '#F5F3FF' };
    case 'pickup_confirmed':
      return { icon: CheckCircle2, color: '#10B981', bg: '#ECFDF5' };
    case 'invoice_raised':
    case 'counter_accepted':
    case 'counter_rejected':
      return { icon: FileText, color: '#F59E0B', bg: '#FFFBEB' };
    case 'job_expired':
      return { icon: Clock, color: '#EF4444', bg: '#FEF2F2' };
    default:
      return { icon: Bell, color: '#6B7280', bg: '#F3F4F6' };
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function groupByDate(items: NotifItem[]) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const map: Record<string, NotifItem[]> = {};
  for (const item of items) {
    const d = new Date(item.created_at); d.setHours(0, 0, 0, 0);
    let label: string;
    if (d.getTime() === today.getTime()) label = 'Today';
    else if (d.getTime() === yesterday.getTime()) label = 'Yesterday';
    else label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    map[label] = map[label] || [];
    map[label].push(item);
  }
  return Object.entries(map).map(([title, data]) => ({ title, data }));
}

/** The newest notification shown — "Clear all" clears up to it, so one that
 * arrives while the user is deciding isn't cleared unseen. */
function newestCreatedAt(list: { created_at: string }[]): string | undefined {
  return list.reduce<string | undefined>((max, n) => (!max || new Date(n.created_at) > new Date(max) ? n.created_at : max), undefined);
}

export default function NotificationsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);

  const [items, setItems] = useState<NotifItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [viewerImage, setViewerImage] = useState<string | null>(null);

  const appAlert = useAppAlert();

  const clearAll = () => {
    if (items.length === 0) return;
    appAlert.show('warning', 'Clear all notifications?', "They'll be removed from this list. This can't be undone.", [
      { text: 'Cancel', variant: 'secondary' },
      {
        text: 'Clear all',
        variant: 'primary',
        onPress: async () => {
          const before = items;
          setItems([]);
          try {
            await SkoFyApi.notifications.clearAll(newestCreatedAt(before));
          } catch {
            setItems(before);
            appAlert.show('error', 'Could not clear', 'Please check your connection and try again.');
          }
        },
      },
    ]);
  };

  const load = useCallback(async () => {
    try {
      const data = await SkoFyApi.notifications.list();
      setItems(data);
      SkoFyApi.notifications.readAll().catch(() => {});
    } catch {
      // keep stale data on error
    }
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handlePress = (item: NotifItem) => {
    // admin_broadcast (and anything else not tied to a job) has nowhere to
    // navigate — opening the attached image if there is one beats a dead tap.
    // A support reply opens that conversation (ticket_id is kept since
    // migration 053; older rows open the list of the user's tickets).
    if (item.notif_type === 'support_ticket') {
      if (item.ticket_id) router.push({ pathname: '/support-chat', params: { ticketId: item.ticket_id } } as any);
      else router.push('/help-support' as any);
      return;
    }
    if (!item.job_id && item.image_url) {
      setViewerImage(item.image_url);
      return;
    }
    if (item.job_id) {
      switch (item.notif_type) {
        case 'new_applicant':
          router.push({ pathname: '/applicants', params: { jobId: item.job_id } } as any);
          break;
        case 'chat_message':
        case 'incoming_call':
          router.push({ pathname: '/chat', params: { jobId: item.job_id } } as any);
          break;
        // On-site inspection + invoice — all of these are about a job
        // that's already hired and being tracked, so they belong on
        // track-provider (where the OTP card / invoice card actually live),
        // not the generic /my-jobs fallback below.
        case 'inspection_otp':
        case 'inspection_started':
        case 'pickup_confirmed':
        case 'invoice_raised':
        case 'invoice_countered':
        case 'counter_accepted':
        case 'counter_rejected':
          openJobScreen('/track-provider', item.job_id);
          break;
        case 'job_expired':
          router.push({ pathname: '/edit-job', params: { jobId: item.job_id } } as any);
          break;
        default:
          router.push('/my-jobs');
      }
    }
  };

  const sections = groupByDate(items);

  const renderItem = ({ item, index }: { item: NotifItem; index: number }) => {
    const { icon: Icon, color, bg } = getIcon(item.notif_type);
    return (
      <Animated.View entering={FadeInUp.delay(index * 60).duration(350)}>
        <TouchableOpacity
          style={[styles.notificationCard, !item.is_read && styles.unreadCard]}
          onPress={() => handlePress(item)}
          activeOpacity={0.75}
        >
          <View style={[styles.iconContainer, { backgroundColor: bg }]}>
            <Icon size={22} color={color} />
          </View>
          <View style={styles.textContainer}>
            <View style={styles.headerRow}>
              <ThemedText style={styles.title} numberOfLines={1}>{item.title}</ThemedText>
              <View style={styles.timeRow}>
                {!item.is_read && <View style={styles.unreadDot} />}
                <ThemedText style={styles.time}>{timeAgo(item.created_at)}</ThemedText>
              </View>
            </View>
            <ThemedText style={styles.message} numberOfLines={2}>{item.body}</ThemedText>
            {item.image_url && (
              <TouchableOpacity activeOpacity={0.85} onPress={() => setViewerImage(item.image_url)}>
                <Image source={{ uri: item.image_url }} style={styles.bannerImage} contentFit="cover" />
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={24} color="#111827" />
        </TouchableOpacity>
        <ThemedText style={styles.headerTitle}>Notifications</ThemedText>
        {/* Same width as the back button, so the title stays centred. */}
        <TouchableOpacity
          style={[styles.clearButton, items.length === 0 && { opacity: 0 }]}
          onPress={clearAll}
          disabled={items.length === 0}
        >
          <ThemedText style={styles.clearText} numberOfLines={1}>Clear all</ThemedText>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FFCE48" />
        </View>
      ) : (
        <SectionList keyboardShouldPersistTaps="handled"
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          renderSectionHeader={({ section: { title } }) => (
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
            </View>
          )}
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled={false}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFCE48" colors={['#FFCE48']} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Bell size={48} color="#D1D5DB" />
              <ThemedText style={styles.emptyText}>No notifications yet</ThemedText>
            </View>
          }
        />
      )}
      {appAlert.element}
    </ThemedView>
  );
}

function makeStyles(t: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.card },
    header: {
      paddingTop: Platform.OS === 'ios' ? 60 : 40,
      paddingHorizontal: 20,
      paddingBottom: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: t.card,
      borderBottomWidth: 1,
      borderBottomColor: t.borderSubtle,
    },
    clearButton: { minWidth: 40, height: 40, justifyContent: 'center', alignItems: 'flex-end' },
    clearText: { fontSize: 12.5, lineHeight: 17, fontFamily: Fonts.poppinsSemiBold, color: '#EF4444' },
    backButton: {
      width: 40, height: 40, borderRadius: 20,
      backgroundColor: t.inputFilled, justifyContent: 'center', alignItems: 'center',
    },
    headerTitle: { fontSize: 20, lineHeight: 25, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    listContent: { paddingHorizontal: 20, paddingBottom: 40 },
    sectionHeader: { marginTop: 24, marginBottom: 12 },
    sectionTitle: {
      fontSize: 13, lineHeight: 17, fontFamily: Fonts.poppinsBold, color: t.textMuted,
      textTransform: 'uppercase', letterSpacing: 1,
    },
    notificationCard: {
      flexDirection: 'row', padding: 16, backgroundColor: t.card, borderRadius: 20,
      marginBottom: 12, borderWidth: 1, borderColor: t.borderSubtle, alignItems: 'center',
    },
    unreadCard: { backgroundColor: '#FDFDEA', borderColor: '#FEF08A' },
    iconContainer: {
      width: 48, height: 48, borderRadius: 16,
      justifyContent: 'center', alignItems: 'center', marginRight: 16,
    },
    textContainer: { flex: 1 },
    headerRow: {
      flexDirection: 'row', justifyContent: 'space-between',
      alignItems: 'center', marginBottom: 4,
    },
    title: {
      fontSize: 14, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold,
      color: t.textPrimary, flex: 1, marginRight: 8,
    },
    timeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
    time: { fontSize: 11, lineHeight: 15, fontFamily: Fonts.poppins, color: t.textMuted },
    message: { fontSize: 13, fontFamily: Fonts.poppins, color: t.textSecondary, lineHeight: 19 },
    bannerImage: {
      width: '100%', height: 140, borderRadius: 12, marginTop: 10, backgroundColor: t.inputFilled,
    },
    // Inline next to the timestamp now (was absolutely positioned in the
    // card's top-right corner, landing exactly on top of the timestamp text
    // it was meant to sit beside — same corner, same spot).
    unreadDot: {
      width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFCE48',
    },
    emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingTop: 100 },
    emptyText: { marginTop: 16, fontSize: 15, lineHeight: 19, fontFamily: Fonts.poppinsSemiBold, color: t.textMuted },
  });
}
