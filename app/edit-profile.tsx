import { AcceptedIdDocuments } from '@/components/accepted-id-documents';
import { useAppAlert } from '@/components/app-alert';
import { OfflineScreen, useOfflinePage } from '@/components/offline-gate';
import { Text, TextInput } from '@/components/scaled-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts } from '@/constants/theme';
import { padBottom, useBottomInset } from '@/hooks/use-bottom-inset';
import { SkoFyApi } from '@/services/api';
import { isEmail, tidyEmail } from '@/services/email';
import { NAME_PART_MAX, hasFullName, namePayload } from '@/services/name';
import { router, useFocusEffect } from 'expo-router';
import { BadgeCheck, ChevronLeft, CreditCard, Mail, Phone, User } from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, ScrollView, StatusBar, StyleSheet, TouchableOpacity, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Edit details — reached from Profile's Settings ("Edit details") and from
// Contact Information's Edit. Profile only shows these; changing them is
// here, one page, saved with one clear button. Name, email and ID number;
// the phone is the sign-in and is shown, not edited. Leaving with changes
// asks first.

type Form = { first: string; middle: string; last: string; email: string; idNumber: string };
const EMPTY: Form = { first: '', middle: '', last: '', email: '', idNumber: '' };

const trimmed = (f: Form): Form => ({
  first: f.first.trim(), middle: f.middle.trim(), last: f.last.trim(),
  email: f.email.trim(), idNumber: f.idNumber.trim(),
});
const sameForm = (a: Form, b: Form) => JSON.stringify(trimmed(a)) === JSON.stringify(trimmed(b));

