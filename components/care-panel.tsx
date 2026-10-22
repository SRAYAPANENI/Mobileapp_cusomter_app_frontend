import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useHirePayment } from '@/hooks/use-hire-payment';
import { CareRecord, SkoFyApi } from '@/services/api';
import { Image } from 'expo-image';
import { Camera, KeyRound, MapPin } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

const POLL_MS = 5000;

interface Props {
  jobId: string;
  onMessage: (kind: 'success' | 'error' | 'info', title: string, message: string) => void;
}

const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// A job priced up front, or with something left in the provider's care
// (docs/JOB_SHAPE_DESIGN.md phase 4), step by step for the customer: book
// and pay the agreed price → where to bring it → the check-in code → the
// hand-over photos and updates → the hand-back code.
export function CarePanel({ jobId, onMessage }: Props) {
  const { payBooking } = useHirePayment();
  const [job, setJob] = useState<any>(null);
  const [code, setCode] = useState<string | null>(null);
  const [record, setRecord] = useState<CareRecord | null>(null);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    const j: any = await SkoFyApi.jobs.get(jobId).catch(() => null);
    if (!j) return;
    setJob(j);
    const steps: string[] = j.steps ?? [];
    if (j.status === 'ACCEPTED' && j.payment_status === 'HELD' && (steps.includes('CHECK_IN_CODE') || steps.includes('ARRIVAL_CODE'))) {
      setCode((await SkoFyApi.jobs.checkInCode(jobId).catch(() => null))?.code ?? null);
    } else if (j.status === 'IN_PROGRESS' && steps.includes('HANDBACK_CODE') && !j.delivered_at) {
      setCode((await SkoFyApi.jobs.getDeliveryCode(jobId).catch(() => null))?.code ?? null);
    } else {
      setCode(null);
    }
    if (steps.includes('HANDOVER_PHOTOS') && j.handover_at) {
      setRecord(await SkoFyApi.jobs.careRecord(jobId).catch(() => null));
    }
  }, [jobId]);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  if (!job) return null;
  const steps: string[] = job.steps ?? [];
  const price = job.upfront_price;
  const paid = job.payment_status === 'HELD' || job.payment_status === 'PAID';
  const atTheirPlace = steps.includes('CHECK_IN_CODE');

  const book = async () => {
    setPaying(true);
    const result = await payBooking(jobId);
    setPaying(false);
    if (result.status === 'success') onMessage('success', 'Booked', 'Your payment is held safely until the job is done.');
    else if (result.status === 'pending') onMessage('info', 'Processing', result.message);
    else if (result.status === 'error') onMessage('error', 'Not booked', result.message);
    load();
  };

  return (
    <View style={s.wrap}>
      {job.status === 'ACCEPTED' && price && !paid && (
        <View style={s.card}>
          <ThemedText style={s.title}>Book it</ThemedText>
          <ThemedText style={s.big}>{price.text}</ThemedText>
          <ThemedText style={s.muted}>You pay now; it's held safely and only paid to your provider when the job is done.</ThemedText>
          <TouchableOpacity style={s.primary} onPress={book} disabled={paying}>
            {paying ? <ActivityIndicator color="#111827" /> : <ThemedText style={s.primaryText}>Book and pay ${price.total.toFixed(2)}</ThemedText>}
          </TouchableOpacity>
        </View>
      )}

      {job.status === 'ACCEPTED' && paid && (
        <View style={s.card}>
          <ThemedText style={s.title}>Booked ✓</ThemedText>
          {price && <ThemedText style={s.body}>{price.text}</ThemedText>}
          {job.scheduled_at && (
            <ThemedText style={s.body}>
              {atTheirPlace ? 'Drop-off' : 'Starts'}: {when(job.scheduled_at)}
              {job.shape?.ends_at ? `  ·  ${atTheirPlace ? 'Pick-up' : 'Ends'}: ${when(job.shape.ends_at)}` : ''}
            </ThemedText>
          )}
          {atTheirPlace && job.host_address && (
            <View style={s.row}>
              <MapPin size={15} color="#111827" />
              <ThemedText style={[s.body, { flex: 1 }]}>Bring it to: {job.host_address}</ThemedText>
            </View>
          )}
          {code ? (
            <View style={s.codeBox}>
              <KeyRound size={16} color="#111827" />
              <ThemedText style={s.codeLabel}>Give your provider this code</ThemedText>
              <ThemedText style={s.code}>{code}</ThemedText>
            </View>
          ) : (
            <ThemedText style={s.muted}>
              {atTheirPlace ? "When you arrive, your provider asks for a code — it'll show here." : "When your provider arrives, they'll ask for a code — it'll show here."}
            </ThemedText>
          )}
        </View>
      )}

      {job.status === 'IN_PROGRESS' && steps.includes('HANDBACK_CODE') && (
        <View style={s.card}>
          <ThemedText style={s.title}>{job.delivered_at ? 'Handed back ✓' : atTheirPlace ? 'Picking up' : 'Hand-back'}</ThemedText>
          {job.delivered_at ? (
            <ThemedText style={s.muted}>All good? Mark the job as completed below, then rate your provider.</ThemedText>
          ) : code ? (
            <View style={s.codeBox}>
              <KeyRound size={16} color="#111827" />
              <ThemedText style={s.codeLabel}>Give your provider this code when you get it back</ThemedText>
              <ThemedText style={s.code}>{code}</ThemedText>
            </View>
          ) : (
            <ThemedText style={s.muted}>When it's handed back, your provider asks for a code — it'll show here.</ThemedText>
          )}
        </View>
      )}

      {record && (record.handover_photos.length > 0 || record.updates.length > 0) && (
        <View style={s.card}>
          <View style={s.row}>
            <Camera size={15} color="#111827" />
            <ThemedText style={s.title}>Photos and updates</ThemedText>
          </View>
          {record.updates.map((u) => (
            <View key={u.id} style={s.update}>
              <ThemedText style={s.when}>{when(u.created_at)}</ThemedText>
              {u.note ? <ThemedText style={s.body}>{u.note}</ThemedText> : null}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {u.photo_urls.map((url) => <Image key={url} source={{ uri: url }} style={s.photo} contentFit="cover" />)}
              </ScrollView>
            </View>
          ))}
          {record.handover_photos.length > 0 && (
            <View style={s.update}>
              <ThemedText style={s.when}>Handed over {record.handover_at ? when(record.handover_at) : ''}</ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {record.handover_photos.map((p) => <Image key={p.url} source={{ uri: p.url }} style={s.photo} contentFit="cover" />)}
              </ScrollView>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 12, marginTop: 12 },
  card: { padding: 16, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, lineHeight: 21, fontFamily: Fonts.poppinsBold, color: '#111827' },
  big: { fontSize: 18, lineHeight: 24, fontFamily: Fonts.poppinsBold, color: '#065F46' },
  body: { fontSize: 13.5, lineHeight: 19, fontFamily: Fonts.poppins, color: '#111827' },
  muted: { fontSize: 12.5, lineHeight: 18, fontFamily: Fonts.poppins, color: '#6B7280' },
  primary: { paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: '#FFCE48', marginTop: 4 },
  primaryText: { fontSize: 14.5, lineHeight: 20, fontFamily: Fonts.poppinsBold, color: '#111827' },
  codeBox: { alignItems: 'center', gap: 4, padding: 12, borderRadius: 12, backgroundColor: '#FFFBEB' },
  codeLabel: { fontSize: 12.5, lineHeight: 17, fontFamily: Fonts.poppinsSemiBold, color: '#92400E' },
  code: { fontSize: 30, lineHeight: 38, letterSpacing: 8, fontFamily: Fonts.poppinsBold, color: '#111827' },
  update: { gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  when: { fontSize: 11.5, lineHeight: 15, fontFamily: Fonts.poppinsSemiBold, color: '#6B7280' },
  photo: { width: 96, height: 96, borderRadius: 10, marginRight: 8, backgroundColor: '#F3F4F6' },
});
