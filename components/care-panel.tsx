import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useHirePayment } from '@/hooks/use-hire-payment';
import { CareRecord, SkoFyApi } from '@/services/api';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { Camera, DoorOpen, KeyRound, MapPin } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

const POLL_MS = 5000;
const HOST_WAIT_MINUTES = 15; // settings.HOST_WAIT_MINUTES

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
  const [reporting, setReporting] = useState(false);

  const load = useCallback(async () => {
    const j: any = await SkoFyApi.jobs.get(jobId).catch(() => null);
    if (!j) return;
    setJob(j);
    const steps: string[] = j.steps ?? [];
    if (j.status === 'ACCEPTED' && j.payment_status === 'HELD' && (steps.includes('CHECK_IN_CODE') || steps.includes('ARRIVAL_CODE'))) {
      setCode((await SkoFyApi.jobs.checkInCode(jobId).catch(() => null))?.code ?? null);
    } else if (j.status === 'IN_PROGRESS' && steps.includes('HANDBACK_CODE') && !j.delivered_at
      // A delivery's drop-off code is the tracking screen's (it can be sent
      // on to whoever receives it); shown here too, it showed twice.
      && !steps.includes('PICKUP_PROOF')) {
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
  // A trip's waiting at the pickup and drop-off (skofy-backend app/domain/trip_wait.py):
  // its cap is paid with the fare, the unused part comes back.
  const wait = job.trip_wait ?? null;
  const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'the free minutes end');
  const toPay = price ? price.total + (wait?.hold ?? 0) : 0;
  const paid = job.payment_status === 'HELD' || job.payment_status === 'PAID';
  const atTheirPlace = steps.includes('CHECK_IN_CODE');
  // Pickup & Delivery: nobody meets at the start — the code is the drop-off's.
  const delivery = steps.includes('PICKUP_PROOF');

  const book = async () => {
    setPaying(true);
    const result = await payBooking(jobId);
    setPaying(false);
    if (result.status === 'success') onMessage('success', 'Booked', 'Your payment is held safely until the job is done.');
    else if (result.status === 'pending') onMessage('info', 'Processing', result.message);
    else if (result.status === 'error') onMessage('error', 'Not booked', result.message);
    load();
  };

  // Nobody to check you in at their place, after the wait: called off, all back.
  const hostLate = atTheirPlace && paid && job.status === 'ACCEPTED' && !!job.scheduled_at
    && Date.now() >= new Date(job.scheduled_at).getTime() + HOST_WAIT_MINUTES * 60000;
  const reportNobodyHere = async () => {
    setReporting(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') throw new Error("Allow location — this only counts at the provider's place.");
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const result = await SkoFyApi.jobs.reportProviderAbsent(jobId, loc.coords.latitude, loc.coords.longitude);
      onMessage('success', 'Booking cancelled', result.terms ?? result.message);
      load();
    } catch (err: any) {
      onMessage('error', 'Not sent', err?.message ?? 'Please try again.');
    } finally {
      setReporting(false);
    }
  };

  return (
    <View style={s.wrap}>
      {job.status === 'ACCEPTED' && price && !paid && (
        <View style={s.card}>
          <ThemedText style={s.title}>Book it</ThemedText>
          <ThemedText style={s.big}>{price.text}</ThemedText>
          <ThemedText style={s.muted}>You pay now; it's held safely and only paid to your provider when the job is done.</ThemedText>
          {wait && (
            <ThemedText style={s.muted}>
              {`${wait.text}. That $${wait.hold.toFixed(2)} is included and held too — whatever isn't used for waiting comes back to you automatically.`}
            </ThemedText>
          )}
          {job.pay_by && (
            <ThemedText style={s.warn}>
              Pay by {new Date(job.pay_by).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} to keep this booking — after that your provider is freed for others.
            </ThemedText>
          )}
          <TouchableOpacity style={s.primary} onPress={book} disabled={paying}>
            {paying ? <ActivityIndicator color="#111827" /> : <ThemedText style={s.primaryText}>Book and pay ${toPay.toFixed(2)}</ThemedText>}
          </TouchableOpacity>
        </View>
      )}

      {job.status === 'ACCEPTED' && paid && (
        <View style={s.card}>
          <ThemedText style={s.title}>Booked ✓</ThemedText>
          {price && <ThemedText style={s.body}>{price.text}</ThemedText>}
          {wait && (
            <ThemedText style={s.muted}>
              {!job.arrived_at
                ? `${wait.text} — $${wait.hold.toFixed(2)} held; unused comes back.`
                : wait.minutes > 0
                  ? `Your provider has waited at the pickup: ${wait.minutes} min, $${wait.charge.toFixed(2)} so far (up to $${wait.hold.toFixed(2)}).`
                  : `Your provider is at the pickup. Waiting is free until ${clock(wait.free_until)}, then $${wait.per_minute.toFixed(2)} a minute.`}
            </ThemedText>
          )}
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
              {delivery ? "Your provider is heading to the pickup. When they bring it to you, they'll ask for a code — it'll show here."
                : atTheirPlace ? "When you arrive, your provider asks for a code — it'll show here."
                : "When your provider arrives, they'll ask for a code — it'll show here."}
            </ThemedText>
          )}
          {hostLate && (
            <TouchableOpacity style={s.absent} onPress={reportNobodyHere} disabled={reporting}>
              {reporting ? <ActivityIndicator color="#B91C1C" /> : <DoorOpen size={16} color="#B91C1C" />}
              <ThemedText style={s.absentText}>I'm here and nobody's answering</ThemedText>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Under way: waiting so far, the drop-off's clock, and what comes back. */}
      {job.status === 'IN_PROGRESS' && wait && (
        <View style={s.card}>
          <ThemedText style={s.title}>Waiting</ThemedText>
          <ThemedText style={s.muted}>
            {wait.stage === 'DROPOFF' && wait.minutes === wait.used_before
              ? `Your provider is at the drop-off. Waiting there is free until ${clock(wait.free_until)}, then $${wait.per_minute.toFixed(2)} a minute.`
              : wait.charge > 0
                ? `${wait.minutes} min, $${wait.charge.toFixed(2)} so far. The rest of the $${wait.hold.toFixed(2)} hold comes back to you ${wait.final ? 'when the job is completed' : "once it's delivered"}.`
                : `No charge so far — the $${wait.hold.toFixed(2)} held for waiting comes back to you ${wait.final ? 'when the job is completed' : "once it's delivered"}.`}
          </ThemedText>
        </View>
      )}

      {/* A delivery's drop-off code is on the tracking screen; here only once it's handed over. */}
      {job.status === 'IN_PROGRESS' && steps.includes('HANDBACK_CODE') && (!delivery || !!job.delivered_at) && (
        <View style={s.card}>
          <ThemedText style={s.title}>{job.delivered_at ? (delivery ? 'Delivered ✓' : 'Handed back ✓') : atTheirPlace ? 'Picking up' : 'Hand-back'}</ThemedText>
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
  warn: { fontSize: 12.5, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: '#92400E' },
  primary: { paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: '#FFCE48', marginTop: 4 },
  primaryText: { fontSize: 14.5, lineHeight: 20, fontFamily: Fonts.poppinsBold, color: '#111827' },
  codeBox: { alignItems: 'center', gap: 4, padding: 12, borderRadius: 12, backgroundColor: '#FFFBEB' },
  codeLabel: { fontSize: 12.5, lineHeight: 17, fontFamily: Fonts.poppinsSemiBold, color: '#92400E' },
  code: { fontSize: 30, lineHeight: 38, letterSpacing: 8, fontFamily: Fonts.poppinsBold, color: '#111827' },
  update: { gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  when: { fontSize: 11.5, lineHeight: 15, fontFamily: Fonts.poppinsSemiBold, color: '#6B7280' },
  absent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: '#FECACA', backgroundColor: '#FEF2F2' },
  absentText: { fontSize: 13.5, lineHeight: 18, fontFamily: Fonts.poppinsBold, color: '#B91C1C' },
  photo: { width: 96, height: 96, borderRadius: 10, marginRight: 8, backgroundColor: '#F3F4F6' },
});
