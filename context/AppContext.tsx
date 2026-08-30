import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { AlertTriangle, Check, X } from 'lucide-react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import React, { createContext, ReactNode, useContext, useState } from 'react';
import { Modal, StyleSheet, TouchableOpacity, View } from 'react-native';

type FeedbackType = 'success' | 'error' | 'info';

interface FeedbackConfig {
  visible: boolean;
  type: FeedbackType;
  title: string;
  message: string;
  onConfirm?: () => void;
}

interface AppContextType {
  showFeedback: (type: FeedbackType, title: string, message: string, onConfirm?: () => void) => void;
  hideFeedback: () => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];

  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackConfig>({
    visible: false,
    type: 'success',
    title: '',
    message: '',
  });

  const showFeedback = (type: FeedbackType, title: string, message: string, onConfirm?: () => void) => {
    setFeedback({ visible: true, type, title, message, onConfirm });
  };

  const hideFeedback = () => {
    setFeedback(prev => ({ ...prev, visible: false }));
  };

  return (
    <AppContext.Provider value={{
      showFeedback,
      hideFeedback,
      isLoading: loading,
      setIsLoading: setLoading,
    }}>
      {children}

      {/* Global Feedback Modal */}
      <Modal visible={feedback.visible} transparent animationType="fade">
        <View style={styles.overlay}>
          <Animated.View entering={FadeIn.duration(300)} style={StyleSheet.absoluteFillObject}>
            <View style={styles.blur} />
          </Animated.View>

          <Animated.View entering={ZoomIn.duration(400).springify()} style={styles.card}>
            <View style={[
              styles.iconCircle,
              { backgroundColor: feedback.type === 'success' ? '#10B981' : feedback.type === 'error' ? '#EF4444' : '#F59E0B' }
            ]}>
              {feedback.type === 'success' && <Check size={32} color="#fff" />}
              {feedback.type === 'error' && <X size={32} color="#fff" />}
              {feedback.type === 'info' && <AlertTriangle size={32} color="#fff" />}
            </View>

            <ThemedText style={styles.title}>{feedback.title}</ThemedText>
            <ThemedText style={styles.message}>{feedback.message}</ThemedText>

            <TouchableOpacity
              style={[styles.button, { backgroundColor: themeColors.brand }]}
              onPress={() => {
                hideFeedback();
                feedback.onConfirm?.();
              }}
            >
              <ThemedText style={styles.buttonText}>Got it</ThemedText>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>

      {/* Global Loading Overlay */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <Animated.View entering={FadeIn} style={styles.loadingBox}>
            <View style={[styles.loadingIndicator, { borderColor: themeColors.brand }]} />
            <ThemedText style={styles.loadingText}>Please wait...</ThemedText>
          </Animated.View>
        </View>
      )}
    </AppContext.Provider>
  );
}

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppContext must be used within AppProvider');
  return context;
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  blur: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 32,
    padding: 32,
    width: '100%',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontFamily: Fonts.poppinsBold,
    color: '#111827',
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    fontFamily: Fonts.poppins,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  button: {
    width: '100%',
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontFamily: Fonts.poppinsBold,
    color: '#000',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  loadingBox: {
    backgroundColor: '#fff',
    padding: 24,
    borderRadius: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  loadingIndicator: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 4,
    borderTopColor: 'transparent',
    marginBottom: 16,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: Fonts.poppinsSemiBold,
    color: '#374151',
  },
});
