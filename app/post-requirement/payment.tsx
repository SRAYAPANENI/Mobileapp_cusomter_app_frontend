import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  AmazonPayLogo,
  BhimLogo,
  FreeChargeLogo,
  GPayLogo,
  MobiKwikLogo,
  PaytmLogo,
  PhonePeLogo,
} from '@/components/UpiLogos';
import { Colors, Fonts } from '@/constants/theme';
import { useAppContext } from '@/context/AppContext';
import { usePostRequirement } from '@/context/PostRequirementContext';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CreditCard,
  Lock,
  Shield,
  Smartphone,
  Wallet,
} from 'lucide-react-native';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  FadeInDown,
  FadeInUp,
  ZoomIn
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Types ────────────────────────────────────────────────────────────────────
type PaymentMethod = 'upi' | 'card' | 'netbanking' | 'wallet';
type UpiApp = 'phonepe' | 'gpay' | 'paytm' | 'bhim';
type WalletApp = 'amazonpay' | 'mobikwik' | 'freecharge';

// ─── UPI App Data ─────────────────────────────────────────────────────────────
const UPI_APPS: { id: UpiApp; name: string; Logo: React.FC<{ size?: number }> }[] = [
  { id: 'phonepe', name: 'PhonePe', Logo: PhonePeLogo },
  { id: 'gpay', name: 'GPay', Logo: GPayLogo },
  { id: 'paytm', name: 'Paytm', Logo: PaytmLogo },
  { id: 'bhim', name: 'BHIM', Logo: BhimLogo },
];

const WALLET_APPS: { id: WalletApp; name: string; Logo: React.FC<{ size?: number }> }[] = [
  { id: 'amazonpay', name: 'Amazon Pay', Logo: AmazonPayLogo },
  { id: 'mobikwik', name: 'MobiKwik', Logo: MobiKwikLogo },
  { id: 'freecharge', name: 'FreeCharge', Logo: FreeChargeLogo },
];

