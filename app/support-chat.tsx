import { useAppAlert } from '@/components/app-alert';
import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SkoFyApi } from '@/services/api';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  ChevronLeft,
  HelpCircle,
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
  ScrollView,
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

// The category a "Get Help" button on a specific job opens straight into.
const JOB_CATEGORY = 'Job / Booking Issue';

// Common questions shown for each topic BEFORE any chat or ticket exists —
// most questions are answered here without needing a person. A topic with
// no FAQs (Something Else) goes straight to chat.
const CATEGORY_FAQS: Record<string, { question: string; answer: string }[]> = {
  'Payment Issue': [
    {
      question: 'Is my payment safe?',
      answer: "Yes. Your payment is held securely by Dodorez the moment you hire a provider, and it's only released to them once the job is marked complete — never paid out upfront.",
    },
    {
      question: 'When am I charged?',
      answer: "The provider's visiting fee is charged when you hire them. The cost of the work is charged when you approve their invoice. Both are held safely until the job is done.",
    },
    {
      question: 'How do refunds work?',
      answer: "If a job is cancelled before work starts, your payment goes back to your original card — usually within 5–10 business days. The visiting fee isn't refunded once the provider has done the inspection, but it counts toward the final bill if you hire them.",
    },
  ],
  'Job / Booking Issue': [
    {
      question: "What's the cancellation policy?",
      answer: "You can cancel a job for free any time before the provider actually starts work on-site. Once a job is marked \"In Progress\" (or already completed), cancellation isn't available — but you can file a dispute directly from that job's page instead.",
    },
    {
      question: 'No provider has applied to my job yet',
      answer: "Your job is sent to every verified provider in your city with the right skills. Give it a little time — or open the job and add more details or a photo, which helps providers respond.",
    },
    {
      question: 'How do I contact my provider?',
      answer: "Once you've hired someone, chat and call open from that job's page — your phone number is never shared outside the app.",
    },
  ],
  'Provider Behavior': [
    {
      question: 'Had a problem with your provider?',
      answer: "If a provider didn't show up, was unprofessional, or there's a quality issue on a job that's in progress or completed, file a dispute directly from that job — go to My Jobs, open it, and tap \"Report an Issue.\" Our team reviews every dispute within 24 hours.",
    },
    {
      question: 'The provider asked me to pay outside the app',
      answer: "Please don't. Payments made outside Dodorez aren't protected — we can't refund them or help with disputes. Pay through the app, and let us know if a provider asks you to pay them directly.",
    },
  ],
  'Account Issue': [
    {
      question: "I can't log in",
      answer: "Use \"Forgot password\" on the login screen, or log in with a one-time code sent to your phone. If neither works, tap \"I still need help\" below.",
    },
    {
      question: 'How do I update my details or address?',
      answer: "Go to Profile to change your name, email and saved addresses. To change your phone number, tap \"I still need help\" and we'll do it for you.",
    },
  ],
  'Something Else': [],
};

const nowTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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
  // No ticket exists until the user sends their first real message (or a
  // ticketId was passed in to reopen one). Previously a ticket was created
  // the moment a topic was picked, with an auto "Needs help with: …" message
  // saved as if the user had typed it — so every chat started with a message
  // they never sent.
  const [ticketId, setTicketId] = useState<string | undefined>(paramTicketId);
  // Opened from a specific job (a "Get Help" button on that job) — the topic
  // is already known, so it opens straight on that topic's FAQs.
  const [category, setCategory] = useState<string | null>(jobId ? JOB_CATEGORY : null);
  // 'pick': choose a topic — 'faq': that topic's common questions, no ticket
  // yet — 'resolved': an FAQ answered it, no ticket ever created — 'chat':
  // typing to a person.
  const [stage, setStage] = useState<'pick' | 'faq' | 'resolved' | 'chat'>(
    paramTicketId ? 'chat' : jobId ? 'faq' : 'pick'
  );
  const [assignedAdminName, setAssignedAdminName] = useState<string | null>(null);
  const [viewedFaqs, setViewedFaqs] = useState<string[]>([]);
  // Brief window while "I still need help" opens the ticket — the send
  // button waits so a fast first message can't create a second ticket.
  const [creatingTicket, setCreatingTicket] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  // Two lists: `intro` is this screen's local lead-in (greeting, topic, FAQ
  // answers) and is never sent to the server; `thread` is the real ticket
  // conversation. Kept apart so the 8s poll can replace `thread` with the
  // server's copy without wiping the FAQ answers the user just read.
  const [intro, setIntro] = useState<Message[]>(() => {
    if (paramTicketId) return [];
    return [{
      id: 'greeting',
      text: jobId
        ? "Hi! Here are answers to common questions about jobs. If none of them help, tap \"I still need help\" to chat with our team."
        : 'Hello! Welcome to Dodorez Support. What can we help you with?',
      sender: 'agent',
      timestamp: nowTime(),
    }];
  });
  const [thread, setThread] = useState<Message[]>([]);
  const messages = [...intro, ...thread];

  const addIntro = (text: string, sender: Message['sender']) =>
    setIntro(prev => [...prev, { id: `intro-${Date.now()}-${prev.length}`, text, sender, timestamp: nowTime() }]);

  const loadTicket = useCallback(async (id: string) => {
    try {
      const ticket: any = await SkoFyApi.supportTickets.get(id);
      const mapped: Message[] = (ticket.messages ?? []).map((m: any) => ({
        id: m.id,
        text: m.message,
        // 'system' messages (automatic answers recorded on older tickets) are
        // from support too — they used to render as the user's own messages.
        sender: m.sender_role === 'admin' || m.sender_role === 'system' ? 'agent' : 'user',
        timestamp: formatTime(m.sent_at),
      }));
      setThread(mapped);
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
    if (text === '' || sending || creatingTicket) return;

    setInputText('');
    Keyboard.dismiss();
    setSending(true);

    const optimisticId = `local-${Date.now()}`;
    setThread(prev => [...prev, { id: optimisticId, text, sender: 'user', timestamp: nowTime() }]);

    try {
      if (!ticketId) {
        // First real message creates the ticket — with the user's own words.
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
      setThread(prev => prev.filter(m => m.id !== optimisticId));
      setInputText(text);
      alert.show('error', 'Message Not Sent', "Couldn't reach support right now. Please try again.", undefined, 2500);
    } finally {
      setSending(false);
    }
  };

  const handleSelectCategory = (cat: string) => {
    setCategory(cat);
    addIntro(cat, 'user');
    if (CATEGORY_FAQS[cat]?.length) {
      addIntro(`Here are quick answers about ${cat.toLowerCase()}. Tap a question below.`, 'agent');
      setStage('faq');
    } else {
      addIntro(`Got it — tell us more about your ${cat.toLowerCase()}.`, 'agent');
      setStage('chat');
    }
  };

  const handleFaqTap = (faq: { question: string; answer: string }) => {
    addIntro(faq.question, 'user');
    addIntro(faq.answer, 'agent');
    setViewedFaqs(prev => (prev.includes(faq.question) ? prev : [...prev, faq.question]));
  };

  // Every FAQ visit is recorded as a ticket: RESOLVED if an answer was
  // enough, OPEN if the user still needs a person. The opening note says
  // which questions they read, saved as a system message so it never shows
  // as something the user typed.
  const faqNote = (outcome: string) => {
    const viewed = viewedFaqs.length
      ? `Questions viewed: ${viewedFaqs.map(q => `"${q}"`).join(', ')}.`
      : 'No questions opened.';
    return `Topic: ${category}. ${viewed} ${outcome}`;
  };

  const handleSelfHelpResolved = async () => {
    setStage('resolved');
    addIntro('Glad that helped! Feel free to come back anytime if something else comes up.', 'agent');
    try {
      const ticket: any = await SkoFyApi.supportTickets.create(
        category ?? 'General Support', faqNote('Marked as solved by the FAQ answers.'), jobId, true,
      );
      await SkoFyApi.supportTickets.selfResolve(ticket.id);
    } catch (err) {
      // Record-keeping only — the user already got their answer.
      console.warn('Failed to record self-resolved support visit:', err);
    }
  };

  const handleNeedHelp = async () => {
    setStage('chat');
    setCreatingTicket(true);
    try {
      const ticket: any = await SkoFyApi.supportTickets.create(
        category ?? 'General Support', faqNote('Still needs help — waiting for a team member.'), jobId, true,
      );
      setTicketId(ticket.id);
      addIntro("No problem — we've opened a request for you. Type your message below and our team will reply right here.", 'agent');
    } catch (err) {
      // Falls back to creating the ticket from their first typed message.
      console.warn('Failed to open support ticket:', err);
      addIntro("No problem — type your message below and our team will reply right here.", 'agent');
    } finally {
      setCreatingTicket(false);
    }
  };

  const faqs = category ? CATEGORY_FAQS[category] ?? [] : [];

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

      {stage === 'pick' ? (
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
      ) : stage === 'faq' ? (
        <View style={styles.categoryContainer}>
          <ThemedText style={styles.categoryPrompt}>Common questions</ThemedText>
          <ScrollView style={styles.faqList} contentContainerStyle={{ gap: 8 }}>
            {faqs.map(faq => (
              <TouchableOpacity key={faq.question} style={styles.faqChip} onPress={() => handleFaqTap(faq)} activeOpacity={0.8}>
                <HelpCircle size={16} color={themeColors.textSecondary} />
                <ThemedText style={styles.faqChipText}>{faq.question}</ThemedText>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={[styles.selfHelpButtonRow, { marginTop: 12 }]}>
            <TouchableOpacity style={styles.selfHelpNoBtn} onPress={handleNeedHelp} activeOpacity={0.8}>
              <ThemedText style={styles.selfHelpNoBtnText}>I still need help</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.selfHelpYesBtn} onPress={handleSelfHelpResolved} activeOpacity={0.8}>
              <ThemedText style={styles.selfHelpYesBtnText}>That answered it</ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      ) : stage === 'resolved' ? (
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
          disabled={inputText.trim() === '' || sending || creatingTicket}
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
  faqList: { maxHeight: 220 },
  faqChip: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: t.inputFilled, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1, borderColor: t.borderSubtle,
  },
  faqChipText: { flex: 1, fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: t.textPrimary },
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
