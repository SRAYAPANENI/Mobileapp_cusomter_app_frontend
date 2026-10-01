import { useAppAlert } from '@/components/app-alert';
import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SkoFyApi } from '@/services/api';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  ChevronLeft,
  MoreVertical,
  Paperclip,
  Send
} from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import Animated, { FadeInLeft, FadeInRight } from 'react-native-reanimated';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'agent';
  timestamp: string;
}

// No WebSocket for support tickets (unlike job chat) — a plain interval
// while the screen is focused is how new admin replies get picked up.
const POLL_INTERVAL_MS = 8000;

// Shown before the first message, so a ticket is raised with a real subject
// instead of every new conversation landing in the admin queue tagged
// "General Support" with no way to tell what it's actually about.
const CATEGORIES = ['Payment Issue', 'Job / Booking Issue', 'Provider Behavior', 'Account Issue', 'Something Else'];

// A quick self-service answer offered before a ticket is ever raised — most
// categories have one obvious, already-documented answer (see help-support.tsx's
// FAQ) that resolves the question without needing a human at all. Categories
// with no single obvious answer (Account Issue, Something Else) go straight
// to chat instead of showing a canned answer that probably won't fit.
const CATEGORY_SELF_HELP: Record<string, { question: string; answer: string } | null> = {
  'Payment Issue': {
    question: 'Is my payment safe?',
    answer: "Yes. Your payment is held securely by SkoFy the moment you hire a provider, and it's only released to them once the job is marked complete — never paid out upfront.",
  },
  'Job / Booking Issue': {
    question: "What's the cancellation policy?",
    answer: "You can cancel a job for free any time before the provider actually starts work on-site. Once a job is marked \"In Progress\" (or already completed), cancellation isn't available — but you can file a dispute directly from that job's page instead.",
  },
  'Provider Behavior': {
    question: 'Had a problem with your provider?',
    answer: "If a provider didn't show up, was unprofessional, or there's a quality issue on a job that's in progress or completed, file a dispute directly from that job — go to My Jobs, open it, and tap \"Report an Issue.\" Our team reviews every dispute within 24 hours.",
  },
  'Account Issue': null,
  'Something Else': null,
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function SupportChatScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const alert = useAppAlert();
  const { ticketId: paramTicketId, jobId } = useLocalSearchParams<{ ticketId?: string; jobId?: string }>();

  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(!!paramTicketId);
  // No ticket yet until either a ticketId was passed in, or the first
  // message the user sends creates one.
  const [ticketId, setTicketId] = useState<string | undefined>(paramTicketId);
  // Opened from a specific job (a "Get Help" button on that job) — the
  // category is already implied, so skip straight to chatting instead of
  // making them pick it again.
  const [category, setCategory] = useState<string | null>(jobId ? 'Job / Booking Issue' : null);
  // 'showing': the canned Q&A for the chosen category is up, waiting on
  // "Did this help?" — 'resolved': they said yes, no ticket ever created —
  // 'declined': either they said no, or the category has no canned answer;
  // either way the real chat (and eventual ticket) is now unlocked. Skipped
  // entirely for a job-context open — they've already navigated past
  // general FAQs to ask about one specific job.
  const [selfHelpStage, setSelfHelpStage] = useState<'idle' | 'showing' | 'resolved' | 'declined'>(
    jobId ? 'declined' : 'idle'
  );
  // Covers the gap between picking a category and the eagerly-created
  // ticket actually landing (ticketId flips true immediately on success,
  // before selfHelpStage/category settle) — without this, the plain chat
  // input briefly renders and a fast tap could fire a second, duplicate
  // ticket via handleSendMessage's own fallback creation path.
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [assignedAdminName, setAssignedAdminName] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);

  const [messages, setMessages] = useState<Message[]>(
    paramTicketId
      ? []
      : [
          {
            id: 'greeting',
            text: jobId
              ? "Hi! Tell us what's going on with this job and we'll take a look."
              : 'Hello! Welcome to Dodorez Support. What can we help you with?',
            sender: 'agent',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ]
  );

  const loadTicket = useCallback(async (id: string) => {
    try {
      const ticket: any = await SkoFyApi.supportTickets.get(id);
      const mapped: Message[] = (ticket.messages ?? []).map((m: any) => ({
        id: m.id,
        text: m.message,
        sender: m.sender_role === 'admin' ? 'agent' : 'user',
        timestamp: formatTime(m.sent_at),
      }));
      setMessages(mapped);
      setAssignedAdminName(ticket.assigned_admin_name ?? null);
    } catch (err) {
      // A background refresh failing silently and retrying next poll is
      // fine — no need to interrupt the user every 8s over a blip.
      console.warn('Failed to refresh support ticket:', err);
    }
  }, []);

  useEffect(() => {
    if (!paramTicketId) return;
    setLoading(true);
    loadTicket(paramTicketId).finally(() => setLoading(false));
  }, [paramTicketId, loadTicket]);

  useFocusEffect(
    useCallback(() => {
      if (!ticketId) return;
      const interval = setInterval(() => loadTicket(ticketId), POLL_INTERVAL_MS);
      return () => clearInterval(interval);
    }, [ticketId, loadTicket])
  );

  const handleSendMessage = async () => {
    const text = inputText.trim();
    if (text === '' || sending) return;

    setInputText('');
    Keyboard.dismiss();
    setSending(true);

    const optimisticId = `local-${Date.now()}`;
    const optimistic: Message = {
      id: optimisticId,
      text,
      sender: 'user',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      if (!ticketId) {
        const ticket: any = await SkoFyApi.supportTickets.create(category ?? 'General Support', text, jobId);
        setTicketId(ticket.id);
      } else {
        await SkoFyApi.supportTickets.addMessage(ticketId, text);
      }
    } catch (err) {
      console.error('Failed to send support message:', err);
      // The optimistic bubble never actually reached the server — pull it
      // back out instead of leaving a permanent "sent" message that lies
      // about what happened, and give the text back so it's not lost.
      setMessages(prev => prev.filter(m => m.id !== optimisticId));
      setInputText(text);
      alert.show('error', 'Message Not Sent', "Couldn't reach support right now. Please try again.", undefined, 2500);
    } finally {
      setSending(false);
    }
  };

  // Ticket is created here, the moment a category is picked — not lazily
  // on first typed message like before. Everything that happens in this
  // screen, including a self-help answer someone never actually needed
  // real help beyond, now has a real ticket backing it so the full
  // conversation is on record rather than living only in this screen's
  // local state until it's closed and lost.
  const createTicketEagerly = async (cat: string): Promise<string | null> => {
    setCreatingTicket(true);
    try {
      const ticket: any = await SkoFyApi.supportTickets.create(cat, `Needs help with: ${cat}`, jobId);
      setTicketId(ticket.id);
      return ticket.id as string;
    } catch (err) {
      console.error('Failed to start support ticket:', err);
      alert.show('error', 'Something Went Wrong', "Couldn't start this conversation. Please try again.", undefined, 2500);
      return null;
    } finally {
      setCreatingTicket(false);
    }
  };

  const handleSelectCategory = async (cat: string) => {
    setCategory(cat);
    const newTicketId = await createTicketEagerly(cat);
    if (!newTicketId) { setCategory(null); return; }

    const selfHelp = CATEGORY_SELF_HELP[cat];
    if (selfHelp) {
      const text = `${selfHelp.question}\n\n${selfHelp.answer}`;
      setSelfHelpStage('showing');
      setMessages(prev => [...prev, {
        id: `selfhelp-${Date.now()}`,
        text,
        sender: 'agent',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
      SkoFyApi.supportTickets.addSystemMessage(newTicketId, text).catch((err) => {
        // Purely a record-keeping call — the customer already sees the
        // answer either way, so a failure here shouldn't interrupt them.
        console.warn('Failed to record self-help message:', err);
      });
    } else {
      setSelfHelpStage('declined');
      const text = `Got it — tell us more about your ${cat.toLowerCase()}.`;
      setMessages(prev => [...prev, {
        id: `category-${Date.now()}`,
        text,
        sender: 'agent',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
      SkoFyApi.supportTickets.addSystemMessage(newTicketId, text).catch((err) => {
        console.warn('Failed to record category prompt message:', err);
      });
    }
  };

  // Opened with a jobId (a "Get Help" button on a specific job) — self-help
  // is skipped for that path, but the ticket still needs to exist eagerly
  // just like the category-picker path does, so this conversation is
  // recorded even if the customer never ends up typing anything either.
  useEffect(() => {
    if (jobId && !paramTicketId && category) {
      createTicketEagerly(category);
    }
    // Only ever relevant once, on mount, for a job-context open — category/
    // jobId/paramTicketId are stable for the life of this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelfHelpResolved = () => {
    setSelfHelpStage('resolved');
    const text = "Glad that helped! Feel free to come back anytime if something else comes up.";
    setMessages(prev => [...prev, {
      id: `resolved-${Date.now()}`,
      text,
      sender: 'agent',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }]);
    if (ticketId) {
      // Both calls are fire-and-forget record-keeping/status updates — the
      // customer already sees the outcome locally either way.
      SkoFyApi.supportTickets.addSystemMessage(ticketId, text).catch((err) => {
        console.warn('Failed to record self-help resolution message:', err);
      });
      SkoFyApi.supportTickets.selfResolve(ticketId).catch((err) => {
        console.warn('Failed to mark ticket self-resolved:', err);
      });
    }
  };

  const handleSelfHelpDeclined = () => {
    setSelfHelpStage('declined');
    const text = `Got it — tell us more about your ${(category ?? '').toLowerCase()}.`;
    setMessages(prev => [...prev, {
      id: `declined-${Date.now()}`,
      text,
      sender: 'agent',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }]);
    if (ticketId) {
      SkoFyApi.supportTickets.addSystemMessage(ticketId, text).catch((err) => {
        console.warn('Failed to record self-help decline message:', err);
      });
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.sender === 'user';
    return (
      <Animated.View
        entering={isUser ? FadeInRight : FadeInLeft}
        style={[
          styles.messageWrapper,
          isUser ? styles.userMessageWrapper : styles.agentMessageWrapper
        ]}
      >
        {!isUser && (
          <View style={styles.agentAvatar}>
            <Image
              source={require('@/assets/images/logo-mark.png')}
              style={{ width: 24, height: 24 }}
              contentFit="contain"
            />
          </View>
        )}
        <View style={[
          styles.messageBubble,
          isUser ? styles.userBubble : styles.agentBubble
        ]}>
          <ThemedText style={[
            styles.messageText,
            isUser ? styles.userMessageText : styles.agentMessageText
          ]}>
            {item.text}
          </ThemedText>
          <ThemedText style={[
            styles.timestampText,
            isUser ? styles.userTimestamp : styles.agentTimestamp
          ]}>
            {item.timestamp}
          </ThemedText>
        </View>
      </Animated.View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={24} color="#000" />
        </TouchableOpacity>

        <View style={styles.headerInfo}>
          <View style={styles.avatarContainer}>
            <Image
              source={require('@/assets/images/logo-mark.png')}
              style={styles.headerAvatar}
              contentFit="contain"
            />
          </View>
          <View>
            <ThemedText style={styles.headerTitle}>Dodorez Support</ThemedText>
            <View style={styles.onlineBadgeRow}>
              <View style={styles.onlineDot} />
              <ThemedText style={styles.headerStatus}>
                {assignedAdminName ? `Chatting with ${assignedAdminName}` : 'Online'}
              </ThemedText>
            </View>
          </View>
        </View>

        <TouchableOpacity style={styles.menuButton}>
          <MoreVertical size={20} color="#000" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={themeColors.textPrimary} />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        />
      )}

      {!ticketId && !category ? (
        <View style={styles.categoryContainer}>
          <ThemedText style={styles.categoryPrompt}>What's this about?</ThemedText>
          <View style={styles.categoryChipsRow}>
            {CATEGORIES.map(cat => (
              <TouchableOpacity key={cat} style={styles.categoryChip} onPress={() => handleSelectCategory(cat)} activeOpacity={0.8}>
                <ThemedText style={styles.categoryChipText}>{cat}</ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : creatingTicket ? (
        <View style={styles.categoryContainer}>
          <ActivityIndicator color={themeColors.textPrimary} />
        </View>
      ) : selfHelpStage === 'showing' ? (
        <View style={styles.categoryContainer}>
          <ThemedText style={styles.categoryPrompt}>Did this answer your question?</ThemedText>
          <View style={styles.selfHelpButtonRow}>
            <TouchableOpacity style={styles.selfHelpNoBtn} onPress={handleSelfHelpDeclined} activeOpacity={0.8}>
              <ThemedText style={styles.selfHelpNoBtnText}>No, I still need help</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.selfHelpYesBtn} onPress={handleSelfHelpResolved} activeOpacity={0.8}>
              <ThemedText style={styles.selfHelpYesBtnText}>Yes, that helped</ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      ) : selfHelpStage === 'resolved' ? (
        <View style={styles.categoryContainer}>
          <TouchableOpacity style={styles.selfHelpYesBtn} onPress={() => router.back()} activeOpacity={0.85}>
            <ThemedText style={styles.selfHelpYesBtnText}>Done</ThemedText>
          </TouchableOpacity>
        </View>
      ) : (
      <View style={styles.inputContainer}>
        <TouchableOpacity style={styles.attachButton}>
          <Paperclip size={20} color="#6B7280" />
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder="Type a message..."
          placeholderTextColor="#9CA3AF"
          value={inputText}
          onChangeText={setInputText}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendButton, inputText.trim() === '' && styles.sendButtonDisabled]}
          onPress={handleSendMessage}
          disabled={inputText.trim() === '' || sending}
        >
          <Send size={20} color={inputText.trim() === '' ? '#9CA3AF' : '#fff'} />
        </TouchableOpacity>
      </View>
      )}
      {alert.element}
    </KeyboardAvoidingView>
  );
}

function makeStyles(t: typeof Colors.light) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: t.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 16,
    paddingHorizontal: 16,
    backgroundColor: t.card,
    borderBottomWidth: 1,
    borderBottomColor: t.borderSubtle,
  },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  headerInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', marginLeft: 8 },
  avatarContainer: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFBEB',
    justifyContent: 'center', alignItems: 'center', marginRight: 12
  },
  headerAvatar: { width: 24, height: 24 },
  headerTitle: { fontSize: 16, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
  onlineBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981' },
  headerStatus: { fontSize: 12, fontFamily: Fonts.poppins, color: '#10B981' },
  menuButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'flex-end' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  messageList: { padding: 16, paddingBottom: 24 },
  messageWrapper: { marginBottom: 16, maxWidth: '80%', flexDirection: 'row', alignItems: 'flex-end' },
  userMessageWrapper: { alignSelf: 'flex-end' },
  agentMessageWrapper: { alignSelf: 'flex-start' },
  agentAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFFBEB', justifyContent: 'center', alignItems: 'center', marginRight: 8, marginBottom: 4 },
  messageBubble: { padding: 12, borderRadius: 16, maxWidth: '100%' },
  userBubble: { backgroundColor: t.textPrimary, borderBottomRightRadius: 4 },
  agentBubble: { backgroundColor: t.card, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: t.borderSubtle },
  messageText: { fontSize: 14, fontFamily: Fonts.poppins, lineHeight: 20 },
  userMessageText: { color: '#fff' },
  agentMessageText: { color: t.textPrimary },
  timestampText: { fontSize: 10, fontFamily: Fonts.poppins, marginTop: 4, alignSelf: 'flex-end' },
  userTimestamp: { color: 'rgba(255,255,255,0.7)' },
  agentTimestamp: { color: t.textMuted },
  inputContainer: { flexDirection: 'row', alignItems: 'flex-end', padding: 16, backgroundColor: t.card, borderTopWidth: 1, borderTopColor: t.borderSubtle },
  categoryContainer: { padding: 16, backgroundColor: t.card, borderTopWidth: 1, borderTopColor: t.borderSubtle },
  categoryPrompt: { fontSize: 13, fontFamily: Fonts.poppinsSemiBold, color: t.textMuted, marginBottom: 10 },
  categoryChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryChip: { backgroundColor: t.inputFilled, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: t.borderSubtle },
  categoryChipText: { fontSize: 13, fontFamily: Fonts.poppinsSemiBold, color: t.textPrimary },
  selfHelpButtonRow: { flexDirection: 'row', gap: 10 },
  selfHelpNoBtn: {
    flex: 1, borderRadius: 22, paddingVertical: 12, alignItems: 'center',
    backgroundColor: t.inputFilled, borderWidth: 1, borderColor: t.border,
  },
  selfHelpNoBtnText: { fontSize: 13, fontFamily: Fonts.poppinsSemiBold, color: t.textSecondary },
  selfHelpYesBtn: { flex: 1, borderRadius: 22, paddingVertical: 12, alignItems: 'center', backgroundColor: '#FFCE48' },
  selfHelpYesBtnText: { fontSize: 13, fontFamily: Fonts.poppinsBold, color: '#111827' },
  attachButton: { width: 40, height: 44, justifyContent: 'center', alignItems: 'center', marginRight: 8 },
  input: { flex: 1, backgroundColor: t.inputFilled, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, paddingTop: 10, maxHeight: 100, fontFamily: Fonts.poppins, fontSize: 14, color: t.textPrimary },
  sendButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFCE48', justifyContent: 'center', alignItems: 'center', marginLeft: 12 },
  sendButtonDisabled: { backgroundColor: t.inputFilled },
}); }
