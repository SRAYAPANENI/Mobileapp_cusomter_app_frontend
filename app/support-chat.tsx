import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import {
  ChevronLeft,
  MoreVertical,
  Paperclip,
  Send
} from 'lucide-react-native';
import React, { useRef, useState } from 'react';
import {
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

export default function SupportChatScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      text: "Hello! Welcome to Dodorez Support. How can we help you today?",
      sender: 'agent',
      timestamp: '10:00 AM'
    }
  ]);

  const handleSendMessage = () => {
    if (inputText.trim() === '') return;

    const newMessage: Message = {
      id: Date.now().toString(),
      text: inputText.trim(),
      sender: 'user',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, newMessage]);
    setInputText('');
    Keyboard.dismiss();

    // Simulate Agent Reply
    setTimeout(() => {
      const reply: Message = {
        id: (Date.now() + 1).toString(),
        text: "Thank you for reaching out. An agent will be with you shortly.",
        sender: 'agent',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, reply]);
    }, 1500);
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
              <ThemedText style={styles.headerStatus}>Online</ThemedText>
            </View>
          </View>
        </View>

        <TouchableOpacity style={styles.menuButton}>
          <MoreVertical size={20} color="#000" />
        </TouchableOpacity>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

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
          disabled={inputText.trim() === ''}
        >
          <Send size={20} color={inputText.trim() === '' ? '#9CA3AF' : '#fff'} />
        </TouchableOpacity>
      </View>
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
  attachButton: { width: 40, height: 44, justifyContent: 'center', alignItems: 'center', marginRight: 8 },
  input: { flex: 1, backgroundColor: t.inputFilled, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, paddingTop: 10, maxHeight: 100, fontFamily: Fonts.poppins, fontSize: 14, color: t.textPrimary },
  sendButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFCE48', justifyContent: 'center', alignItems: 'center', marginLeft: 12 },
  sendButtonDisabled: { backgroundColor: t.inputFilled },
}); }