export default function EditProfileScreen() {
  const insets = useSafeAreaInsets();
  const bottomInset = useBottomInset();
  const appAlert = useAppAlert();

  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [phone, setPhone] = useState('');
  const [saved, setSaved] = useState<Form>(EMPTY);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [triedSave, setTriedSave] = useState(false);
  const [emailTaken, setEmailTaken] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const p: any = await SkoFyApi.customers.getProfile();
      const values: Form = {
        first: p.first_name ?? '', middle: p.middle_name ?? '', last: p.last_name ?? '',
        email: p.email ?? '', idNumber: p.id_number ?? '',
      };
      setPhone(p.phone ?? '');
      setSaved(values);
      setForm(values);
      setLoaded(true);
    } catch {
      setLoadFailed(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const offline = useOfflinePage(loaded, () => { void load(); });

  const changed = loaded && !sameForm(form, saved);
  const nameError = !hasFullName({ first: form.first, middle: form.middle, last: form.last })
    ? 'Enter your first and last name.' : null;
  const emailError = emailTaken
    ?? (form.email.trim() && !isEmail(form.email) ? 'Enter a valid email, like name@example.com.'
      : !form.email.trim() && saved.email ? 'Your email can be changed, not removed.' : null);
  const canSave = changed && !nameError && !emailError && !saving;

  const set = (key: keyof Form) => (text: string) => {
    setForm((f) => ({ ...f, [key]: text }));
    if (key === 'email') setEmailTaken(null);
  };

  // Back with unsaved changes: ask first. (Android's back button too.)
  const changedRef = useRef(changed);
  changedRef.current = changed;
  const leave = useCallback(() => {
    if (!changedRef.current) {
      router.back();
      return;
    }
    appAlert.show('warning', 'Discard changes?', "Your changes haven't been saved.", [
      { text: 'Keep editing', variant: 'secondary' },
      { text: 'Discard', variant: 'destructive', onPress: () => router.back() },
    ]);
  }, [appAlert]);
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { leave(); return true; });
    return () => sub.remove();
  }, [leave]));

  const save = async () => {
    setTriedSave(true);
    if (!canSave) return;
    const next = trimmed(form);
    setSaving(true);
    try {
      await SkoFyApi.customers.updateProfile({
        ...namePayload({ first: next.first, middle: next.middle, last: next.last }),
        id_number: next.idNumber || undefined,
        ...(next.email && next.email !== saved.email.trim() ? { email: tidyEmail(next.email) } : {}),
      });
      setSaved(next);
      setForm(next);
      appAlert.show('success', 'Saved', 'Your details are updated.', undefined, 1200, () => router.back());
    } catch (err: any) {
      if (err?.error_code === 'EMAIL_ALREADY_EXISTS') setEmailTaken(err.message ?? 'That email is already in use.');
      else appAlert.show('error', 'Not saved', err?.message ?? 'Please check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  if (offline) return <OfflineScreen onRetry={() => { void load(); }} />;

  return (
    <ThemedView style={s.container}>
      <StatusBar barStyle="dark-content" />
      <View style={[s.header, { paddingTop: Math.max(insets.top, 20) + 8 }]}>
        <TouchableOpacity style={s.back} onPress={leave} accessibilityLabel="Back">
          <ChevronLeft size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Edit details</Text>
      </View>

      {!loaded ? (
        <View style={s.center}>
          {loadFailed ? (
            <>
              <Text style={s.muted}>Your details couldn't be loaded.</Text>
              <TouchableOpacity style={s.retry} onPress={() => { void load(); }}>
                <Text style={s.retryText}>Try again</Text>
              </TouchableOpacity>
            </>
          ) : <ActivityIndicator size="large" color="#FFCE48" />}
        </View>
      ) : (
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            <Section icon={<User size={18} color="#6B7280" />} title="Your name"
              hint="As on your ID — providers see your first name.">
              <Field label="First name" required value={form.first} onChangeText={set('first')}
                autoCapitalize="words" maxLength={NAME_PART_MAX} placeholder="e.g. Sam" />
              <Field label="Middle name" value={form.middle} onChangeText={set('middle')}
                autoCapitalize="words" maxLength={NAME_PART_MAX} placeholder="Optional" />
              <Field label="Last name" required value={form.last} onChangeText={set('last')}
                autoCapitalize="words" maxLength={NAME_PART_MAX} placeholder="e.g. Taylor" />
              {triedSave && nameError && <Text style={s.error}>{nameError}</Text>}
            </Section>

            <Section icon={<Mail size={18} color="#6B7280" />} title="Email"
              hint="For receipts and getting back into your account.">
              <Field label="Email address" value={form.email} onChangeText={set('email')}
                keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
                placeholder="name@example.com" error={(triedSave || !!emailTaken) ? emailError : null} />
            </Section>

            <Section icon={<CreditCard size={18} color="#6B7280" />} title="ID number"
              hint="From the ID you show — your ID photos are on your Profile.">
              <Field label="ID number" value={form.idNumber} onChangeText={set('idNumber')}
                autoCapitalize="characters" autoCorrect={false} placeholder="e.g. driver's license number" />
              <AcceptedIdDocuments />
            </Section>

            <Section icon={<Phone size={18} color="#6B7280" />} title="Phone number"
              hint="You sign in with it, so it can't be changed here — contact support to change it.">
              <View style={s.readOnly}>
                <Text style={s.readOnlyText}>{phone || '—'}</Text>
                <View style={s.verified}>
                  <BadgeCheck size={14} color="#10B981" />
                  <Text style={s.verifiedText}>Verified</Text>
                </View>
              </View>
            </Section>
          </ScrollView>

          <View style={padBottom(s.saveBar, bottomInset)}>
            <TouchableOpacity style={[s.saveBtn, !canSave && s.saveBtnOff]} onPress={save} disabled={saving}
              accessibilityRole="button" accessibilityState={{ disabled: !canSave }}>
              {saving ? <ActivityIndicator color="#111827" />
                : <Text style={[s.saveText, !canSave && s.saveTextOff]}>{changed ? 'Save changes' : 'No changes yet'}</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
      {appAlert.element}
    </ThemedView>
  );
}

function Section({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        {icon}
        <Text style={s.cardTitle}>{title}</Text>
      </View>
      {!!hint && <Text style={s.hint}>{hint}</Text>}
      <View style={{ gap: 12 }}>{children}</View>
    </View>
  );
}

function Field({ label, required, error, ...input }: React.ComponentProps<typeof TextInput> & {
  label: string; required?: boolean; error?: string | null;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}{required ? <Text style={s.required}> *</Text> : null}</Text>
      <TextInput {...input} style={[s.input, !!error && s.inputError]} placeholderTextColor="#9CA3AF" />
      {!!error && <Text style={s.error}>{error}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  back: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F4F6' },
  headerTitle: { fontSize: 19, lineHeight: 26, fontFamily: Fonts.poppinsBold, color: '#111827' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  muted: { fontSize: 14, lineHeight: 20, fontFamily: Fonts.poppins, color: '#6B7280', textAlign: 'center' },
  retry: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, backgroundColor: '#FFCE48' },
  retryText: { fontSize: 14, lineHeight: 19, fontFamily: Fonts.poppinsBold, color: '#111827' },
  body: { padding: 16, gap: 14, paddingBottom: 24 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 16, gap: 10, borderWidth: 1, borderColor: '#F3F4F6' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, lineHeight: 21, fontFamily: Fonts.poppinsBold, color: '#111827' },
  hint: { fontSize: 12, lineHeight: 17, fontFamily: Fonts.poppins, color: '#6B7280', marginTop: -4 },
  label: { fontSize: 12.5, lineHeight: 17, fontFamily: Fonts.poppinsSemiBold, color: '#374151' },
  required: { color: '#EF4444', fontFamily: Fonts.poppinsSemiBold },
  input: { height: 48, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 14, backgroundColor: '#F9FAFB', fontSize: 15, fontFamily: Fonts.poppins, color: '#111827' },
  inputError: { borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' },
  error: { fontSize: 12, lineHeight: 17, fontFamily: Fonts.poppinsSemiBold, color: '#DC2626' },
  readOnly: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 48, borderRadius: 12, paddingHorizontal: 14, backgroundColor: '#F3F4F6' },
  readOnlyText: { fontSize: 15, lineHeight: 21, fontFamily: Fonts.poppinsSemiBold, color: '#6B7280' },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#ECFDF5', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  verifiedText: { fontSize: 11.5, lineHeight: 16, fontFamily: Fonts.poppinsBold, color: '#10B981' },
  saveBar: { paddingHorizontal: 16, paddingTop: 12, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  saveBtn: { height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFCE48' },
  saveBtnOff: { backgroundColor: '#F3F4F6' },
  saveText: { fontSize: 16, lineHeight: 22, fontFamily: Fonts.poppinsBold, color: '#111827' },
  saveTextOff: { color: '#9CA3AF' },
});
