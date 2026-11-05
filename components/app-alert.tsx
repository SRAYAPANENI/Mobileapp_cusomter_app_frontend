import { Fonts } from '@/constants/theme';
import {
  AlertTriangle,
  Check,
  Copy,
  Info,
  X,
} from 'lucide-react-native';
import React, { useEffect } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { ThemedText } from './themed-text';

export type AlertType = 'success' | 'error' | 'warning' | 'info' | 'copied';

export interface AlertButton {
  text: string;
  onPress?: () => void;
  /** primary: the main action, brand yellow. secondary: outlined, for
   * "Keep", "Not now". destructive: red, for actions that remove, cancel or
   * end something. */
  variant?: 'primary' | 'secondary' | 'destructive';
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

// The dialog is the same neutral card whatever it says. Its meaning is
// carried by one small tinted icon, never by the card or the buttons, so a
// success, an error and a question read as one family. The main button is
// always the brand's; red is kept for actions that remove or end something.
const TONE: Record<AlertType, { icon: React.FC<{ size: number; color: string; strokeWidth?: number }>; fg: string; bg: string }> = {
  success: { icon: Check, fg: '#047857', bg: '#ECFDF5' },
  copied: { icon: Copy, fg: '#047857', bg: '#ECFDF5' },
  error: { icon: X, fg: '#B91C1C', bg: '#FEF2F2' },
  warning: { icon: AlertTriangle, fg: '#B45309', bg: '#FFFBEB' },
  info: { icon: Info, fg: '#1D4ED8', bg: '#EFF6FF' },
};

const C = {
  scrim: 'rgba(15, 23, 42, 0.48)',
  surface: '#FFFFFF',
  title: '#0F172A',
  body: '#475569',
  border: '#E2E8F0',
  brand: '#FFCE48',
  brandPressed: '#F5BE2E',
  onBrand: '#111827',
  danger: '#DC2626',
  dangerPressed: '#B91C1C',
  neutralPressed: '#F1F5F9',
};

// A long message scrolls inside the card, so the buttons stay on screen.
const MESSAGE_MAX_HEIGHT = Math.round(Dimensions.get('window').height * 0.45);

export function AppAlert({
  visible,
  type,
  title,
  message,
  buttons,
  autoDismissMs,
  onDismiss,
}: AppAlertProps) {
  const tone = TONE[type];
  const Icon = tone.icon;
  // Every press already closes the alert (onDismiss below), so OK needs no
  // handler of its own — giving it onDismiss too closed it twice.
  const actions: AlertButton[] = buttons ?? [{ text: 'OK' }];
  // Two actions sit side by side (the main one on the right); more stack,
  // so no label is ever squeezed.
  const stacked = actions.length > 2;

  useEffect(() => {
    if (visible && autoDismissMs) {
      const t = setTimeout(() => onDismiss?.(), autoDismissMs);
      return () => clearTimeout(t);
    }
  }, [visible, autoDismissMs]);

  return (
    // One steady fade, from the Modal alone. The card used to spring in from
    // nothing (overshooting, so it bounced up and down) while the backdrop
    // faded in a second time on top of the Modal's own fade.
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onDismiss}>
      <View style={styles.scrim}>
        <View style={styles.card} accessibilityViewIsModal accessibilityRole="alert">
          {/* The icon beside the words, not above them: one glance reads
              what kind of message it is and what it says. */}
          <View style={styles.head}>
            <View style={[styles.badge, { backgroundColor: tone.bg }]}>
              <Icon size={20} color={tone.fg} strokeWidth={2.4} />
            </View>
            <View style={styles.words}>
              <ThemedText style={styles.title} accessibilityRole="header">{title}</ThemedText>
              {!!message && (
                <ScrollView style={{ maxHeight: MESSAGE_MAX_HEIGHT }} bounces={false} showsVerticalScrollIndicator={false}>
                  <ThemedText style={styles.message}>{message}</ThemedText>
                </ScrollView>
              )}
            </View>
          </View>

          <View style={[styles.actions, stacked && styles.actionsStacked]}>
            {actions.map((btn, i) => {
              const variant = btn.variant ?? 'primary';
              return (
                <Pressable
                  key={i}
                  accessibilityRole="button"
                  // Close first: a button that opens the next alert used to have
                  // it hidden again straight away, so it blinked or vanished.
                  onPress={() => { onDismiss?.(); btn.onPress?.(); }}
                  style={({ pressed }) => [
                    styles.button,
                    !stacked && { flex: 1 },
                    variant === 'primary' && { backgroundColor: pressed ? C.brandPressed : C.brand },
                    variant === 'destructive' && { backgroundColor: pressed ? C.dangerPressed : C.danger },
                    variant === 'secondary' && [styles.secondary, pressed && { backgroundColor: C.neutralPressed }],
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.buttonText,
                      variant === 'primary' && { color: C.onBrand },
                      variant === 'destructive' && { color: '#FFFFFF' },
                      variant === 'secondary' && { color: C.title },
                    ]}
                  >
                    {btn.text}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
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

  // Runs however the alert closes — a button, Back, or the auto-dismiss.
  const onCloseRef = React.useRef<(() => void) | undefined>(undefined);

  const show = (
    type: AlertType,
    title: string,
    message: string,
    buttons?: AlertButton[],
    autoDismissMs?: number,
    onClose?: () => void,
  ) => {
    onCloseRef.current = onClose;
    setState({ visible: true, type, title, message, buttons, autoDismissMs });
  };

  const hide = () => {
    setState(s => ({ ...s, visible: false }));
    const onClose = onCloseRef.current;
    onCloseRef.current = undefined;
    onClose?.();
  };

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
  scrim: {
    flex: 1,
    backgroundColor: C.scrim,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 24,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 32,
    elevation: 8,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // At least the icon's height, centred: a one-line title sits level with
  // the icon; a longer one, or a message, runs on below.
  words: {
    flex: 1,
    minHeight: 40,
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontFamily: Fonts.poppinsSemiBold,
    color: C.title,
  },
  message: {
    marginTop: 6,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: Fonts.poppins,
    color: C.body,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 24,
  },
  actionsStacked: {
    flexDirection: 'column-reverse',
  },
  button: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondary: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  buttonText: {
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 20,
    fontFamily: Fonts.poppinsSemiBold,
  },
});
