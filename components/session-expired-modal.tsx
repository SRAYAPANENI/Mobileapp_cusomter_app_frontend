import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { AlertTriangle } from 'lucide-react-native';
import React from 'react';
import { Modal, StyleSheet, TouchableOpacity, View } from 'react-native';

// Matches app/profile.tsx's own "Custom Alert Modal" error styling — a
// plain native Alert.alert() here looked jarringly out of place against the
// rest of the app's branded modals right when a user is already unsettled
// by getting signed out unexpectedly.
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
        <View style={styles.container}>
          <View style={styles.iconCircle}>
            <AlertTriangle size={32} color="#EF4444" />
          </View>
          <ThemedText style={styles.title}>Signed Out</ThemedText>
          <ThemedText style={styles.message}>Your session has ended. Please log in again.</ThemedText>
          <TouchableOpacity style={styles.button} onPress={onDismiss}>
            <ThemedText style={styles.buttonText}>OK</ThemedText>
          </TouchableOpacity>
        </View>
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
      padding: 20,
    },
    container: {
      backgroundColor: t.card,
      borderRadius: 24,
      padding: 32,
      alignItems: 'center',
      borderTopWidth: 4,
      borderTopColor: '#EF4444',
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 20,
      elevation: 10,
    },
    iconCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: '#FEF2F2',
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 20,
    },
    title: {
      fontSize: 20,
      lineHeight: 26,
      fontFamily: Fonts.poppinsBold,
      color: t.textPrimary,
      marginBottom: 8,
      textAlign: 'center',
    },
    message: {
      fontSize: 14,
      fontFamily: Fonts.poppins,
      color: t.textSecondary,
      textAlign: 'center',
      marginBottom: 24,
      lineHeight: 20,
    },
    button: {
      width: '100%',
      height: 48,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: '#EF4444',
    },
    buttonText: {
      fontSize: 16,
      lineHeight: 22,
      fontFamily: Fonts.poppinsBold,
      color: '#fff',
    },
  });
}
