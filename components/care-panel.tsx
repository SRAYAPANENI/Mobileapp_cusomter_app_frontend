import { ThemedText } from '@/components/themed-text';
import { Disclosure, DetailRow } from '@/components/tracking/disclosure';
import { Colors, Fonts } from '@/constants/theme';
import { useHirePayment } from '@/hooks/use-hire-payment';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { CareJob } from '@/hooks/use-care-job';
import { BookingSummary, SkoFyApi } from '@/services/api';
import { BookingCheckout } from '@/components/booking-checkout';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { Camera, Clock, DoorOpen, KeyRound, MapPin, Timer } from 'lucide-react-native';
import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

const HOST_WAIT_MINUTES = 15; // settings.HOST_WAIT_MINUTES

const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const clock = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'the free minutes end');
const money = (n: number) => `$${n.toFixed(2)}`;

interface Props {
  jobId: string;
  care: CareJob;
  onMessage: (kind: 'success' | 'error' | 'info', title: string, message: string) => void;
}

// A job priced up front, or with something left in the provider's care
// (docs/JOB_SHAPE_DESIGN.md phase 4), for the customer — only what needs
// them now: book and pay, where and when to bring it, the code to read out,
// the waiting clock while it runs, the hand-back. The tracking screen's
// headline says where things are; the fare and its rules are in
// CareTripDetails, one tap away.
export function CarePanel({ jobId, care, onMessage }: Props) {
  const t = Colors[useColorScheme() ?? 'light'];
  const { payBooking } = useHirePayment();
  const { job, code, record, reload } = care;
  const [paying, setPaying] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [stopping, setStopping] = useState(false);
  // Booking opens the checkout: offers, promo code, the bill, then Book.
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  if (!job) return null;
  const steps: string[] = job.steps ?? [];
  const price = job.upfront_price;
  // A trip's waiting at the pickup and drop-off (skofy-backend app/domain/trip_wait.py):
  // its cap is paid with the fare, the unused part comes back.
  const wait = job.trip_wait ?? null;
  // The server's figures — the same the payment uses, so they always agree.
  const booking: BookingSummary | null = job.booking ?? null;
  const toPay = booking ? booking.pay : price ? price.total + (wait?.hold ?? 0) : 0;
  const paid = job.payment_status === 'HELD' || job.payment_status === 'PAID';
  const atTheirPlace = steps.includes('CHECK_IN_CODE');
  // Pickup & Delivery: nobody meets at the start — the code is the drop-off's.
  const delivery = steps.includes('PICKUP_PROOF');

  const book = async (offerCode: string | null = null) => {
    setPaying(true);
    const result = await payBooking(jobId, offerCode);
    setPaying(false);
    // Backed out of the card sheet, or it failed: the checkout stays open to
    // try again, as the invoice's does — closing it read as "nothing happened".
    if (result.status === 'cancelled') return;
    if (result.status === 'error') {
      onMessage('error', 'Not booked', result.message);
      return;
    }
    setCheckoutOpen(false);
    if (result.status === 'success') onMessage('success', 'Booked', 'Your payment is held safely until the job is done.');
    else onMessage('info', 'Processing', result.message);
    reload();
  };

  // "It's handed over": waiting stops now — the provider can't run it up after.
  const stopWaiting = async () => {
    setStopping(true);
    try {
      await SkoFyApi.jobs.stopWaiting(jobId);
      onMessage('success', 'Waiting stopped', "You won't be charged for any more waiting at this stop.");
      reload();
    } catch (err: any) {
      onMessage('error', 'Not stopped', err?.message ?? 'Please try again.');
    } finally {
      setStopping(false);
    }
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
      reload();
    } catch (err: any) {
      onMessage('error', 'Not sent', err?.message ?? 'Please try again.');
    } finally {
      setReporting(false);
    }
  };

  const waiting = waitLine(job, wait);
  // A running clock at a stop the customer isn't at (server: can_stop false there).
  const running = !!wait && wait.counts && !!wait.stop_arrived_at && !wait.stopped_at
    && (wait.stage === 'PICKUP' || wait.stage === 'DROPOFF');
  const elsewhere = running && !wait.can_stop
    ? (wait.stage === 'PICKUP'
      ? `${job.pickup_details?.handover_name ?? 'The person at the pickup'} hands it over — waiting stops when your provider confirms the pickup.`
      : `${job.pickup_details?.recipient_name ?? 'Your recipient'} receives it — waiting stops when they give your provider the code.`)
    : null;
  const handBack = job.status === 'IN_PROGRESS' && steps.includes('HANDBACK_CODE') && (!delivery || !!job.delivered_at);

  return (
    <View style={s.wrap}>
      {/* Not booked: what it costs, and the button. The breakdown on request. */}
      {job.status === 'ACCEPTED' && price && !paid && (
        <View style={[s.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <View style={s.totalRow}>
            <View style={{ flex: 1 }}>
              <ThemedText style={[s.muted, { color: t.textSecondary }]}>{price.text}</ThemedText>
              <ThemedText style={[s.total, { color: t.textPrimary }]}>{money(booking?.on_card ? toPay : (booking?.most ?? toPay))}</ThemedText>
            </View>
          </View>
          {job.pay_by && (
            <View style={s.warnRow}>
              <Clock size={14} color="#92400E" />
              <ThemedText style={s.warn}>
                Book by {clock(job.pay_by)} to keep your provider.
              </ThemedText>
            </View>
          )}
          <TouchableOpacity style={s.primary} onPress={() => setCheckoutOpen(true)} disabled={paying} accessibilityRole="button">
            {paying ? <ActivityIndicator color="#111827" />
              : <ThemedText style={s.primaryText}>{booking?.on_card ? `Book — ${money(toPay)}` : `Book and pay ${money(booking?.most ?? toPay)}`}</ThemedText>}
          </TouchableOpacity>
          {booking && (
            <Disclosure label="Price breakdown">
              <DetailRow label="Price" value={money(booking.price)} />
              {booking.fee > 0 && <DetailRow label="Service fee" value={money(booking.fee)} />}
              {(booking.credit ?? 0) > 0 && <DetailRow label="Dodorez credit" value={`−${money(booking.credit ?? 0)}`} />}
              <DetailRow label={booking.wait_hold > 0 ? 'You pay (no waiting)' : 'You pay'} value={money(booking.pay)} />
              {booking.wait_hold > 0 && wait && (
                <DetailRow label="Waiting, only if used" value={`up to ${money(booking.wait_hold)}`} note={wait.text} />
              )}
              <ThemedText style={[s.muted, { color: t.textSecondary }]}>
                {booking.on_card
                  ? (booking.most > booking.pay
                    ? `We hold ${money(booking.most)} on your card and take only what's used when it's done.`
                    : `We hold ${money(booking.most)} on your card and take it when it's done.`)
                  : booking.most > booking.pay
                    ? `You pay ${money(booking.most)} now; whatever isn't used comes back automatically.`
                    : "It's held safely and only paid to your provider when the job is done."}
              </ThemedText>
            </Disclosure>
          )}
        </View>
      )}

      {/* Bring it to them: where and when — what this booking needs from the customer. */}
      {job.status === 'ACCEPTED' && paid && atTheirPlace && (job.host_address || job.scheduled_at) && (
        <View style={[s.card, { backgroundColor: t.card, borderColor: t.border }]}>
          {!!job.host_address && <InfoRow icon={<MapPin size={16} color={t.textPrimary} />} text={job.host_address} />}
          {!!job.scheduled_at && (
            <InfoRow
              icon={<Clock size={16} color={t.textPrimary} />}
              text={`Drop-off ${when(job.scheduled_at)}${job.shape?.ends_at ? `  ·  Pick-up ${when(job.shape.ends_at)}` : ''}`}
            />
          )}
        </View>
      )}

      {/* The code to read out — big, nothing else around it. */}
      {code && (job.status === 'ACCEPTED' ? paid : !job.delivered_at) && (
        <View style={[s.codeBox, { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }]}>
          <View style={s.codeHead}>
            <KeyRound size={15} color="#92400E" />
            <ThemedText style={s.codeLabel}>
              {job.status === 'IN_PROGRESS' ? 'Give this code when you get it back' : 'Give your provider this code'}
            </ThemedText>
          </View>
          <ThemedText style={s.code} accessibilityLabel={`Code ${code.split('').join(' ')}`}>{code}</ThemedText>
        </View>
      )}

      {/* The waiting clock, only while it matters — one line, and the way to stop it. */}
      {paid && waiting && (
        <View style={[s.waitCard, { backgroundColor: t.inputFilled }]}>
          <View style={s.warnRow}>
            <Timer size={15} color={t.textPrimary} />
            <ThemedText style={[s.waitText, { color: t.textPrimary }]}>{waiting}</ThemedText>
          </View>
          {wait?.can_stop && (wait.stage === 'PICKUP' || wait.stage === 'DROPOFF') && (
            <HandedOverButton onPress={stopWaiting} busy={stopping} />
          )}
          {/* Someone else is at this stop: they end it, not a guess from here. */}
          {!!elsewhere && <ThemedText style={[s.muted, { color: t.textSecondary }]}>{elsewhere}</ThemedText>}
        </View>
      )}

      {hostLate && (
        <TouchableOpacity style={s.absent} onPress={reportNobodyHere} disabled={reporting} accessibilityRole="button">
          {reporting ? <ActivityIndicator color="#B91C1C" /> : <DoorOpen size={16} color="#B91C1C" />}
          <ThemedText style={s.absentText}>I'm here and nobody's answering</ThemedText>
        </TouchableOpacity>
      )}

      {/* Handed back / delivered: the provider's photo of it, when there is one. */}
      {handBack && !!job.delivered_at && delivery && !!job.dropoff_photo_url && (
        <Image source={{ uri: job.dropoff_photo_url }} style={s.dropoffPhoto} contentFit="cover" />
      )}

      {record && (record.handover_photos.length > 0 || record.updates.length > 0) && (
        <View style={[s.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <View style={s.warnRow}>
            <Camera size={15} color={t.textPrimary} />
            <ThemedText style={[s.title, { color: t.textPrimary }]}>Photos and updates</ThemedText>
          </View>
          {record.updates.map((u) => (
            <View key={u.id} style={[s.update, { borderTopColor: t.borderSubtle }]}>
              <ThemedText style={[s.when, { color: t.textSecondary }]}>{when(u.created_at)}</ThemedText>
              {u.note ? <ThemedText style={[s.body, { color: t.textPrimary }]}>{u.note}</ThemedText> : null}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {u.photo_urls.map((url) => <Image key={url} source={{ uri: url }} style={s.photo} contentFit="cover" />)}
              </ScrollView>
            </View>
          ))}
          {record.handover_photos.length > 0 && (
            <View style={[s.update, { borderTopColor: t.borderSubtle }]}>
              <ThemedText style={[s.when, { color: t.textSecondary }]}>Handed over {record.handover_at ? when(record.handover_at) : ''}</ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {record.handover_photos.map((p) => <Image key={p.url} source={{ uri: p.url }} style={s.photo} contentFit="cover" />)}
              </ScrollView>
            </View>
          )}
        </View>
      )}
      <BookingCheckout visible={checkoutOpen} jobId={jobId} onBook={book} onClose={() => setCheckoutOpen(false)} />
    </View>
  );
}

/** The fare and its rules — the tracking screen's "Trip details", one tap away. */
export function CareTripDetails({ care }: { care: CareJob }) {
  const job = care.job;
  if (!job) return null;
  const price = job.upfront_price;
  const wait = job.trip_wait ?? null;
  const paid = job.payment_status === 'HELD' || job.payment_status === 'PAID';
  const atTheirPlace = (job.steps ?? []).includes('CHECK_IN_CODE');
  if (!price && !wait && !job.scheduled_at) return null;
  return (
    <>
      {price && <DetailRow label={paid ? 'Booked' : 'Price'} value={price.text} />}
      {!!job.scheduled_at && !atTheirPlace && (
        <DetailRow label="When" value={when(job.scheduled_at)} note={job.shape?.ends_at ? `Ends ${when(job.shape.ends_at)}` : null} />
      )}
      {wait && (
        <DetailRow
          label="Waiting"
          value={wait.charge > 0 ? `${money(wait.charge)} so far` : 'No charge so far'}
          note={`${wait.text}. Up to ${money(wait.hold)} is held for it; whatever isn't used comes back.`}
        />
      )}
    </>
  );
}

// The waiting clock in one line — only once the provider is at a stop, or
// it has cost something (the rules themselves are in the trip details).
function waitLine(job: any, wait: any): string | null {
  if (!wait) return null;
  const stopped = wait.stopped_at
    ? `Waiting stopped at ${clock(wait.stopped_at)}${wait.stopped_by === 'LEFT' ? ' (your provider left)' : ''} · ${wait.charge > 0 ? money(wait.charge) : 'no charge'}`
    : null;
  if (job.status === 'ACCEPTED') {
    if (!job.arrived_at) return null;
    if (!wait.counts) return 'At the store — waiting there is free.';
    if (stopped) return stopped;
    return wait.minutes > 0
      ? `Waiting at the pickup · ${wait.minutes} min · ${money(wait.charge)}`
      : `At the pickup · waiting free until ${clock(wait.free_until)}`;
  }
  if (job.status === 'IN_PROGRESS') {
    if (wait.stage === 'DROPOFF') {
      if (stopped) return stopped;
      return wait.minutes === wait.used_before
        ? `At the drop-off · waiting free until ${clock(wait.free_until)}`
        : `Waiting · ${wait.minutes} min · ${money(wait.charge)} so far`;
    }
    if (wait.charge > 0) return `Waiting so far · ${wait.minutes} min · ${money(wait.charge)}`;
  }
  return null;
}

function InfoRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  const t = Colors[useColorScheme() ?? 'light'];
  return (
    <View style={s.warnRow}>
      {icon}
      <ThemedText style={[s.body, { color: t.textPrimary, flex: 1 }]}>{text}</ThemedText>
    </View>
  );
}

// "It's handed over": the customer stops the waiting clock at this stop.
function HandedOverButton({ onPress, busy }: { onPress: () => void; busy: boolean }) {
  return (
    <TouchableOpacity style={s.handedOver} onPress={onPress} disabled={busy} accessibilityRole="button">
      {busy ? <ActivityIndicator color="#065F46" />
        : <ThemedText style={s.handedOverText}>It's handed over — stop waiting</ThemedText>}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 12 },
  card: { padding: 16, borderRadius: 16, borderWidth: 1, gap: 10 },
  title: { fontSize: 15, lineHeight: 21, fontFamily: Fonts.poppinsBold },
  body: { fontSize: 13.5, lineHeight: 19, fontFamily: Fonts.poppins },
  muted: { fontSize: 12.5, lineHeight: 18, fontFamily: Fonts.poppins },
  totalRow: { flexDirection: 'row', alignItems: 'flex-end' },
  total: { fontSize: 26, lineHeight: 34, fontFamily: Fonts.poppinsBold },
  warnRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  warn: { flex: 1, fontSize: 12.5, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: '#92400E' },
  primary: { height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFCE48' },
  primaryText: { fontSize: 15, lineHeight: 21, fontFamily: Fonts.poppinsBold, color: '#111827' },
  codeBox: { alignItems: 'center', gap: 6, paddingVertical: 16, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1 },
  codeHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  codeLabel: { fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: '#92400E' },
  code: { fontSize: 34, lineHeight: 42, letterSpacing: 10, fontFamily: Fonts.poppinsBold, color: '#111827' },
  waitCard: { padding: 14, borderRadius: 14, gap: 10 },
  waitText: { flex: 1, fontSize: 13.5, lineHeight: 19, fontFamily: Fonts.poppinsSemiBold },
  handedOver: { height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0' },
  handedOverText: { fontSize: 14, lineHeight: 19, fontFamily: Fonts.poppinsBold, color: '#065F46' },
  update: { gap: 6, paddingTop: 8, borderTopWidth: 1 },
  when: { fontSize: 11.5, lineHeight: 15, fontFamily: Fonts.poppinsSemiBold },
  absent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#FECACA', backgroundColor: '#FEF2F2' },
  absentText: { fontSize: 13.5, lineHeight: 18, fontFamily: Fonts.poppinsBold, color: '#B91C1C' },
  photo: { width: 96, height: 96, borderRadius: 10, marginRight: 8, backgroundColor: '#F3F4F6' },
  dropoffPhoto: { width: '100%', height: 180, borderRadius: 14, backgroundColor: '#F3F4F6' },
});
