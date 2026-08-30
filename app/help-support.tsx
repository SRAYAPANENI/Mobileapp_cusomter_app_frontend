import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { router } from 'expo-router';
import {
  ChevronLeft,
  ChevronRight,
  Headphones,
  HelpCircle,
  MessageCircle,
  Phone,
  Search
} from 'lucide-react-native';
import React from 'react';
import {
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';

const FAQS = [
  { id: '1', question: 'How do I book a service?' },
  { id: '2', question: 'What is the cancellation policy?' },
  { id: '3', question: 'How do I contact the provider?' },
  { id: '4', question: 'Is my payment safe?' },
];

const TICKETS = [
  { id: '102', subject: 'Refund for Order #9876', status: 'Resolved', date: 'Feb 15' },
  { id: '103', subject: 'Service Delay Complaint', status: 'Pending', date: 'Yesterday' },
];

export default function HelpSupportScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);

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
          <TouchableOpacity style={styles.actionCard}>
            <View style={[styles.iconBox, { backgroundColor: '#ECFDF5' }]}>
              <Phone size={24} color="#10B981" />
            </View>
            <ThemedText style={styles.actionTitle}>Call Support</ThemedText>
          </TouchableOpacity>
        </View>

        {/* Recent Tickets */}
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionTitle}>Recent Tickets</ThemedText>
        </View>
        {TICKETS.map((ticket, index) => (
          <TouchableOpacity
            key={ticket.id}
            style={styles.ticketCard}
            onPress={() => router.push('/support-chat')}
          >
            <View style={styles.ticketInfo}>
              <ThemedText style={styles.ticketSubject}>{ticket.subject}</ThemedText>
              <ThemedText style={styles.ticketMeta}>Ticket #{ticket.id} • {ticket.date}</ThemedText>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: ticket.status === 'Resolved' ? '#ECFDF5' : '#FFFBEB' }]}>
              <ThemedText style={[styles.statusText, { color: ticket.status === 'Resolved' ? '#10B981' : '#F59E0B' }]}>
                {ticket.status}
              </ThemedText>
            </View>
          </TouchableOpacity>
        ))}

        {/* FAQ */}
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionTitle}>Frequently Asked Questions</ThemedText>
        </View>
        {FAQS.map((faq, index) => (
          <TouchableOpacity key={faq.id} style={styles.faqItem}>
            <HelpCircle size={18} color="#6B7280" />
            <ThemedText style={styles.faqText}>{faq.question}</ThemedText>
            <ChevronRight size={18} color="#D1D5DB" style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
        ))}
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
  headerTitle: { fontSize: 20, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
  scrollContent: { padding: 20, paddingBottom: 40 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, paddingHorizontal: 16, height: 50, borderRadius: 16, marginBottom: 24, borderWidth: 1, borderColor: t.borderSubtle },
  searchInput: { flex: 1, marginLeft: 12, fontSize: 15, fontFamily: Fonts.poppins, color: t.textPrimary },
  quickActions: { flexDirection: 'row', gap: 16, marginBottom: 32 },
  actionCard: { flex: 1, backgroundColor: t.card, padding: 16, borderRadius: 20, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  iconBox: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  actionTitle: { fontSize: 14, fontFamily: Fonts.poppinsSemiBold, color: t.textPrimary },
  sectionHeader: { marginBottom: 16, marginTop: 8 },
  sectionTitle: { fontSize: 16, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
  ticketCard: { backgroundColor: t.card, padding: 16, borderRadius: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: t.borderSubtle },
  ticketInfo: { flex: 1 },
  ticketSubject: { fontSize: 15, fontFamily: Fonts.poppinsSemiBold, color: t.textPrimary, marginBottom: 4 },
  ticketMeta: { fontSize: 12, fontFamily: Fonts.poppins, color: t.textMuted },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 12, fontFamily: Fonts.poppinsBold },
  faqItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, padding: 16, borderRadius: 16, marginBottom: 8, gap: 12, borderWidth: 1, borderColor: t.borderSubtle },
  faqText: { fontSize: 14, fontFamily: Fonts.poppins, color: t.textPrimary, flex: 1 },
}); }
