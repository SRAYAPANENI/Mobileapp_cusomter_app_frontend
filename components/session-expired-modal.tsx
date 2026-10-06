import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { LogOut } from 'lucide-react-native';
import React from 'react';
import { Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';

// Matches login.tsx's own exit-confirmation modal — same card shape, shadow
// and spring-in entrance — rather than a flat, un-animated red "danger"
// alert. A session expiring isn't a destructive action the user took, so it
// uses the app's actual brand color (same as every primary CTA elsewhere)
// instead of a generic red/amber warning treatment that clashed with the
// rest of the app's look.
export default function SessionExpiredModal({
  visible,
  onDismiss,
}: {
  visible: boolean;
  onDismiss: () => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <Animated.View entering={FadeInUp.duration(400)} style={styles.container}>
          <View style={styles.iconCircle}>
            <LogOut size={30} color={themeColors.brand} />
          </View>
          <ThemedText style={styles.title}>Signed Out</ThemedText>
          <ThemedText style={styles.message}>Your session has ended. Please log in again.</ThemedText>
          <TouchableOpacity style={[styles.button, { backgroundColor: themeColors.brand }]} onPress={onDismiss}>
            <ThemedText style={styles.buttonText}>OK</ThemedText>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

function makeStyles(t: typeof Colors.light) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      padding: 24,
    },
    container: {
      backgroundColor: t.modalBackground,
      borderRadius: 32,
      padding: 32,
      alignItems: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.1,
      shadowRadius: 20,
      elevation: 5,
    },
    iconCircle: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: '#FFFBEB',
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 20,
    },
    title: {
      fontSize: 22,
      lineHeight: 28,
      fontFamily: Fonts.poppinsBold,
      color: t.textPrimary,
      marginBottom: 8,
      textAlign: 'center',
    },
    message: {
      fontSize: 15,
      fontFamily: Fonts.poppins,
      color: t.textSecondary,
      textAlign: 'center',
      marginBottom: 28,
      lineHeight: 22,
    },
    button: {
      width: '100%',
      height: 56,
      borderRadius: 16,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: '#FFCE48',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.4,
      shadowRadius: 12,
      elevation: 8,
    },
    buttonText: {
      fontSize: 16,
      lineHeight: 22,
      fontFamily: Fonts.poppinsBold,
      color: '#000',
    },
  });
}
