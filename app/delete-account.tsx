import { useAppAlert } from '@/components/app-alert';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts } from '@/constants/theme';
import { useBottomInset } from '@/hooks/use-bottom-inset';
import { AccountDeletionStatus, SkoFyApi } from '@/services/api';
import { signOutDevice } from '@/services/callManager';
import { clearHomeCache } from '@/services/homeCache';
import { router } from 'expo-router';
import { AlertTriangle, Archive, ChevronLeft, Clock, Trash2 } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

// Deleting the account (docs/ACCOUNT_DELETION_DESIGN.md): says what goes and
// what's kept, lists anything still open, then a code to their phone and
// it's closed — deleted after the grace period unless they log back in.
export default function DeleteAccountScreen() {
  const bottomInset = useBottomInset();
  const appAlert = useAppAlert();
  const [status, setStatus] = useState<AccountDeletionStatus | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'code' | 'delete' | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);

  useEffect(() => {
    SkoFyApi.account.deletionStatus()
      .then((s) => { setStatus(s); setReasons(s.blockers); })
      .catch((err: any) => appAlert.show('error', 'Could not load', err?.message ?? 'Please try again.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendCode = async () => {
    setBusy('code');
    try {
      const r = await SkoFyApi.account.sendDeletionCode();
      setSentTo(r.sent_to);
      if (r.mock_otp) setCode(r.mock_otp);
    } catch (err: any) {
      appAlert.show('error', 'Code not sent', err?.message ?? 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const deleteAccount = async () => {
    setBusy('delete');
    try {
      const r = await SkoFyApi.account.deleteAccount(code.trim());
      // Signed out everywhere by the server already; this clears the phone too.
      await signOutDevice();
      await clearHomeCache().catch(() => {});
      appAlert.show('success', 'Account closed', r.message, [
        { text: 'OK', variant: 'primary', onPress: () => router.replace('/login') },
      ]);
    } catch (err: any) {
      const blocked: string[] | undefined = err?.details?.reasons;
      if (blocked?.length) setReasons(blocked);
      appAlert.show('error', 'Not deleted', blocked?.length ? 'Some things need finishing first — see the list.' : err?.message ?? 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const days = status?.grace_days ?? 30;
  const blocked = reasons.length > 0;

  return (
    <ThemedView style={s.container}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity style={s.back} onPress={() => router.back()}>
          <ChevronLeft size={22} color={C.ink} />
        </TouchableOpacity>
        <ThemedText style={s.headerTitle}>Delete account</ThemedText>
      </View>

      {!status ? <ActivityIndicator style={{ marginTop: 40 }} color={C.ink} /> : (
        <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={[s.body, { paddingBottom: 40 + bottomInset }]} keyboardShouldPersistTaps="handled">
          {status.deletion_due_at ? (
            <View style={s.card}>
              <ThemedText style={s.title}>Your account is closing</ThemedText>
              <ThemedText style={s.muted}>
                It will be deleted on {new Date(status.deletion_due_at).toLocaleDateString()}. Log in before then to keep it.
              </ThemedText>
            </View>
          ) : (
            <>
              <View style={s.card}>
                <Line icon={<Clock size={18} color={C.ink} />} title="Closed now, in both Dodorez apps"
                  text={`Deleted after ${days} days. Changed your mind? Just log back in before then.`} />
                <Line icon={<Trash2 size={18} color={C.bad} />} title="What's deleted"
                  text="Your name, phone, email, photos, saved addresses, ID documents, saved cards and your messages." />
                <Line icon={<Archive size={18} color={C.muted} />} title="What's kept, without your name"
                  text="Records of past jobs and payments — the law requires them (tax, disputes, fraud) — shown as “Former customer”." last />
              </View>

              {blocked && (
                <View style={[s.card, s.cardWarn]}>
                  <View style={s.row}><AlertTriangle size={18} color={C.warn} /><ThemedText style={[s.title, { color: C.warn }]}>Finish these first</ThemedText></View>
                  {reasons.map((r) => <ThemedText key={r} style={s.reason}>• {r}</ThemedText>)}
                </View>
              )}

              <View style={s.card}>
                {!sentTo ? (
                  <>
                    <ThemedText style={s.muted}>We’ll text a code to the number you log in with, to make sure it’s you.</ThemedText>
                    <TouchableOpacity style={[s.button, s.secondary, blocked && s.dim]} disabled={blocked || busy !== null} onPress={sendCode}>
                      {busy === 'code' ? <ActivityIndicator color={C.ink} /> : <ThemedText style={s.buttonText}>Send me a code</ThemedText>}
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <ThemedText style={s.muted}>Code sent to {sentTo}.</ThemedText>
                    <TextInput style={s.input} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={8}
                      placeholder="6-digit code" placeholderTextColor="#94A3B8" />
                    <TouchableOpacity style={[s.button, s.danger, (code.trim().length < 4 || blocked) && s.dim]}
                      disabled={code.trim().length < 4 || blocked || busy !== null} onPress={deleteAccount}>
                      {busy === 'delete' ? <ActivityIndicator color="#FFFFFF" /> : <ThemedText style={[s.buttonText, { color: '#FFFFFF' }]}>Delete my account</ThemedText>}
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </>
          )}
        </KeyboardAwareScrollView>
      )}
      {appAlert.element}
    </ThemedView>
  );
}

function Line({ icon, title, text, last }: { icon: React.ReactNode; title: string; text: string; last?: boolean }) {
  return (
    <View style={[s.line, !last && s.lineBorder]}>
      <View style={s.icon}>{icon}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText style={s.lineTitle}>{title}</ThemedText>
        <ThemedText style={s.muted}>{text}</ThemedText>
      </View>
    </View>
  );
}

const C = { ink: '#0F172A', muted: '#64748B', line: '#ECEEF2', bg: '#F6F7F9', bad: '#B91C1C', warn: '#B45309', brand: '#FFCE48' };
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 56, paddingHorizontal: 16, paddingBottom: 12 },
  back: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: C.line },
  headerTitle: { fontSize: 22, lineHeight: 30, fontFamily: Fonts.poppinsBold, color: C.ink },
  body: { paddingHorizontal: 16, gap: 16 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 16, gap: 10, borderWidth: 1, borderColor: C.line },
  cardWarn: { backgroundColor: '#FFFBEB', borderColor: '#F7DC8B' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15.5, lineHeight: 21, fontFamily: Fonts.poppinsBold, color: C.ink },
  muted: { fontSize: 13, lineHeight: 19, fontFamily: Fonts.poppins, color: C.muted },
  reason: { fontSize: 13.5, lineHeight: 20, fontFamily: Fonts.poppins, color: '#78350F' },
  line: { flexDirection: 'row', gap: 12, paddingVertical: 8 },
  lineBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E2E8F0' },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  lineTitle: { fontSize: 14.5, lineHeight: 20, fontFamily: Fonts.poppinsSemiBold, color: C.ink },
  input: { borderWidth: 1, borderColor: '#DDE1E7', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, fontFamily: Fonts.poppins, color: C.ink, letterSpacing: 2 },
  button: { height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  secondary: { backgroundColor: '#FFFFFF', borderColor: '#D9DDE3' },
  danger: { backgroundColor: C.bad, borderColor: C.bad },
  buttonText: { fontSize: 15, lineHeight: 20, fontFamily: Fonts.poppinsBold, color: C.ink },
  dim: { opacity: 0.45 },
});
