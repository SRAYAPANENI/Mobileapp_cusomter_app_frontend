import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { CheckoutBreakdown, CheckoutOffer, SkoFyApi } from '@/services/api';
import * as Haptics from 'expo-haptics';
import { BadgePercent, CheckCircle2, Tag } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface CheckoutSheetProps {
  visible: boolean;
  jobId: string;
  /** Pays with the applied offer code (or none). Resolves when the payment
   *  flow finishes — the sheet shows a spinner until then. */
  onPay: (offerCode: string | null) => Promise<void>;
  onClose: () => void;
}

// Same semantic colours the rest of the app uses for "success / saving"
// (status badges) and errors — kept together so the sheet stays in sync.
const SUCCESS = '#10B981';
const ERROR = '#EF4444';

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * Job-cost checkout — offers the customer can use, a promo code field, and
 * the bill, then Pay. Follows the app's bottom-sheet conventions
 * (cancel-job-modal.tsx): grab handle, title + subtitle, 32px corners,
 * safe-area bottom padding, keyboard-aware, Go Back / primary footer.
 *
 * All amounts come from the server (the discount is taken out of Dodorez's
 * fee and the provider's share never changes) — nothing is calculated here.
 */
export function CheckoutSheet({ visible, jobId, onPay, onClose }: CheckoutSheetProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const t = Colors[colorScheme];
  const s = useMemo(() => makeStyles(t), [colorScheme]);
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [offers, setOffers] = useState<CheckoutOffer[]>([]);
  const [breakdown, setBreakdown] = useState<CheckoutBreakdown | null>(null);
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [applyingCode, setApplyingCode] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setAppliedCode(null);
    setCodeInput('');
    setCodeError(null);
    try {
      const [available, preview] = await Promise.all([
        SkoFyApi.jobs.invoiceOffers(jobId).catch(() => [] as CheckoutOffer[]),
        SkoFyApi.jobs.previewInvoicePayment(jobId),
      ]);
      setOffers(available);
      setBreakdown(preview);
    } catch (err: any) {
      setLoadError(err?.message ?? "Couldn't load the payment details.");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => { if (visible) load(); }, [visible, load]);

  const applyCode = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed || applyingCode) return;
    setApplyingCode(trimmed.toUpperCase());
    setCodeError(null);
    try {
      const preview = await SkoFyApi.jobs.previewInvoicePayment(jobId, trimmed);
      setBreakdown(preview);
      setAppliedCode(preview.offer?.code ?? trimmed.toUpperCase());
      setCodeInput('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err: any) {
      setCodeError(err?.message ?? "This code can't be used.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setApplyingCode(null);
    }
  };

  const removeCode = async () => {
    setAppliedCode(null);
    setCodeError(null);
    try {
      setBreakdown(await SkoFyApi.jobs.previewInvoicePayment(jobId));
    } catch { /* keep the last bill — paying re-checks on the server anyway */ }
  };

  const pay = async () => {
    setPaying(true);
    try {
      await onPay(appliedCode);
    } finally {
      setPaying(false);
    }
  };

  const close = () => { if (!paying) onClose(); };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={s.overlay} behavior="padding" automaticOffset>
        <View style={[s.container, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 40 : 24) + 12 }]}>
          <View style={s.handle} />
          <ThemedText style={s.title}>Checkout</ThemedText>
          <ThemedText style={s.subtitle}>Apply an offer or promo code before you pay</ThemedText>

          {loading ? (
            <View style={{ gap: 12 }} accessibilityLabel="Loading payment details">
              <Skeleton height={64} borderRadius={12} />
              <Skeleton height={50} borderRadius={12} />
              <Skeleton height={130} borderRadius={16} />
            </View>
          ) : loadError || !breakdown ? (
            <View style={{ gap: 16 }}>
              <ThemedText style={s.errorText}>{loadError ?? "Couldn't load the payment details."}</ThemedText>
              <View style={s.footer}>
                <TouchableOpacity style={s.secondaryBtn} onPress={close} accessibilityRole="button">
                  <ThemedText style={s.secondaryBtnText}>Go Back</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity style={s.primaryBtn} onPress={load} accessibilityRole="button">
                  <ThemedText style={s.primaryBtnText}>Try Again</ThemedText>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
              <ScrollView
                style={s.scroll}
                contentContainerStyle={{ gap: 20 }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {offers.length > 0 && (
                  <View style={{ gap: 10 }}>
                    <ThemedText style={s.sectionLabel}>Offers for you</ThemedText>
                    {offers.map(o => {
                      const applied = appliedCode === o.code;
                      const busy = applyingCode === o.code;
                      return (
                        <TouchableOpacity
                          key={o.offer_id}
                          style={[s.offerItem, applied && s.offerItemSelected, !o.usable && s.offerItemDisabled]}
                          disabled={!o.usable || applied || !!applyingCode || paying}
                          onPress={() => applyCode(o.code)}
                          activeOpacity={0.8}
                          accessibilityRole="button"
                          accessibilityState={{ selected: applied, disabled: !o.usable }}
                          accessibilityLabel={`${o.title}, code ${o.code}. ${o.usable ? `Saves ${money(o.discount)}` : o.unusable_reason}`}
                        >
                          <BadgePercent size={22} color={o.usable ? SUCCESS : t.textMuted} />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <ThemedText style={[s.offerTitle, !o.usable && { color: t.textMuted }]} numberOfLines={1}>
                              {o.title}
                            </ThemedText>
                            <ThemedText style={[s.offerSub, { color: o.usable ? SUCCESS : t.textMuted }]} numberOfLines={2}>
                              {o.usable ? `Save ${money(o.discount)} · ${o.code}` : o.unusable_reason}
                            </ThemedText>
                          </View>
                          {busy ? (
                            <ActivityIndicator size="small" color={t.textPrimary} />
                          ) : applied ? (
                            <CheckCircle2 size={22} color={SUCCESS} />
                          ) : o.usable ? (
                            <ThemedText style={s.offerAction}>Apply</ThemedText>
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                <View style={{ gap: 10 }}>
                  <ThemedText style={s.sectionLabel}>Promo code</ThemedText>
                  {appliedCode ? (
                    <View style={s.appliedRow}>
                      <Tag size={18} color={SUCCESS} />
                      <ThemedText style={s.appliedText}>{appliedCode} applied</ThemedText>
                      <TouchableOpacity onPress={removeCode} disabled={paying} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove code ${appliedCode}`}>
                        <ThemedText style={s.removeText}>Remove</ThemedText>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={s.codeRow}>
                      <TextInput
                        style={[s.codeInput, !!codeError && { borderColor: ERROR }]}
                        placeholder="Enter code"
                        placeholderTextColor={t.textMuted}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        returnKeyType="done"
                        value={codeInput}
                        onChangeText={text => { setCodeInput(text); setCodeError(null); }}
                        onSubmitEditing={() => applyCode(codeInput)}
                        maxLength={20}
                        editable={!paying}
                        accessibilityLabel="Promo code"
                      />
                      <TouchableOpacity
                        style={[s.applyBtn, (!codeInput.trim() || !!applyingCode) && { opacity: 0.5 }]}
                        onPress={() => applyCode(codeInput)}
                        disabled={!codeInput.trim() || !!applyingCode || paying}
                        accessibilityRole="button"
                      >
                        {applyingCode && !offers.some(o => o.code === applyingCode)
                          ? <ActivityIndicator size="small" color="#111827" />
                          : <ThemedText style={s.applyBtnText}>Apply</ThemedText>}
                      </TouchableOpacity>
                    </View>
                  )}
                  {codeError && <ThemedText style={s.errorText}>{codeError}</ThemedText>}
                </View>

                <View style={s.bill} accessibilityLabel={`Total ${money(breakdown.total)}`}>
                  <BillRow label="Job amount" value={money(breakdown.job_amount)} s={s} />
                  {breakdown.discount > 0 && (
                    <BillRow
                      label={appliedCode ? `Offer (${appliedCode})` : 'Offer'}
                      value={`−${money(breakdown.discount)}`}
                      s={s}
                      valueColor={SUCCESS}
                    />
                  )}
                  <BillRow label="Card processing fee" value={money(breakdown.processing_fee)} s={s} />
                  <View style={s.divider} />
                  <BillRow label="Total" value={money(breakdown.total)} s={s} total />
                  {breakdown.discount > 0 && (
                    <ThemedText style={s.savingNote}>You're saving {money(breakdown.discount)} on this job</ThemedText>
                  )}
                </View>
              </ScrollView>

              <View style={s.footer}>
                <TouchableOpacity style={s.secondaryBtn} onPress={close} disabled={paying} accessibilityRole="button">
                  <ThemedText style={s.secondaryBtnText}>Go Back</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.primaryBtn, (paying || !!applyingCode) && { opacity: 0.7 }]}
                  onPress={pay}
                  disabled={paying || !!applyingCode}
                  accessibilityRole="button"
                  accessibilityLabel={`Pay ${money(breakdown.total)}`}
                >
                  {paying
                    ? <ActivityIndicator color="#111827" />
                    : <ThemedText style={s.primaryBtnText}>Pay {money(breakdown.total)}</ThemedText>}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function BillRow({ label, value, s, total, valueColor }: {
  label: string; value: string; s: ReturnType<typeof makeStyles>; total?: boolean; valueColor?: string;
}) {
  return (
    <View style={s.billRow}>
      <ThemedText style={total ? s.billTotalLabel : s.billLabel}>{label}</ThemedText>
      <ThemedText style={[total ? s.billTotalValue : s.billValue, valueColor ? { color: valueColor } : null]}>{value}</ThemedText>
    </View>
  );
}

function makeStyles(t: typeof Colors.light) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    container: {
      backgroundColor: t.modalBackground,
      borderTopLeftRadius: 32,
      borderTopRightRadius: 32,
      padding: 24,
      maxHeight: '90%',
    },
    handle: { width: 40, height: 4, backgroundColor: t.inputFilled, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
    title: { fontSize: 20, lineHeight: 25, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
    subtitle: { fontSize: 14, lineHeight: 18, fontFamily: Fonts.poppins, color: t.textSecondary, marginTop: 4, marginBottom: 20 },
    scroll: { flexGrow: 0 },
    sectionLabel: { fontSize: 13, lineHeight: 17, fontFamily: Fonts.poppinsSemiBold, color: t.textSecondary },

    // Offer rows use the same item / selected look as cancel-job-modal's reasons.
    offerItem: {
      flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12,
      backgroundColor: t.surface, borderWidth: 1, borderColor: t.inputFilled,
    },
    offerItemSelected: { backgroundColor: '#FFFBEB', borderColor: '#FFCE48' },
    offerItemDisabled: { opacity: 0.7 },
    offerTitle: { fontSize: 15, lineHeight: 19, fontFamily: Fonts.poppinsSemiBold, color: t.textPrimary },
    offerSub: { fontSize: 12, lineHeight: 16, fontFamily: Fonts.poppinsSemiBold, marginTop: 2 },
    offerAction: { fontSize: 14, lineHeight: 18, fontFamily: Fonts.poppinsBold, color: t.textPrimary },

    codeRow: { flexDirection: 'row', gap: 10 },
    codeInput: {
      flex: 1, backgroundColor: t.surface, borderRadius: 12, borderWidth: 1, borderColor: t.inputFilled,
      paddingHorizontal: 16, paddingVertical: 14, fontFamily: Fonts.poppinsSemiBold, fontSize: 15,
      color: t.textPrimary, letterSpacing: 1,
    },
    applyBtn: { backgroundColor: '#FFCE48', borderRadius: 12, paddingHorizontal: 20, minWidth: 84, justifyContent: 'center', alignItems: 'center' },
    applyBtnText: { fontSize: 15, lineHeight: 19, fontFamily: Fonts.poppinsBold, color: '#111827' },
    appliedRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 12,
      backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FFCE48',
    },
    appliedText: { flex: 1, fontSize: 15, lineHeight: 19, fontFamily: Fonts.poppinsSemiBold, color: '#111827' },
    removeText: { fontSize: 14, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: t.textSecondary },
    errorText: { color: ERROR, fontSize: 13, lineHeight: 17, fontFamily: Fonts.poppinsSemiBold },

    bill: { gap: 10, padding: 16, borderRadius: 16, backgroundColor: t.surface },
    billRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    billLabel: { fontSize: 14, lineHeight: 18, fontFamily: Fonts.poppins, color: t.textSecondary },
    billValue: { fontSize: 14, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: t.textPrimary },
    billTotalLabel: { fontSize: 16, lineHeight: 20, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
    billTotalValue: { fontSize: 18, lineHeight: 22, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
    divider: { height: 1, backgroundColor: t.border },
    savingNote: { fontSize: 12, lineHeight: 16, fontFamily: Fonts.poppinsSemiBold, color: SUCCESS, textAlign: 'right' },

    // Footer pair — same sizes as cancel-job-modal's Go Back / confirm.
    footer: { flexDirection: 'row', gap: 16, marginTop: 20 },
    secondaryBtn: { flex: 1, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', backgroundColor: t.inputFilled },
    secondaryBtnText: { fontSize: 16, lineHeight: 20, fontFamily: Fonts.poppinsBold, color: t.textSecondary },
    primaryBtn: {
      flex: 2, height: 56, borderRadius: 28, backgroundColor: '#FFCE48', justifyContent: 'center', alignItems: 'center',
      shadowColor: '#FFCE48', shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
    },
    primaryBtnText: { fontSize: 16, lineHeight: 20, fontFamily: Fonts.poppinsBold, color: '#111827' },
  });
}
