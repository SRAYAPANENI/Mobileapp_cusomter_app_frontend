import React, { useState } from 'react';
import { Modal, View, TouchableOpacity, TextInput, Platform, StyleSheet } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from './themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SkoFyApi } from '@/services/api';
import { AlertTriangle } from 'lucide-react-native';

const PRE_HIRE_REASONS = [
  'Changed my mind',
  'Posted by mistake',
  'Found someone else',
  'Problem has been resolved',
  'Budget / pricing changed',
  'Other',
];

const AFTER_HIRE_REASONS = [
  'Emergency came up',
  'Provider is taking too long',
  'Problem has been resolved',
  'Found someone else',
  'Safety concern',
  'Other',
];

interface CancelJobModalProps {
  visible: boolean;
  jobId: string;
  scenario?: 'pre-hire' | 'after-hire';
  onClose: () => void;
  // Passed the server's outcome message — distinct wording depending on
  // whether the job reopened to other applicants or died outright, so the
  // caller can actually tell the customer which one happened instead of
  // just silently closing the modal.
  onCancelled: (message: string) => void;
}

export function CancelJobModal({ visible, jobId, scenario = 'pre-hire', onClose, onCancelled }: CancelJobModalProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const insets = useSafeAreaInsets();
  const reasons = scenario === 'after-hire' ? AFTER_HIRE_REASONS : PRE_HIRE_REASONS;
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [otherReason, setOtherReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (cancelling || !selectedReason) return;
    setError(null);
    setCancelling(true);
    try {
      const finalReason = selectedReason === 'Other' ? otherReason : selectedReason;
      const result = await SkoFyApi.jobs.cancel(jobId, finalReason || 'No reason');
      setSelectedReason(null);
      setOtherReason('');
      onCancelled(result?.message ?? 'Job cancelled.');
    } catch (err: any) {
      setError(err?.message ?? 'Failed to cancel this job. Please try again.');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior="padding" automaticOffset>
        <View style={[styles.reasonModalContainer, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 40 : 24) + 12 }]}>
          <View style={styles.modalIndicator} />
          <ThemedText style={styles.modalTitle}>
            {scenario === 'after-hire' ? 'Cancel Booking' : 'Cancel Job Posting'}
          </ThemedText>
          <ThemedText style={styles.modalSubtitle}>Please select a reason for cancelling</ThemedText>

          {scenario === 'after-hire' && (
            <View style={styles.warningBanner}>
              <AlertTriangle size={16} color="#D97706" />
              <ThemedText style={styles.warningText}>
                The provider is already on their way. Frequent cancellations may affect your account.
              </ThemedText>
            </View>
          )}

          <View style={styles.reasonsList}>
            {reasons.map((reason) => (
              <TouchableOpacity
                key={reason}
                style={[styles.reasonItem, selectedReason === reason && styles.reasonItemSelected]}
                onPress={() => setSelectedReason(reason)}
              >
                <View style={[styles.reasonRadio, selectedReason === reason && styles.reasonRadioSelected]}>
                  {selectedReason === reason && <View style={styles.reasonRadioInner} />}
                </View>
                <ThemedText style={[styles.reasonText, selectedReason === reason && styles.reasonTextSelected]}>
                  {reason}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>

          {selectedReason === 'Other' && (
            <TextInput
              style={styles.otherInput}
              placeholder="Please specify your reason..."
              placeholderTextColor="#9CA3AF"
              multiline
              value={otherReason}
              onChangeText={setOtherReason}
            />
          )}

          {error && <ThemedText style={styles.errorText}>{error}</ThemedText>}

          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={onClose}>
              <ThemedText style={styles.modalCloseBtnText}>Go Back</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.confirmCancelBtn,
                (!selectedReason || cancelling || (selectedReason === 'Other' && !otherReason.trim())) && { opacity: 0.5 },
              ]}
              disabled={!selectedReason || (selectedReason === 'Other' && !otherReason.trim()) || cancelling}
              onPress={handleConfirm}
            >
              <ThemedText style={styles.confirmCancelBtnText}>
                {cancelling ? 'Cancelling...' : 'Confirm Cancel'}
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
    warningBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      backgroundColor: '#FFFBEB',
      borderWidth: 1,
      borderColor: '#FDE68A',
      borderRadius: 12,
      padding: 12,
      marginBottom: 16,
    },
    warningText: {
      flex: 1,
      fontSize: 13,
      fontFamily: Fonts.poppins,
      color: '#92400E',
      lineHeight: 18,
    },
    reasonsList: {
      gap: 12,
    },
    reasonItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
      borderRadius: 12,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.inputFilled,
    },
    reasonItemSelected: {
      backgroundColor: '#FFFBEB',
      borderColor: '#FFCE48',
    },
    reasonRadio: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: t.border,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
    },
    reasonRadioSelected: {
      borderColor: '#FFCE48',
    },
    reasonRadioInner: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: '#FFCE48',
    },
    reasonText: {
      fontSize: 15, lineHeight: 19,
      fontFamily: Fonts.poppinsSemiBold,
      color: t.textPrimary,
    },
    reasonTextSelected: {
      color: t.textPrimary,
      fontFamily: Fonts.poppinsBold,
    },
    otherInput: {
      backgroundColor: t.surface,
      borderRadius: 12,
      padding: 16,
      marginTop: 12,
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
