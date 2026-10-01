import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SkoFyApi } from '@/services/api';
import { router } from 'expo-router';
import {
  ChevronLeft,
  ChevronRight,
  Headphones,
  HelpCircle,
  MessageCircle,
  Search
} from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';

const FAQS = [
  {
    id: '1',
    question: 'How do I book a service?',
    answer: 'Tap the mic and describe what you need in your own words, or choose "Manual" to fill in the details yourself. SkoFy automatically finds and notifies verified providers near you — no need to browse or compare listings.',
  },
  {
    id: '2',
    question: 'What is the cancellation policy?',
    answer: 'You can cancel a job for free any time before the provider actually starts work on-site. Once a job is marked "In Progress," cancellation is no longer available — raise a dispute instead if something goes wrong.',
  },
  {
    id: '3',
    question: 'How do I contact the provider?',
    answer: "Once you've hired someone, an in-app chat and call open automatically from that job's tracking screen — your phone number is never shared outside the app.",
  },
  {
    id: '4',
    question: 'Is my payment safe?',
    answer: "Yes. Your payment is held securely by SkoFy the moment you hire a provider, and it's only released to them once the job is marked complete — never paid out upfront.",
  },
];

interface Ticket {
  id: string;
  subject: string;
  status: string;
  created_at: string;
}

function statusLabel(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase().replace('_', ' ');
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  if (isToday) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function HelpSupportScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [expandedFaqId, setExpandedFaqId] = useState<string | null>(null);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredFaqs = FAQS.filter((faq) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return faq.question.toLowerCase().includes(q) || faq.answer.toLowerCase().includes(q);
  });

  useEffect(() => {
    SkoFyApi.supportTickets.list()
      .then((data: any) => setTickets(Array.isArray(data) ? data : []))
      .catch((err: unknown) => console.warn('Failed to load support tickets:', err))
      .finally(() => setLoadingTickets(false));
  }, []);

  return (
    <ThemedView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={24} color="#111827" />
        </TouchableOpacity>
        <ThemedText style={styles.headerTitle}>Help & Support</ThemedText>
        <Headphones size={24} color="#111827" />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Search */}
        <View style={styles.searchContainer}>
          <Search size={20} color="#9CA3AF" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search for help..."
            placeholderTextColor="#9CA3AF"
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
        </View>

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/support-chat')}>
            <View style={[styles.iconBox, { backgroundColor: '#EFF6FF' }]}>
              <MessageCircle size={24} color="#3B82F6" />
            </View>
            <ThemedText style={styles.actionTitle}>Chat with Us</ThemedText>
          </TouchableOpacity>
        </View>

        {/* Recent Tickets */}
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionTitle}>Recent Tickets</ThemedText>
        </View>
        {loadingTickets && <ActivityIndicator color={themeColors.textPrimary} style={{ marginBottom: 16 }} />}
        {!loadingTickets && tickets.length === 0 && (
          <ThemedText style={styles.emptyText}>No support tickets yet.</ThemedText>
        )}
        {tickets.map((ticket) => {
          const resolved = ticket.status === 'RESOLVED' || ticket.status === 'CLOSED';
          return (
            <TouchableOpacity
              key={ticket.id}
              style={styles.ticketCard}
              onPress={() => router.push({ pathname: '/support-chat', params: { ticketId: ticket.id } })}
            >
              <View style={styles.ticketInfo}>
                <ThemedText style={styles.ticketSubject}>{ticket.subject}</ThemedText>
                <ThemedText style={styles.ticketMeta}>Ticket #{ticket.id.slice(0, 8)} • {formatDate(ticket.created_at)}</ThemedText>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: resolved ? '#ECFDF5' : '#FFFBEB' }]}>
                <ThemedText style={[styles.statusText, { color: resolved ? '#10B981' : '#F59E0B' }]}>
                  {statusLabel(ticket.status)}
                </ThemedText>
              </View>
            </TouchableOpacity>
          );
        })}

        {/* FAQ */}
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionTitle}>Frequently Asked Questions</ThemedText>
        </View>
        {filteredFaqs.length === 0 && (
          <ThemedText style={styles.emptyText}>No results for "{searchQuery.trim()}".</ThemedText>
        )}
        {filteredFaqs.map((faq) => {
          const expanded = expandedFaqId === faq.id;
          return (
            <TouchableOpacity
              key={faq.id}
              style={styles.faqItem}
              onPress={() => setExpandedFaqId(expanded ? null : faq.id)}
              activeOpacity={0.75}
            >
              <View style={styles.faqRow}>
                <HelpCircle size={18} color="#6B7280" />
                <ThemedText style={styles.faqText}>{faq.question}</ThemedText>
                <ChevronRight
                  size={18}
                  color="#D1D5DB"
                  style={[styles.faqChevron, expanded && styles.faqChevronExpanded]}
                />
              </View>
              {expanded && <ThemedText style={styles.faqAnswer}>{faq.answer}</ThemedText>}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </ThemedView>
  );
}

function makeStyles(t: typeof Colors.light) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: t.surface },
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
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: t.inputFilled, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 20, lineHeight: 25, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
  scrollContent: { padding: 20, paddingBottom: 40 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, paddingHorizontal: 16, height: 50, borderRadius: 16, marginBottom: 24, borderWidth: 1, borderColor: t.borderSubtle },
  searchInput: { flex: 1, marginLeft: 12, fontSize: 15, lineHeight: 19, fontFamily: Fonts.poppins, color: t.textPrimary },
  quickActions: { flexDirection: 'row', gap: 16, marginBottom: 32 },
  actionCard: { flex: 1, backgroundColor: t.card, padding: 16, borderRadius: 20, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  iconBox: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  actionTitle: { fontSize: 14, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: t.textPrimary },
  sectionHeader: { marginBottom: 16, marginTop: 8 },
  sectionTitle: { fontSize: 16, lineHeight: 20, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
  ticketCard: { backgroundColor: t.card, padding: 16, borderRadius: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: t.borderSubtle },
  ticketInfo: { flex: 1 },
  ticketSubject: { fontSize: 15, lineHeight: 19, fontFamily: Fonts.poppinsSemiBold, color: t.textPrimary, marginBottom: 4 },
  ticketMeta: { fontSize: 12, lineHeight: 16, fontFamily: Fonts.poppins, color: t.textMuted },
  emptyText: { fontSize: 13, fontFamily: Fonts.poppins, color: t.textMuted, marginBottom: 16 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 12, lineHeight: 16, fontFamily: Fonts.poppinsBold },
  faqItem: { backgroundColor: t.card, padding: 16, borderRadius: 16, marginBottom: 8, borderWidth: 1, borderColor: t.borderSubtle },
  faqRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  faqText: { fontSize: 14, lineHeight: 18, fontFamily: Fonts.poppins, color: t.textPrimary, flex: 1 },
  faqChevron: { marginLeft: 'auto', transform: [{ rotate: '0deg' }] },
  faqChevronExpanded: { transform: [{ rotate: '90deg' }] },
  faqAnswer: { fontSize: 13, lineHeight: 19, fontFamily: Fonts.poppins, color: t.textSecondary, marginTop: 10, paddingLeft: 30 },
}); }
