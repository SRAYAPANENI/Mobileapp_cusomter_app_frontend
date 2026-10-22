import { Text, TextInput } from '@/components/scaled-text';
import { Fonts } from '@/constants/theme';
import { PhotoFile, SkoFyApi } from '@/services/api';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Camera, CheckCircle2, ClipboardCheck, ShieldAlert, X } from 'lucide-react-native';
import React, { useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

export type InspectionReport = {
  findings?: string;
  result?: 'QUOTE' | 'NO_WORK';
  photos?: { url: string }[];
};

interface Props {
  jobId: string;
  jobStatus: string;
  report: InspectionReport | null;
  confirmed: boolean;
  disputed: boolean;
  /** Something changed (confirmed, sent back, reported) — reload the job. */
  onChanged: () => void;
  onError: (title: string, message: string) => void;
}

// The provider's inspection report, for the customer to confirm — the one
// person who was there (docs/MONEY_RULES_DESIGN.md §4). "Yes, it's done" pays
// the visiting fee; "Not done yet" sends the provider back to it; reading the
// end code confirms it in person; "It wasn't done" holds the fee for support.
export function InspectionReportCard({ jobId, jobStatus, report, confirmed, disputed, onChanged, onError }: Props) {
  const [busy, setBusy] = useState<'yes' | 'no' | 'code' | null>(null);
  const [endCode, setEndCode] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [sending, setSending] = useState(false);

  const respond = async (done: boolean) => {
    setBusy(done ? 'yes' : 'no');
    try {
      await SkoFyApi.jobs.respondToInspection(jobId, done);
      onChanged();
    } catch (err: any) {
      onError('Could not send', err?.message ?? 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const showCode = async () => {
    setBusy('code');
    try {
      setEndCode((await SkoFyApi.jobs.getInspectionEndCode(jobId)).code);
    } catch (err: any) {
      onError('No code yet', err?.message ?? 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const addPhoto = async () => {
    if (photos.length >= 3) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled && result.assets[0]) {
      setPhotos((prev) => [...prev, { uri: result.assets[0].uri, mimeType: result.assets[0].mimeType || 'image/jpeg' }]);
    }
  };

  const sendReport = async () => {
    setSending(true);
    try {
      await SkoFyApi.disputes.disputeInspection(jobId, reason.trim(), photos);
      setReporting(false);
      onChanged();
    } catch (err: any) {
      onError('Could not report it', err?.message ?? 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={s.card}>
      <View style={s.header}>
        <ClipboardCheck size={16} color="#111827" />
        <Text style={s.title}>Inspection report</Text>
      </View>
      {!!report?.findings && <Text style={s.findings}>{report.findings}</Text>}
      {!!report?.result && (
        <Text style={s.result}>{report.result === 'NO_WORK' ? 'No work needed' : 'Work needed — a quote follows'}</Text>
      )}
      {!!report?.photos?.length && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          {report.photos.map((p) => (
            <Image key={p.url} source={{ uri: p.url }} style={s.photo} contentFit="cover" />
          ))}
        </ScrollView>
      )}

      {confirmed ? (
        <View style={s.statusRow}>
          <CheckCircle2 size={16} color="#059669" />
          <Text style={s.statusOk}>Confirmed — thank you.</Text>
        </View>
      ) : disputed ? (
        <View style={s.statusRow}>
          <ShieldAlert size={16} color="#B45309" />
          <Text style={s.statusWarn}>You reported this. Support is reviewing it, and the visiting fee is held meanwhile.</Text>
        </View>
      ) : (
        <>
          <Text style={s.ask}>Is the inspection done?</Text>
          <TouchableOpacity style={s.primary} onPress={() => respond(true)} disabled={!!busy}>
            {busy === 'yes' ? <ActivityIndicator color="#111827" /> : <Text style={s.primaryText}>Yes, it's done</Text>}
          </TouchableOpacity>
          {jobStatus === 'INSPECTING' && (
            <TouchableOpacity style={s.secondary} onPress={() => respond(false)} disabled={!!busy}>
              {busy === 'no' ? <ActivityIndicator color="#374151" /> : <Text style={s.secondaryText}>Not done yet</Text>}
            </TouchableOpacity>
          )}
          {endCode ? (
            <View style={s.codeBox}>
              <Text style={s.codeLabel}>Read this to your provider:</Text>
              <Text style={s.code}>{endCode}</Text>
            </View>
          ) : (
            <TouchableOpacity onPress={showCode} disabled={!!busy}>
              <Text style={s.link}>{busy === 'code' ? 'Getting your code…' : 'Show my code to read to the provider'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => { setReason(''); setPhotos([]); setReporting(true); }}>
            <Text style={s.reportLink}>It wasn't done — report it</Text>
          </TouchableOpacity>
        </>
      )}

      <Modal visible={reporting} transparent animationType="fade" onRequestClose={() => setReporting(false)}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>The inspection wasn't done</Text>
            <Text style={s.sheetSub}>
              Tell us what happened. The visiting fee is held while our team reviews the evidence from both of you.
            </Text>
            <TextInput
              style={s.input}
              placeholder="e.g. They left after two minutes without looking at the AC"
              placeholderTextColor="#9CA3AF"
              value={reason}
              onChangeText={setReason}
              multiline
              maxLength={2000}
            />
            <View style={s.photoRow}>
              {photos.map((p, i) => (
                <View key={p.uri}>
                  <Image source={{ uri: p.uri }} style={s.thumb} contentFit="cover" />
                  <TouchableOpacity style={s.remove} onPress={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}>
                    <X size={10} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
              {photos.length < 3 && (
                <TouchableOpacity style={s.addPhoto} onPress={addPhoto}>
                  <Camera size={18} color="#6B7280" />
                </TouchableOpacity>
              )}
            </View>
            <View style={s.sheetButtons}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setReporting(false)} disabled={sending}>
                <Text style={s.secondaryText}>Go back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.reportBtn, (reason.trim().length < 10 || sending) && { opacity: 0.5 }]}
                onPress={sendReport}
                disabled={reason.trim().length < 10 || sending}
              >
                {sending ? <ActivityIndicator color="#fff" /> : <Text style={s.reportBtnText}>Report it</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginTop: 12, padding: 14, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 15, lineHeight: 20, fontFamily: Fonts.poppinsBold, color: '#111827' },
  findings: { marginTop: 8, fontSize: 13.5, lineHeight: 19, fontFamily: Fonts.poppins, color: '#111827' },
  result: { marginTop: 6, fontSize: 12.5, lineHeight: 17, fontFamily: Fonts.poppinsSemiBold, color: '#2563EB' },
  photo: { width: 84, height: 84, borderRadius: 10, marginRight: 8, backgroundColor: '#F3F4F6' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  statusOk: { flex: 1, fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: '#059669' },
  statusWarn: { flex: 1, fontSize: 12.5, lineHeight: 17, fontFamily: Fonts.poppins, color: '#92400E' },
  ask: { marginTop: 12, fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: '#374151' },
  primary: { marginTop: 8, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: '#FFCE48' },
  primaryText: { fontSize: 14, lineHeight: 19, fontFamily: Fonts.poppinsBold, color: '#111827' },
  secondary: { marginTop: 8, paddingVertical: 11, borderRadius: 12, alignItems: 'center', backgroundColor: '#F3F4F6' },
  secondaryText: { fontSize: 13.5, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: '#374151' },
  link: { marginTop: 12, fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: '#2563EB', textAlign: 'center' },
  reportLink: { marginTop: 10, fontSize: 12.5, lineHeight: 17, fontFamily: Fonts.poppinsSemiBold, color: '#B91C1C', textAlign: 'center' },
  codeBox: { marginTop: 12, alignItems: 'center', padding: 10, borderRadius: 12, backgroundColor: '#F9FAFB' },
  codeLabel: { fontSize: 12, lineHeight: 16, fontFamily: Fonts.poppins, color: '#6B7280' },
  code: { marginTop: 4, fontSize: 28, lineHeight: 34, letterSpacing: 8, fontFamily: Fonts.poppinsBold, color: '#111827' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: '#fff', borderRadius: 20, padding: 20, gap: 10 },
  sheetTitle: { fontSize: 17, lineHeight: 22, fontFamily: Fonts.poppinsBold, color: '#111827' },
  sheetSub: { fontSize: 12.5, lineHeight: 18, fontFamily: Fonts.poppins, color: '#6B7280' },
  input: {
    minHeight: 90, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 10,
    fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppins, color: '#111827', textAlignVertical: 'top',
  },
  photoRow: { flexDirection: 'row', gap: 8 },
  thumb: { width: 56, height: 56, borderRadius: 8 },
  remove: { position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 9, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  addPhoto: { width: 56, height: 56, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: '#9CA3AF', alignItems: 'center', justifyContent: 'center' },
  sheetButtons: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: '#F3F4F6' },
  reportBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: '#B91C1C' },
  reportBtnText: { fontSize: 14, lineHeight: 19, fontFamily: Fonts.poppinsBold, color: '#fff' },
});