const NET_BANKS = ['SBI', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Kotak Bank', 'PNB'];

// ─── Price Map ────────────────────────────────────────────────────────────────
const RANGE_PRICE: Record<string, number> = {
  '1-5km': 15,
  '6-15km': 20,
  '16-25km': 25,
};

function getPrice(range: string): number {
  if (RANGE_PRICE[range]) return RANGE_PRICE[range];
  // manual-Xmi — summary.tsx's custom radius picker is miles-based (US
  // launch), the IDs for the fixed presets above stay km-based internally
  // since that's what's actually sent to the backend's distribution radius.
  const match = range.match(/manual-(\d+)mi/);
  if (match) {
    const miles = parseInt(match[1], 10);
    return Math.round(10 + miles * 0.5);
  }
  return 15;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function PaymentScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const insets = useSafeAreaInsets();
  const { data } = usePostRequirement();
  const { setIsLoading, showFeedback } = useAppContext();
  const params = useLocalSearchParams<{ range: string }>();
  const selectedRange = params.range ?? '1-5km';

  const amount = getPrice(selectedRange);
  const gst = Math.round(amount * 0.18 * 100) / 100;
  const total = Math.round((amount + gst) * 100) / 100;

  // ── State ──────────────────────────────────────────────────────────────────
  const [activeMethod, setActiveMethod] = useState<PaymentMethod>('upi');
  const [selectedUpi, setSelectedUpi] = useState<UpiApp | null>(null);
  const [upiId, setUpiId] = useState('');
  const [selectedWallet, setSelectedWallet] = useState<WalletApp | null>(null);
  const [selectedBank, setSelectedBank] = useState<string | null>(null);
  const [cardNumber, setCardNumber] = useState('');
  const [cardName, setCardName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [cardType, setCardType] = useState<'debit' | 'credit'>('debit');

  const [showProcessing, setShowProcessing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const formatCard = (val: string) =>
    val.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();

  const formatExpiry = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 4);
    if (digits.length >= 3) return digits.slice(0, 2) + '/' + digits.slice(2);
    return digits;
  };

  const handlePay = () => {
    setShowProcessing(true);
    // Simulate payment processing (2.5 s)
    setTimeout(() => {
      setShowProcessing(false);
      setShowSuccess(true);
    }, 2500);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ArrowLeft size={24} color={themeColors.text} />
          </TouchableOpacity>
          <ThemedText style={styles.headerTitle}>Secure Payment</ThemedText>
          <View style={styles.secureTag}>
            <Lock size={12} color="#10B981" />
            <ThemedText style={styles.secureTagText}>SSL</ThemedText>
          </View>
        </View>

        {/* ── Order Summary ── */}
        <Animated.View entering={FadeInDown.delay(100)} style={styles.orderCard}>
          <View style={styles.orderRow}>
            <ThemedText style={styles.orderLabel}>Service Fee</ThemedText>
            <ThemedText style={styles.orderValue}>₹{amount.toFixed(2)}</ThemedText>
          </View>
          <View style={styles.orderRow}>
            <ThemedText style={styles.orderLabel}>GST (18%)</ThemedText>
            <ThemedText style={styles.orderValue}>₹{gst.toFixed(2)}</ThemedText>
          </View>
          <View style={styles.divider} />
          <View style={styles.orderRow}>
            <ThemedText style={styles.totalLabel}>Total Payable</ThemedText>
            <ThemedText style={[styles.totalValue, { color: themeColors.brand === '#FFCE48' ? themeColors.textPrimary : themeColors.brand }]}>
              ₹{total.toFixed(2)}
            </ThemedText>
          </View>
        </Animated.View>

        {/* ── Method Tabs ── */}
        <Animated.View entering={FadeInDown.delay(200)} style={styles.tabRow}>
          {([
            { id: 'upi', label: 'UPI', Icon: Smartphone },
            { id: 'card', label: 'Card', Icon: CreditCard },
            { id: 'netbanking', label: 'Net Banking', Icon: Shield },
            { id: 'wallet', label: 'Wallets', Icon: Wallet },
          ] as { id: PaymentMethod; label: string; Icon: any }[]).map(({ id, label, Icon }) => {
            const active = activeMethod === id;
            return (
              <TouchableOpacity
                key={id}
                style={[styles.tab, active && { backgroundColor: '#FFCE48', borderColor: '#FFCE48' }]}
                onPress={() => setActiveMethod(id)}
              >
                <Icon size={14} color={active ? '#111827' : themeColors.textSecondary} />
                <ThemedText style={[styles.tabLabel, active && { color: '#111827', fontFamily: Fonts.poppinsBold }]}>
                  {label}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </Animated.View>

        {/* ── UPI Section ── */}
        {activeMethod === 'upi' && (
          <Animated.View entering={FadeInUp.delay(100)} style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Pay via UPI App</ThemedText>
            <View style={styles.upiGrid}>
              {UPI_APPS.map((app) => {
                const selected = selectedUpi === app.id;
                return (
                  <TouchableOpacity
                    key={app.id}
                    style={[
                      styles.upiCard,
                      selected && { borderColor: '#FFCE48', borderWidth: 2, backgroundColor: '#FFFBEB' },
                    ]}
                    onPress={() => setSelectedUpi(app.id)}
                  >
                    <View style={styles.upiLogoWrapper}>
                      <app.Logo size={44} />
                    </View>
                    <ThemedText style={[styles.upiName, selected && { color: themeColors.textPrimary, fontFamily: Fonts.poppinsBold }]}>
                      {app.name}
                    </ThemedText>
                    {selected && <Check size={14} color="#FFCE48" style={{ marginTop: 4 }} />}
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.orRow}>
              <View style={styles.orLine} />
              <ThemedText style={styles.orText}>or enter UPI ID</ThemedText>
              <View style={styles.orLine} />
            </View>

            <View style={styles.inputWrapper}>
              <Smartphone size={18} color={themeColors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="yourname@upi"
                placeholderTextColor={themeColors.textMuted}
                value={upiId}
                onChangeText={setUpiId}
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>
          </Animated.View>
        )}

        {/* ── Card Section ── */}
        {activeMethod === 'card' && (
          <Animated.View entering={FadeInUp.delay(100)} style={styles.section}>
            {/* Debit / Credit Toggle */}
            <View style={styles.cardTypeRow}>
              {(['debit', 'credit'] as const).map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.cardTypeBtn,
                    cardType === type && { backgroundColor: '#FFCE48' },
                  ]}
                  onPress={() => setCardType(type)}
                >
                  <ThemedText
                    style={[
                      styles.cardTypeBtnText,
                      cardType === type && { color: '#111827', fontFamily: Fonts.poppinsBold },
                    ]}
                  >
                    {type === 'debit' ? 'Debit Card' : 'Credit Card'}
                  </ThemedText>
                </TouchableOpacity>
              ))}
            </View>

            {/* Visual Card Preview */}
            <View style={styles.cardPreview}>
              <View style={styles.cardPreviewTop}>
                <ThemedText style={styles.cardPreviewBank}>
                  {cardType === 'debit' ? 'DEBIT CARD' : 'CREDIT CARD'}
                </ThemedText>
                <View style={styles.cardChip} />
              </View>
              <ThemedText style={styles.cardPreviewNumber}>
                {cardNumber || '•••• •••• •••• ••••'}
              </ThemedText>
              <View style={styles.cardPreviewBottom}>
                <View>
                  <ThemedText style={styles.cardPreviewMiniLabel}>CARD HOLDER</ThemedText>
                  <ThemedText style={styles.cardPreviewMiniValue}>
                    {cardName || 'YOUR NAME'}
                  </ThemedText>
                </View>
                <View>
                  <ThemedText style={styles.cardPreviewMiniLabel}>EXPIRES</ThemedText>
                  <ThemedText style={styles.cardPreviewMiniValue}>{expiry || 'MM/YY'}</ThemedText>
                </View>
              </View>
            </View>

            {/* Card Fields */}
            <View style={styles.fieldGroup}>
              <ThemedText style={styles.fieldLabel}>Card Number</ThemedText>
              <View style={styles.inputWrapper}>
                <CreditCard size={18} color={themeColors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="1234 5678 9012 3456"
                  placeholderTextColor={themeColors.textMuted}
                  value={cardNumber}
                  onChangeText={(v) => setCardNumber(formatCard(v))}
                  keyboardType="numeric"
                  maxLength={19}
                />
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <ThemedText style={styles.fieldLabel}>Name on Card</ThemedText>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={[styles.input, { paddingLeft: 16 }]}
                  placeholder="Full Name"
                  placeholderTextColor={themeColors.textMuted}
                  value={cardName}
                  onChangeText={setCardName}
                  autoCapitalize="words"
                />
              </View>
            </View>

            <View style={styles.rowFields}>
              <View style={[styles.fieldGroup, { flex: 1, marginRight: 8 }]}>
                <ThemedText style={styles.fieldLabel}>Expiry</ThemedText>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={[styles.input, { paddingLeft: 16 }]}
                    placeholder="MM/YY"
                    placeholderTextColor={themeColors.textMuted}
                    value={expiry}
                    onChangeText={(v) => setExpiry(formatExpiry(v))}
                    keyboardType="numeric"
                    maxLength={5}
                  />
                </View>
              </View>
              <View style={[styles.fieldGroup, { flex: 1, marginLeft: 8 }]}>
                <ThemedText style={styles.fieldLabel}>CVV</ThemedText>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={[styles.input, { paddingLeft: 16 }]}
                    placeholder="•••"
                    placeholderTextColor={themeColors.textMuted}
                    value={cvv}
                    onChangeText={(v) => setCvv(v.replace(/\D/g, '').slice(0, 4))}
                    keyboardType="numeric"
                    secureTextEntry
                    maxLength={4}
                  />
                </View>
              </View>
            </View>

            <View style={styles.infoBox}>
              <Shield size={14} color="#1D4ED8" />
              <ThemedText style={styles.infoBoxText}>
                Your card details are encrypted and never stored.
              </ThemedText>
            </View>
          </Animated.View>
        )}

        {/* ── Net Banking Section ── */}
        {activeMethod === 'netbanking' && (
          <Animated.View entering={FadeInUp.delay(100)} style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Select Your Bank</ThemedText>
            {NET_BANKS.map((bank) => {
              const selected = selectedBank === bank;
              return (
                <TouchableOpacity
                  key={bank}
                  style={[styles.bankRow, selected && { borderColor: '#FFCE48', backgroundColor: '#FFFBEB' }]}
                  onPress={() => setSelectedBank(bank)}
                >
                  <View style={styles.bankInitialBadge}>
                    <ThemedText style={styles.bankInitialText}>{bank[0]}</ThemedText>
                  </View>
                  <ThemedText style={[styles.bankName, selected && { fontFamily: Fonts.poppinsBold, color: themeColors.textPrimary }]}>
                    {bank}
                  </ThemedText>
                  {selected ? (
                    <Check size={18} color="#FFCE48" />
                  ) : (
                    <ChevronRight size={18} color={themeColors.textMuted} />
                  )}
                </TouchableOpacity>
              );
            })}
            <ThemedText style={styles.morebanksText}>+ 50 more banks available at checkout</ThemedText>
          </Animated.View>
        )}

        {/* ── Wallets Section ── */}
        {activeMethod === 'wallet' && (
          <Animated.View entering={FadeInUp.delay(100)} style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Choose Wallet</ThemedText>
            {WALLET_APPS.map((wallet) => {
              const selected = selectedWallet === wallet.id;
              return (
                <TouchableOpacity
                  key={wallet.id}
                  style={[styles.bankRow, selected && { borderColor: '#FFCE48', backgroundColor: '#FFFBEB' }]}
                  onPress={() => setSelectedWallet(wallet.id)}
                >
                  <View style={styles.walletLogoWrapper}>
                    <wallet.Logo size={40} />
                  </View>
                  <ThemedText style={[styles.bankName, selected && { fontFamily: Fonts.poppinsBold, color: themeColors.textPrimary }]}>
                    {wallet.name}
                  </ThemedText>
                  {selected ? (
                    <Check size={18} color="#FFCE48" />
                  ) : (
                    <ChevronRight size={18} color={themeColors.textMuted} />
                  )}
                </TouchableOpacity>
              );
            })}
          </Animated.View>
        )}

        {/* ── Trust Badges ── */}
        <Animated.View entering={FadeInDown.delay(400)} style={styles.trustRow}>
          {[
            { icon: Shield, label: '100% Secure' },
            { icon: Lock, label: 'Encrypted' },
            { icon: Check, label: 'PCI DSS' },
          ].map(({ icon: Icon, label }) => (
            <View key={label} style={styles.trustBadge}>
              <Icon size={14} color="#10B981" />
              <ThemedText style={styles.trustLabel}>{label}</ThemedText>
            </View>
          ))}
        </Animated.View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* ── Pay Button ── */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 36 : 20) + 12 }]}>
        <TouchableOpacity
          style={[styles.payButton, { backgroundColor: '#FFCE48' }]}
          onPress={handlePay}
          activeOpacity={0.85}
        >
          <Lock size={18} color="#111827" style={{ marginRight: 8 }} />
          <ThemedText style={styles.payButtonText}>Pay ₹{total.toFixed(2)} Securely</ThemedText>
        </TouchableOpacity>
      </View>

      {/* ── Processing Modal ── */}
      <Modal visible={showProcessing} transparent animationType="fade">
        <View style={styles.processingOverlay}>
          <Animated.View entering={ZoomIn} style={styles.processingCard}>
            <ActivityIndicator size="large" color="#FFCE48" />
            <ThemedText style={styles.processingTitle}>Processing Payment</ThemedText>
            <ThemedText style={styles.processingSubtitle}>Please do not close this screen…</ThemedText>
          </Animated.View>
        </View>
      </Modal>

      {/* ── Success Modal ── */}
      <Modal visible={showSuccess} transparent animationType="fade">
        <View style={styles.successOverlay}>
          <Animated.View entering={ZoomIn.duration(400).springify()} style={styles.successCard}>
            {/* Outer glow ring */}
            <View style={[styles.successIconOuter, { backgroundColor: '#FFCE4820' }]}>
              <View style={[styles.successIconInner, { backgroundColor: '#FFCE48' }]}>
                <Check size={32} color="#111827" strokeWidth={3} />
              </View>
            </View>

            <ThemedText style={styles.successTitle}>Payment Successful!</ThemedText>
            <ThemedText style={styles.successMessage}>
              ₹{total.toFixed(2)} paid. Your job is now live and nearby professionals are being notified.
            </ThemedText>

            <View style={styles.statusChip}>
              <View style={styles.statusDot} />
              <ThemedText style={styles.statusText}>Job Posted · Waiting for applications</ThemedText>
            </View>

            <TouchableOpacity
              style={[styles.successBtn, { backgroundColor: '#FFCE48' }]}
              onPress={() => {
                setShowSuccess(false);
                router.replace('/(tabs)/home');
              }}
            >
              <ThemedText style={styles.successBtnText}>Go to Dashboard</ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.successBtnOutline}
              onPress={() => {
                setShowSuccess(false);
                router.replace('/my-jobs');
              }}
            >
              <ThemedText style={styles.successBtnOutlineText}>View My Jobs</ThemedText>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>
    </ThemedView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
function makeStyles(t: typeof Colors.light) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: t.surface },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 40,
  },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  backButton: { padding: 8, marginRight: 8 },
  headerTitle: { flex: 1, fontSize: 20, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
  secureTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  secureTagText: { fontSize: 11, fontFamily: Fonts.poppinsSemiBold, color: '#10B981' },

  // Order Card
  orderCard: {
    backgroundColor: t.card,
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
  },
  orderRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  orderLabel: { fontSize: 14, fontFamily: Fonts.poppins, color: t.textSecondary },
  orderValue: { fontSize: 14, fontFamily: Fonts.poppinsSemiBold, color: t.textPrimary },
  divider: { height: 1, backgroundColor: t.inputFilled, marginVertical: 10 },
  totalLabel: { fontSize: 16, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
  totalValue: { fontSize: 20, fontFamily: Fonts.poppinsBold },

  // Method Tabs
  tabRow: { flexDirection: 'row', gap: 8, marginBottom: 20, flexWrap: 'wrap' },
  tab: {
    flex: 1,
    minWidth: 70,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.card,
  },
  tabLabel: { fontSize: 11, fontFamily: Fonts.poppinsSemiBold, color: t.textSecondary },

  // Section
  section: {
    backgroundColor: t.card,
    borderRadius: 24,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  sectionTitle: { fontSize: 16, fontFamily: Fonts.poppinsBold, color: t.textPrimary, marginBottom: 16 },

  // UPI
  upiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 20 },
  upiCard: {
    width: '22%',
    minWidth: 72,
    alignItems: 'center',
    padding: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface,
  },
  upiLogoWrapper: {
    marginBottom: 6,
    borderRadius: 12,
    overflow: 'hidden',
  },
  walletLogoWrapper: {
    borderRadius: 10,
    overflow: 'hidden',
  },
  upiName: { fontSize: 11, fontFamily: Fonts.poppinsSemiBold, color: t.textSecondary, textAlign: 'center' },

  // OR divider
  orRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  orLine: { flex: 1, height: 1, backgroundColor: t.border },
  orText: { marginHorizontal: 12, fontSize: 12, fontFamily: Fonts.poppins, color: t.textMuted },

  // Input
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 14,
    backgroundColor: t.surface,
    height: 52,
    marginBottom: 12,
  },
  inputIcon: { marginLeft: 14, marginRight: 4 },
  input: {
    flex: 1,
    height: '100%',
    fontSize: 15,
    fontFamily: Fonts.poppins,
    color: t.textPrimary,
    paddingHorizontal: 8,
  },

  // Card
  cardTypeRow: {
    flexDirection: 'row',
    backgroundColor: t.inputFilled,
    borderRadius: 14,
    padding: 4,
    marginBottom: 20,
  },
  cardTypeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  cardTypeBtnText: { fontSize: 13, fontFamily: Fonts.poppinsSemiBold, color: t.textSecondary },
  cardPreview: {
    backgroundColor: '#1E1B4B',
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#1E1B4B',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  cardPreviewTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  cardPreviewBank: { fontSize: 12, fontFamily: Fonts.poppinsBold, color: 'rgba(255,255,255,0.7)', letterSpacing: 2 },
  cardChip: { width: 32, height: 24, borderRadius: 6, backgroundColor: '#FFCE48' },
  cardPreviewNumber: { fontSize: 18, fontFamily: Fonts.poppinsBold, color: '#fff', letterSpacing: 3, marginBottom: 24 },
  cardPreviewBottom: { flexDirection: 'row', justifyContent: 'space-between' },
  cardPreviewMiniLabel: { fontSize: 9, fontFamily: Fonts.poppins, color: 'rgba(255,255,255,0.5)', letterSpacing: 1 },
  cardPreviewMiniValue: { fontSize: 13, fontFamily: Fonts.poppinsBold, color: '#fff' },

  fieldGroup: { marginBottom: 12 },
  fieldLabel: { fontSize: 13, fontFamily: Fonts.poppinsSemiBold, color: t.textPrimary, marginBottom: 6 },
  rowFields: { flexDirection: 'row' },

  // Info Box
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EFF6FF',
    padding: 12,
    borderRadius: 12,
    marginTop: 4,
  },
  infoBoxText: { flex: 1, fontSize: 12, fontFamily: Fonts.poppins, color: '#1D4ED8', lineHeight: 18 },

  // Net Banking / Wallets
  bankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface,
    marginBottom: 10,
  },
  bankInitialBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: t.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bankInitialText: { fontSize: 16, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
  bankName: { flex: 1, fontSize: 15, fontFamily: Fonts.poppinsSemiBold, color: t.textPrimary },
  morebanksText: { fontSize: 13, fontFamily: Fonts.poppins, color: '#3B82F6', textAlign: 'center', marginTop: 8 },

  // Trust
  trustRow: { flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 4 },
  trustBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  trustLabel: { fontSize: 12, fontFamily: Fonts.poppinsSemiBold, color: t.textSecondary },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 20,
    backgroundColor: t.card,
    borderTopWidth: 1,
    borderTopColor: t.inputFilled,
  },
  payButton: {
    height: 60,
    borderRadius: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FFCE48',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  payButtonText: { fontSize: 17, fontFamily: Fonts.poppinsBold, color: '#111827' },

  // Processing Modal
  processingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  processingCard: {
    backgroundColor: t.card,
    borderRadius: 28,
    padding: 40,
    alignItems: 'center',
    width: '100%',
    gap: 16,
  },
  processingTitle: { fontSize: 18, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
  processingSubtitle: { fontSize: 13, fontFamily: Fonts.poppins, color: t.textSecondary, textAlign: 'center' },

  // Success Modal
  successOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  successCard: {
    backgroundColor: t.card,
    borderRadius: 32,
    padding: 32,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.15,
    shadowRadius: 30,
    elevation: 10,
  },
  successIconOuter: {
    width: 90, height: 90, borderRadius: 45,
    justifyContent: 'center', alignItems: 'center', marginBottom: 24,
  },
  successIconInner: {
    width: 64, height: 64, borderRadius: 32,
    justifyContent: 'center', alignItems: 'center',
  },
  successTitle: { fontSize: 22, fontFamily: Fonts.poppinsBold, color: t.textPrimary, textAlign: 'center', marginBottom: 12 },
  successMessage: {
    fontSize: 14, fontFamily: Fonts.poppins, color: t.textSecondary,
    textAlign: 'center', lineHeight: 22, marginBottom: 20,
  },
  statusChip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: t.inputFilled, paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20, marginBottom: 28, gap: 8,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981' },
  statusText: { fontSize: 12, fontFamily: Fonts.poppinsSemiBold, color: t.textSecondary },
  successBtn: {
    width: '100%', height: 56, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#FFCE48', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  successBtnText: { fontSize: 16, fontFamily: Fonts.poppinsBold, color: '#111827' },
  successBtnOutline: {
    width: '100%', height: 56, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: t.border,
  },
  successBtnOutlineText: { fontSize: 16, fontFamily: Fonts.poppinsSemiBold, color: t.textSecondary },
}); }
