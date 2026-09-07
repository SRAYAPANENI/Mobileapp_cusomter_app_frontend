import { Fonts } from '@/constants/theme';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Info,
  XCircle,
} from 'lucide-react-native';
import React, { useEffect } from 'react';
import {
  Modal,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { ThemedText } from './themed-text';

export type AlertType = 'success' | 'error' | 'warning' | 'info' | 'copied';

export interface AlertButton {
  text: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary';
}

interface AppAlertProps {
  visible: boolean;
  type: AlertType;
  title: string;
  message: string;
  buttons?: AlertButton[];
  autoDismissMs?: number;
  onDismiss?: () => void;
}

const CONFIG: Record<AlertType, {
  icon: React.FC<{ size: number; color: string }>;
  iconColor: string;
  iconBg: string;
  borderColor: string;
  primaryBg: string;
  primaryText: string;
}> = {
  success: {
    icon: CheckCircle2,
    iconColor: '#10B981',
    iconBg: '#ECFDF5',
    borderColor: '#10B981',
    primaryBg: '#10B981',
    primaryText: '#fff',
  },
  error: {
    icon: XCircle,
    iconColor: '#EF4444',
    iconBg: '#FEF2F2',
    borderColor: '#EF4444',
    primaryBg: '#EF4444',
    primaryText: '#fff',
  },
  warning: {
    icon: AlertTriangle,
    iconColor: '#F59E0B',
    iconBg: '#FFFBEB',
    borderColor: '#F59E0B',
    primaryBg: '#FFCE48',
    primaryText: '#111827',
  },
  info: {
    icon: Info,
    iconColor: '#3B82F6',
    iconBg: '#EFF6FF',
    borderColor: '#3B82F6',
    primaryBg: '#3B82F6',
    primaryText: '#fff',
  },
  copied: {
    icon: Copy,
    iconColor: '#10B981',
    iconBg: '#ECFDF5',
    borderColor: '#10B981',
    primaryBg: '#FFCE48',
    primaryText: '#111827',
  },
};

export function AppAlert({
  visible,
  type,
  title,
  message,
  buttons,
  autoDismissMs,
  onDismiss,
}: AppAlertProps) {
  const cfg = CONFIG[type];
  const IconComp = cfg.icon;

  const defaultButtons: AlertButton[] = buttons ?? [{ text: 'OK', onPress: onDismiss }];

  useEffect(() => {
    if (visible && autoDismissMs) {
      const t = setTimeout(() => onDismiss?.(), autoDismissMs);
      return () => clearTimeout(t);
    }
  }, [visible, autoDismissMs]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Animated.View entering={FadeIn.duration(200)} style={styles.overlay}>
        <Animated.View entering={ZoomIn.springify().damping(14)} style={[styles.card, { borderTopColor: cfg.borderColor }]}>
          <View style={[styles.iconCircle, { backgroundColor: cfg.iconBg }]}>
            <IconComp size={32} color={cfg.iconColor} />
          </View>

          <ThemedText style={styles.title}>{title}</ThemedText>
          <ThemedText style={styles.message}>{message}</ThemedText>

          <View style={[styles.buttonRow, defaultButtons.length === 1 && { flexDirection: 'column' }]}>
            {defaultButtons.map((btn, i) => {
              const isPrimary = btn.variant !== 'secondary';
              return (
                <TouchableOpacity
                  key={i}
                  style={[
                    styles.button,
                    isPrimary
                      ? [styles.primaryButton, { backgroundColor: cfg.primaryBg }]
                      : styles.secondaryButton,
                    defaultButtons.length > 1 && { flex: 1 },
                  ]}
                  onPress={() => { btn.onPress?.(); onDismiss?.(); }}
                  activeOpacity={0.8}
                >
                  <ThemedText
                    style={[
                      styles.buttonText,
                      isPrimary ? { color: cfg.primaryText } : styles.secondaryButtonText,
                    ]}
                  >
                    {btn.text}
                  </ThemedText>
                </TouchableOpacity>
              );
            })}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

export function useAppAlert() {
  const [state, setState] = React.useState<{
    visible: boolean;
    type: AlertType;
    title: string;
    message: string;
    buttons?: AlertButton[];
    autoDismissMs?: number;
  }>({ visible: false, type: 'info', title: '', message: '' });

  const show = (
    type: AlertType,
    title: string,
    message: string,
    buttons?: AlertButton[],
    autoDismissMs?: number,
  ) => setState({ visible: true, type, title, message, buttons, autoDismissMs });

  const hide = () => setState(s => ({ ...s, visible: false }));

  const element = (
    <AppAlert
      visible={state.visible}
      type={state.type}
      title={state.title}
      message={state.message}
      buttons={state.buttons}
      autoDismissMs={state.autoDismissMs}
      onDismiss={hide}
    />
  );

  return { show, hide, element };
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 32,
    padding: 32,
    width: '100%',
    alignItems: 'center',
    borderTopWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.15,
    shadowRadius: 30,
    elevation: 12,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 20, lineHeight: 25,
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
    lineHeight: 21,
    marginBottom: 28,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  button: {
    height: 52,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButton: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  secondaryButton: {
    backgroundColor: '#F3F4F6',
  },
  buttonText: {
    fontSize: 15, lineHeight: 19,
    fontFamily: Fonts.poppinsBold,
  },
  secondaryButtonText: {
    color: '#374151',
  },
});
