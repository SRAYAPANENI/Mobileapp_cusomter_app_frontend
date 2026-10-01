import React, { useState } from 'react';
import { Modal, View, TouchableOpacity, TextInput, Platform, StyleSheet } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from './themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SkoFyApi } from '@/services/api';
import { AlertTriangle } from 'lucide-react-native';

const MIN_REASON_LENGTH = 5;

interface DisputeModalProps {
  visible: boolean;
  jobId: string;
  onClose: () => void;
  // Backend only accepts this for a job that's IN_PROGRESS or COMPLETED —
  // callers are expected to only show the trigger for jobs in those states.
  onDisputed: (message: string) => void;
}

export function DisputeModal({ visible, jobId, onClose, onDisputed }: DisputeModalProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = reason.trim().length >= MIN_REASON_LENGTH && !submitting;

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      await SkoFyApi.jobs.disputeJob(jobId, reason.trim());
      setReason('');
      onDisputed('Our team will review this and get back to you within 24 hours.');
    } catch (err: any) {
      setError(err?.message ?? 'Failed to file dispute. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior="padding" automaticOffset>
        <View style={[styles.reasonModalContainer, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 40 : 24) + 12 }]}>
          <View style={styles.modalIndicator} />
          <View style={styles.titleRow}>
            <AlertTriangle size={20} color="#EF4444" />
            <ThemedText style={styles.modalTitle}>File a Dispute</ThemedText>
          </View>
          <ThemedText style={styles.modalSubtitle}>
            Describe the issue clearly. Our team will review and respond within 24 hours.
          </ThemedText>

          <TextInput
            style={styles.otherInput}
            placeholder="Describe the problem (e.g. provider didn't show up, work quality issue)..."
            placeholderTextColor="#9CA3AF"
            multiline
            value={reason}
            onChangeText={setReason}
          />

          {error && <ThemedText style={styles.errorText}>{error}</ThemedText>}

          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={onClose}>
              <ThemedText style={styles.modalCloseBtnText}>Cancel</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmCancelBtn, !canSubmit && { opacity: 0.5 }]}
              disabled={!canSubmit}
              onPress={handleConfirm}
            >
              <ThemedText style={styles.confirmCancelBtnText}>
                {submitting ? 'Submitting...' : 'Submit Dispute'}
              </ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(t: typeof Colors.light) {
  return StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    reasonModalContainer: {
      backgroundColor: t.modalBackground,
      borderTopLeftRadius: 32,
      borderTopRightRadius: 32,
      padding: 24,
      paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    },
    modalIndicator: {
      width: 40,
      height: 4,
      backgroundColor: t.inputFilled,
      borderRadius: 2,
      alignSelf: 'center',
      marginBottom: 20,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    modalTitle: {
      fontSize: 20, lineHeight: 25,
      fontFamily: Fonts.poppinsBold,
      color: t.textPrimary,
    },
    modalSubtitle: {
      fontSize: 14, lineHeight: 18,
      fontFamily: Fonts.poppins,
      color: t.textSecondary,
      marginTop: 4,
      marginBottom: 24,
    },
    otherInput: {
      backgroundColor: t.surface,
      borderRadius: 12,
      padding: 16,
      fontSize: 14, lineHeight: 18,
      fontFamily: Fonts.poppins,
      color: t.textPrimary,
      minHeight: 100,
      textAlignVertical: 'top',
      borderWidth: 1,
      borderColor: t.inputFilled,
    },
    errorText: {
      color: '#EF4444',
      fontSize: 13, lineHeight: 17,
      fontFamily: Fonts.poppinsSemiBold,
      marginTop: 12,
      textAlign: 'center',
    },
    modalFooter: {
      flexDirection: 'row',
      gap: 16,
      marginTop: 24,
    },
    modalCloseBtn: {
      flex: 1,
      height: 56,
      borderRadius: 28,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: t.inputFilled,
    },
    modalCloseBtnText: {
      fontSize: 16, lineHeight: 20,
      fontFamily: Fonts.poppinsBold,
      color: t.textSecondary,
    },
    confirmCancelBtn: {
      flex: 2,
      height: 56,
      borderRadius: 28,
      backgroundColor: '#EF4444',
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: '#EF4444',
      shadowOpacity: 0.2,
      shadowRadius: 10,
      elevation: 4,
    },
    confirmCancelBtnText: {
      fontSize: 16, lineHeight: 20,
      fontFamily: Fonts.poppinsBold,
      color: '#fff',
    },
  });
}
