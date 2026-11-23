import { ThemedText } from '@/components/themed-text';
import { TextInput } from '@/components/scaled-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MeetingInfo, SkoFyApi } from '@/services/api';
import * as Clipboard from 'expo-clipboard';
import { CalendarPlus, Check, Copy, Laptop, Link2, Video } from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';

// An online job's meeting (docs/ONLINE_JOBS_DESIGN.md): join it here, or on a
// computer by typing its short address — screen sharing and laptops come with
// Zoom, Meet, Teams and Webex. Either side can add or change the link; the
// other is told. The server checks the link (app/domain/meeting_links.py).

export function meetingService(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith('zoom.us') || host.endsWith('zoomgov.com')) return 'Zoom';
    if (host === 'meet.google.com') return 'Google Meet';
    if (host.startsWith('teams.')) return 'Microsoft Teams';
    if (host.endsWith('webex.com')) return 'Webex';
  } catch {}
  return 'the meeting';
}

/** Android: Google Calendar's own "add event" page — one tap, where a
 * calendar file would only download. A session is an hour unless it says. */
function googleCalendarLink(title: string, startIso: string, url: string): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const start = new Date(startIso);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const q = (v: string) => encodeURIComponent(v);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${q(title)}`
    + `&dates=${fmt(start)}/${fmt(end)}&details=${q(`Join: ${url}`)}&location=${q(url)}`;
}

/** The short address as it's typed: no "https://". */
const typed = (link: string) => link.replace(/^https?:\/\//, '');

interface Props {
  jobId: string;
  meeting: MeetingInfo | null;
  /** When the session starts (ISO), if it has a set time. */
  sessionAt: string | null;
  /** The job's title — the calendar event's name. */
  title?: string;
  /** Who's looking: what the empty state says. */
  viewer: 'customer' | 'provider';
  onChanged: (meeting: MeetingInfo | null) => void;
  onMessage: (kind: 'success' | 'error' | 'info', title: string, message: string) => void;
}

export function MeetingCard({ jobId, meeting, sessionAt, title, viewer, onChanged, onMessage }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const t = Colors[scheme];
  const s = useMemo(() => makeStyles(t), [t]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const startEditing = () => { setDraft(meeting?.url ?? ''); setError(null); setEditing(true); };

  const save = async () => {
    if (!draft.trim()) { setError('Paste the meeting link.'); return; }
    setSaving(true);
    setError(null);
    try {
      const saved = await SkoFyApi.jobs.setMeeting(jobId, draft.trim());
      onChanged(saved);
      setEditing(false);
    } catch (err: any) {
      setError(err?.message ?? 'Couldn’t save the link. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await SkoFyApi.jobs.clearMeeting(jobId);
      onChanged(null);
      setEditing(false);
    } catch (err: any) {
      onMessage('error', 'Not removed', err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const join = () => {
    if (!meeting) return;
    Linking.openURL(meeting.url).catch(() =>
      onMessage('error', 'Couldn’t open the meeting', `Open ${meetingService(meeting.url)} and join with the link.`));
  };

  const copy = async () => {
    if (!meeting?.short_link) return;
    await Clipboard.setStringAsync(typed(meeting.short_link));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // iPhone: the calendar file (Safari hands it to Calendar); Android: Google Calendar's page.
  const addToCalendar = () => {
    if (!meeting || !sessionAt) return;
    // The calendar file needs the short link; without one, Google's page everywhere.
    const link = Platform.OS === 'android' || !meeting.short_link
      ? googleCalendarLink(title || 'Dodorez session', sessionAt, meeting.url)
      : `${meeting.short_link}/calendar.ics`;
    Linking.openURL(link).catch(() =>
      onMessage('error', 'Couldn’t open your calendar', 'Add the time and the link to your calendar yourself.'));
  };

  // ── Adding or changing the link ────────────────────────────────────────
  if (editing) {
    return (
      <View style={s.card}>
        <View style={s.headRow}>
          <View style={s.icon}><Link2 size={18} color="#111827" /></View>
          <ThemedText style={s.title}>{meeting ? 'Change the meeting link' : 'Add a meeting link'}</ThemedText>
        </View>
        <ThemedText style={s.body}>
          Paste the invite link from Zoom, Google Meet, Microsoft Teams or Webex.
        </ThemedText>
        <TextInput
          style={[s.input, error && { borderColor: '#EF4444' }]}
          value={draft}
          onChangeText={(v) => { setDraft(v); if (error) setError(null); }}
          placeholder="https://meet.google.com/abc-defg-hij"
          placeholderTextColor={t.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
          onSubmitEditing={save}
          editable={!saving}
        />
        {!!error && <ThemedText style={s.error}>{error}</ThemedText>}
        <View style={s.row}>
          <TouchableOpacity style={[s.button, s.secondary]} onPress={() => setEditing(false)} disabled={saving}>
            <ThemedText style={s.secondaryText}>Cancel</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity style={[s.button, s.primary]} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color="#111827" /> : <ThemedText style={s.primaryText}>Save link</ThemedText>}
          </TouchableOpacity>
        </View>
        {meeting && (
          <TouchableOpacity onPress={remove} disabled={saving} style={s.linkButton}>
            <ThemedText style={s.removeText}>Remove the link</ThemedText>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // ── No link yet ────────────────────────────────────────────────────────
  if (!meeting) {
    return (
      <View style={s.card}>
        <View style={s.headRow}>
          <View style={s.icon}><Video size={18} color="#111827" /></View>
          <ThemedText style={s.title}>Meeting link</ThemedText>
        </View>
        <ThemedText style={s.body}>
          {viewer === 'customer'
            ? 'Your provider usually adds the Zoom, Meet or Teams link here. Already have one? Add it.'
            : 'Add the Zoom, Meet or Teams link for this session — your customer is told and can join from here.'}
        </ThemedText>
        <TouchableOpacity style={[s.button, viewer === 'provider' ? s.primary : s.secondary]} onPress={startEditing}>
          <ThemedText style={viewer === 'provider' ? s.primaryText : s.secondaryText}>Add meeting link</ThemedText>
        </TouchableOpacity>
      </View>
    );
  }

  // ── The link ───────────────────────────────────────────────────────────
  const service = meetingService(meeting.url);
  return (
    <View style={s.card}>
      <View style={s.headRow}>
        <View style={s.icon}><Video size={18} color="#111827" /></View>
        <View style={{ flex: 1 }}>
          <ThemedText style={s.title}>Meeting on {service}</ThemedText>
          <ThemedText style={s.meta}>
            {sessionAt ? new Date(sessionAt).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
              : 'Join when you’re both ready'}
            {meeting.set_by ? ` · added by ${meeting.set_by === viewer ? 'you' : viewer === 'customer' ? 'your provider' : 'your customer'}` : ''}
          </ThemedText>
        </View>
      </View>

      <TouchableOpacity style={[s.button, s.primary]} onPress={join} accessibilityRole="link">
        <ThemedText style={s.primaryText}>Join on this phone</ThemedText>
      </TouchableOpacity>

      {/* On a computer: screen sharing and a bigger screen. */}
      {meeting.short_link && (
      <View style={s.computer}>
        <View style={s.headRow}>
          <Laptop size={16} color={t.textSecondary} />
          <ThemedText style={s.computerLabel}>On a computer, type this in the browser</ThemedText>
        </View>
        <View style={s.addressRow}>
          <ThemedText style={s.address} selectable numberOfLines={1} adjustsFontSizeToFit>
            {typed(meeting.short_link)}
          </ThemedText>
          <TouchableOpacity onPress={copy} style={s.copy} accessibilityRole="button"
            accessibilityLabel={copied ? 'Copied' : 'Copy the address'}>
            {copied ? <Check size={16} color="#059669" /> : <Copy size={16} color={t.textPrimary} />}
          </TouchableOpacity>
        </View>
      </View>
      )}

      <View style={s.row}>
        {sessionAt && (
          <TouchableOpacity style={[s.button, s.secondary, s.withIcon]} onPress={addToCalendar}>
            <CalendarPlus size={16} color={t.textPrimary} />
            <ThemedText style={s.secondaryText}>Add to calendar</ThemedText>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[s.button, s.secondary]} onPress={startEditing}>
          <ThemedText style={s.secondaryText}>Change link</ThemedText>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (t: typeof Colors.light) => StyleSheet.create({
  card: { padding: 16, borderRadius: 16, backgroundColor: t.card, borderWidth: 1, borderColor: t.border, gap: 12 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFF8E1', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, lineHeight: 21, fontFamily: Fonts.poppinsBold, color: t.textPrimary, flexShrink: 1 },
  meta: { fontSize: 12, lineHeight: 17, fontFamily: Fonts.poppins, color: t.textSecondary },
  body: { fontSize: 13, lineHeight: 19, fontFamily: Fonts.poppins, color: t.textSecondary },
  input: {
    height: 48, borderRadius: 12, borderWidth: 1, borderColor: t.border, paddingHorizontal: 14,
    fontSize: 14, fontFamily: Fonts.poppins, color: t.textPrimary, backgroundColor: t.inputFilled,
  },
  error: { fontSize: 12, lineHeight: 17, fontFamily: Fonts.poppins, color: '#EF4444' },
  row: { flexDirection: 'row', gap: 10 },
  button: { flex: 1, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  withIcon: { flexDirection: 'row', gap: 6 },
  primary: { backgroundColor: '#FFCE48' },
  primaryText: { fontSize: 15, lineHeight: 21, fontFamily: Fonts.poppinsBold, color: '#111827' },
  secondary: { backgroundColor: t.inputFilled },
  secondaryText: { fontSize: 14, lineHeight: 20, fontFamily: Fonts.poppinsSemiBold, color: t.textPrimary },
  computer: { borderRadius: 12, backgroundColor: t.inputFilled, padding: 12, gap: 8 },
  computerLabel: { fontSize: 12, lineHeight: 17, fontFamily: Fonts.poppins, color: t.textSecondary, flexShrink: 1 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  address: { flex: 1, fontSize: 16, lineHeight: 22, fontFamily: Fonts.poppinsBold, color: t.textPrimary, letterSpacing: 0.3 },
  copy: { width: 36, height: 36, borderRadius: 10, backgroundColor: t.card, alignItems: 'center', justifyContent: 'center' },
  linkButton: { alignSelf: 'center', paddingVertical: 4 },
  removeText: { fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: '#EF4444' },
});
