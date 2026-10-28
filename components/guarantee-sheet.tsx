import { TextInput } from '@/components/scaled-text';
import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { GuaranteeInfo, PhotoFile, SkoFyApi } from '@/services/api';
import * as ImagePicker from 'expo-image-picker';
import { ShieldCheck } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

const MAX_PHOTOS = 4;

const STATUS_TEXT: Record<string, string> = {
  OPEN: "We've asked your provider to fix it first. If they can't, our team steps in.",
  FIX_OFFERED: "Your provider will come back and fix it at no charge — chat and calls are open again to arrange it.",
  FIXED: 'Fixed — this claim is closed.',
  REFUNDED: 'Refunded by Dodorez.',
  DECLINED: "Our team couldn't cover this one.",
};

interface Props {
  jobId: string | null;
  onClose: () => void;
  onMessage: (kind: 'success' | 'error' | 'info', title: string, message: string) => void;
}

// The Dodorez guarantee (docs/MONEY_RULES_DESIGN.md §12): the work failed
// within the guarantee window of a job paid in the app — the provider is
// asked to fix it free first, then Dodorez refunds or explains why not.
export function GuaranteeSheet({ jobId, onClose, onMessage }: Props) {
  const [info, setInfo] = useState<GuaranteeInfo | null>(null);
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [busy, setBusy] = useState(false);

  const load = () => { if (jobId) SkoFyApi.guarantee.get(jobId).then(setInfo).catch(() => onClose()); };
  useEffect(() => { setInfo(null); setDescription(''); setPhotos([]); load(); }, [jobId]);

  const addPhoto = async () => {
    if (photos.length >= MAX_PHOTOS) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled && result.assets[0]) {
      setPhotos((prev) => [...prev, { uri: result.assets[0].uri, mimeType: result.assets[0].mimeType || 'image/jpeg' }]);
    }
  };

  const run = async (action: () => Promise<{ message: string }>, title: string) => {
    setBusy(true);
    try {
      const result = await action();
      onMessage('success', title, result.message);
      load();
    } catch (err: any) {
      onMessage('error', 'Something went wrong', err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const claim = info?.claim;
  return (
    <Modal visible={!!jobId} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.row}>
            <ShieldCheck size={20} color="#059669" />
            <ThemedText style={s.title}>Dodorez guarantee</ThemedText>
          </View>
          {!info ? <ActivityIndicator color="#111827" /> : claim ? (
            <ScrollView style={{ maxHeight: 360 }}>
              <ThemedText style={s.body}>{STATUS_TEXT[claim.status]}</ThemedText>
              {claim.provider_note && <ThemedText style={s.muted}>Your provider: {claim.provider_note}</ThemedText>}
              {claim.decision_note && <ThemedText style={s.muted}>Our team: {claim.decision_note}</ThemedText>}
              {claim.refund_amount != null && <ThemedText style={s.body}>Refund: ${claim.refund_amount.toFixed(2)}</ThemedText>}
              {claim.status === 'FIX_OFFERED' && (busy ? <ActivityIndicator color="#111827" /> : (
                <View style={[s.row, { marginTop: 10 }]}>
                  <TouchableOpacity style={s.secondary} onPress={() => run(() => SkoFyApi.guarantee.result(jobId!, false), 'Sent to our team')}>
                    <ThemedText style={s.secondaryText}>Still not fixed</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.primary} onPress={() => run(() => SkoFyApi.guarantee.result(jobId!, true), 'Thanks')}>
                    <ThemedText style={s.primaryText}>It's fixed</ThemedText>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          ) : !info.can_claim ? (
            <ThemedText style={s.muted}>{info.reason}</ThemedText>
          ) : (
            <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
              <ThemedText style={s.muted}>
                Work paid in the app is covered for {info.days} days. Tell us what failed — your provider is asked to fix it
                at no charge first; if they can't, we refund you.
              </ThemedText>
              <TextInput style={s.input} placeholder="What went wrong with the work?" placeholderTextColor="#9CA3AF"
                value={description} onChangeText={setDescription} multiline maxLength={2000} />
              <View style={s.photos}>
                {photos.map((p) => <Image key={p.uri} source={{ uri: p.uri }} style={s.photo} />)}
                {photos.length < MAX_PHOTOS && (
                  <TouchableOpacity style={[s.photo, s.addPhoto]} onPress={addPhoto}>
                    <ThemedText style={s.muted}>+ Photo</ThemedText>
                  </TouchableOpacity>
                )}
              </View>
              {busy ? <ActivityIndicator color="#111827" /> : (
                <TouchableOpacity
                  style={[s.primary, { marginTop: 10 }, description.trim().length < 15 && { opacity: 0.5 }]}
                  disabled={description.trim().length < 15}
                  onPress={() => run(() => SkoFyApi.guarantee.claim(jobId!, description.trim(), photos), 'Claim sent')}
                >
                  <ThemedText style={s.primaryText}>Send claim</ThemedText>
                </TouchableOpacity>
              )}
            </ScrollView>
          )}
          <TouchableOpacity style={[s.secondary, { marginTop: 8 }]} onPress={onClose} disabled={busy}>
            <ThemedText style={s.secondaryText}>Close</ThemedText>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: '#fff', borderRadius: 20, padding: 20, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 17, lineHeight: 23, fontFamily: Fonts.poppinsBold, color: '#111827' },
  body: { fontSize: 13.5, lineHeight: 19, fontFamily: Fonts.poppins, color: '#111827', marginTop: 4 },
  muted: { fontSize: 12.5, lineHeight: 18, fontFamily: Fonts.poppins, color: '#6B7280', marginTop: 4 },
  input: {
    minHeight: 90, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 10, marginTop: 10,
    fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppins, color: '#111827', textAlignVertical: 'top',
  },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  photo: { width: 64, height: 64, borderRadius: 10, backgroundColor: '#F3F4F6' },
  addPhoto: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E5E7EB', borderStyle: 'dashed' },
  secondary: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: '#F3F4F6' },
  secondaryText: { fontSize: 14, lineHeight: 19, fontFamily: Fonts.poppinsSemiBold, color: '#374151' },
  primary: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: '#FFCE48' },
  primaryText: { fontSize: 14, lineHeight: 19, fontFamily: Fonts.poppinsBold, color: '#111827' },
});
