import { useAppAlert } from '@/components/app-alert';
import { TextInput } from '@/components/scaled-text';
import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { SkoFyApi } from '@/services/api';
import { goodsHoldAmount, goodsSplitPreview, shoppingFee } from '@/services/pickupOptions';
import React, { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

// Pickup & Drop cards on the tracking screen. The screen passes its own card
// styles so these look like the cards around them.
type CardStyles = { inspectionCard: object; inspectionCardTitle: object; inspectionCardBody: object; completeJobBtn: object; completeJobBtnText: object };

/** Buy it for me: hold the shopping money before the provider buys anything. */
export function GoodsHoldCard({ limit, paying, onPay, styles }: {
  limit: number; paying: boolean; onPay: () => void; styles: CardStyles;
}) {
  return (
    <View style={styles.inspectionCard}>
      <ThemedText style={styles.inspectionCardTitle}>Hold the shopping money</ThemedText>
      <ThemedText style={styles.inspectionCardBody}>
        {`We hold $${goodsHoldAmount(limit).toFixed(2)} — items up to $${limit.toFixed(2)} plus a shopping fee up to $${shoppingFee(limit).toFixed(2)} — and the card fee. ` +
          "You're charged only for what's bought (5% shopping fee, $1.99 minimum); the rest comes back to you."}
      </ThemedText>
      <TouchableOpacity style={styles.completeJobBtn} onPress={onPay} disabled={paying}>
        <ThemedText style={styles.completeJobBtnText}>{paying ? 'Processing…' : 'Hold Money'}</ThemedText>
      </TouchableOpacity>
    </View>
  );
}

/** After pickup: what the items cost and what comes back. */
export function goodsReceiptLine(limit: number, goods: number): string {
  const { fee, back } = goodsSplitPreview(limit, goods);
  return `Items: $${goods.toFixed(2)} · shopping fee $${fee.toFixed(2)} · $${back.toFixed(2)} comes back to you when the job ends.`;
}

/** Already paid: add or change the store's pickup code until it's collected. */
export function PickupCodeEditor({ jobId, code, styles }: { jobId: string; code: string | null; styles: CardStyles }) {
  const appAlert = useAppAlert();
  const [text, setText] = useState(code ?? '');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setText(code ?? ''); }, [code]);
  const changed = text.trim() !== (code ?? '') && text.trim().length > 0;

  const save = async () => {
    setSaving(true);
    try {
      await SkoFyApi.jobs.updatePickupCode(jobId, text.trim());
      appAlert.show('success', 'Pickup code sent', 'Your provider can see it now.');
    } catch (e: any) {
      appAlert.show('error', 'Could not save', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.inspectionCard}>
      <ThemedText style={styles.inspectionCardTitle}>Store pickup code</ThemedText>
      <ThemedText style={styles.inspectionCardBody}>
        If the store sent you a code for this order, add it here — only your provider sees it.
      </ThemedText>
      <View style={s.row}>
        <TextInput
          style={s.input}
          value={text}
          onChangeText={setText}
          placeholder="e.g. 4471"
          placeholderTextColor="#9CA3AF"
          autoCapitalize="characters"
          maxLength={40}
          editable={!saving}
        />
        <TouchableOpacity style={[s.save, !changed && s.saveOff]} onPress={save} disabled={!changed || saving}>
          <ThemedText style={s.saveText}>{saving ? 'Saving…' : code ? 'Update' : 'Send'}</ThemedText>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, marginTop: 10 },
  input: { flex: 1, height: 44, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 12, backgroundColor: '#fff', fontSize: 15, fontFamily: Fonts.poppinsSemiBold, color: '#111827' },
  save: { height: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: '#10B981', justifyContent: 'center' },
  saveOff: { opacity: 0.5 },
  saveText: { color: '#fff', fontSize: 14, lineHeight: 20, fontFamily: Fonts.poppinsBold },
});
