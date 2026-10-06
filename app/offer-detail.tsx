import { useAppAlert } from '@/components/app-alert';
import ScratchCard from '@/components/scratch-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SkoFyApi } from '@/services/api';
import type { OfferResponse } from '@/types/offer';
import { discountText, expiryText } from '@/utils/offer-format';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, Copy, ShoppingBag, Tag, TicketPercent, Users } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

const AUDIENCE_LABELS: Record<string, string> = {
  ALL: 'Everyone',
  ALL_CUSTOMERS: 'All customers',
  NEW_CUSTOMERS: 'New customers',
  INACTIVE_CUSTOMERS: 'Customers coming back',
  ALL_PROVIDERS: 'Service providers',
  VIP_USERS: 'VIP members',
};

export default function OfferDetailScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const alert = useAppAlert();
  const { offerId } = useLocalSearchParams<{ offerId?: string }>();

  const [offer, setOffer] = useState<OfferResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimedCode, setClaimedCode] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  const load = useCallback(async () => {
    if (!offerId) { setNotFound(true); setLoading(false); return; }
    try {
      const data = await SkoFyApi.offers.get(offerId) as OfferResponse;
      setOffer(data);
      // Already claimed on an earlier visit — ScratchCard always mounts
      // fully covered (it has no "start pre-revealed" prop, and has no way
      // to know this itself), so without this a returning user would have
      // to scratch through the exact same card again just to see a code
      // they'd already unlocked. Skip the mechanic entirely and show it
      // plainly instead; the one-time scratch reveal only makes sense the
      // first time.
      if (data.claimed_by_me) {
        setClaimedCode(data.code);
        setRevealed(true);
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [offerId]);

  useEffect(() => { load(); }, [load]);

  const handleClaim = async () => {
    if (!offerId) return;
    setClaiming(true);
    try {
      const claimed = await SkoFyApi.offers.claim(offerId) as OfferResponse;
      setClaimedCode(claimed.code);
    } catch (err: any) {
      alert.show('error', 'Unable to Claim', err?.message ?? 'This offer could not be claimed right now.');
    } finally {
      setClaiming(false);
    }
  };

  const handleRevealed = () => {
    setRevealed(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  const handleCopy = async () => {
    if (!claimedCode) return;
    await Clipboard.setStringAsync(claimedCode);
    alert.show('copied', 'Copied!', `Coupon code "${claimedCode}" is ready to use.`, undefined, 2000);
  };

  return (
    <ThemedView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={24} color={themeColors.textPrimary} />
        </TouchableOpacity>
        <ThemedText style={styles.headerTitle}>Offer Details</ThemedText>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={themeColors.textPrimary} />
        </View>
      ) : notFound || !offer ? (
        <View style={styles.centerFill}>
          <TicketPercent size={40} color="#D1D5DB" />
          <ThemedText style={styles.emptyText}>This offer isn't available anymore.</ThemedText>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {offer.image_url ? (
            <Image source={{ uri: offer.image_url }} style={styles.banner} contentFit="cover" />
          ) : (
            <View style={[styles.banner, styles.bannerFallback]}>
              <TicketPercent size={40} color="#F59E0B" />
            </View>
          )}

          <View style={styles.discountBadge}>
            <ThemedText style={styles.discountBadgeText}>{discountText(offer)} OFF</ThemedText>
          </View>

          <ThemedText style={styles.title}>{offer.title}</ThemedText>
          <ThemedText style={styles.description}>{offer.description}</ThemedText>

          <View style={styles.termsCard}>
            <View style={styles.termRow}>
              <Users size={16} color="#6B7280" />
              <ThemedText style={styles.termText}>
                {AUDIENCE_LABELS[offer.target_audience] ?? offer.target_audience}
              </ThemedText>
            </View>
            {offer.min_order_value > 0 && (
              <View style={styles.termRow}>
                <ShoppingBag size={16} color="#6B7280" />
                <ThemedText style={styles.termText}>Min. order ${offer.min_order_value}</ThemedText>
              </View>
            )}
            <View style={styles.termRow}>
              <Tag size={16} color="#6B7280" />
              <ThemedText style={styles.termText}>{expiryText(offer.expires_at)}</ThemedText>
            </View>
          </View>

          {!claimedCode ? (
            // Sold-out only blocks NEW claims — a user who already claimed
            // this offer (claimed_by_me) must still be able to get back to
            // their own code even after the pool fills up for everyone else.
            !offer.claimed_by_me && offer.redemptions_count >= offer.max_redemptions ? (
              <View style={[styles.claimButton, styles.claimButtonDisabled]}>
                <ThemedText style={styles.claimButtonDisabledText}>Fully Claimed</ThemedText>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.claimButton, claiming && { opacity: 0.7 }]}
                onPress={handleClaim}
                disabled={claiming}
                activeOpacity={0.88}
              >
                {claiming ? (
                  <ActivityIndicator color="#111827" />
                ) : (
                  <ThemedText style={styles.claimButtonText}>
                    {offer.claimed_by_me ? 'View My Code' : 'Claim Offer'}
                  </ThemedText>
                )}
              </TouchableOpacity>
            )
          ) : revealed ? (
            // Either just finished scratching this session, or this was
            // already claimed on an earlier visit (see load()) — either way
            // there's nothing left to scratch, so show the code plainly
            // instead of a ScratchCard that would just start fully covered.
            <View style={styles.scratchWrap}>
              <View style={[styles.scratchCard, styles.revealedStatic]}>
                <View style={styles.revealInner}>
                  <ThemedText style={styles.revealLabel}>Your promo code</ThemedText>
                  <ThemedText style={styles.revealCode}>{claimedCode}</ThemedText>
                </View>
              </View>
              <TouchableOpacity style={styles.copyButton} onPress={handleCopy} activeOpacity={0.85}>
                <Copy size={15} color="#111827" />
                <ThemedText style={styles.copyButtonText}>Copy Code</ThemedText>
              </TouchableOpacity>
              <ThemedText style={styles.useHint}>
                Apply it at checkout when you pay for a job. It can be used once.
              </ThemedText>
            </View>
          ) : (
            <View style={styles.scratchWrap}>
              <ScratchCard
                style={styles.scratchCard}
                onRevealed={handleRevealed}
                hintLabel="Scratch to reveal your code"
                revealContent={
                  <View style={styles.revealInner}>
                    <ThemedText style={styles.revealLabel}>Your promo code</ThemedText>
                    <ThemedText style={styles.revealCode}>{claimedCode}</ThemedText>
                  </View>
                }
              />
            </View>
          )}
        </ScrollView>
      )}
    </ThemedView>
  );
}

function makeStyles(t: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.surface },
    header: {
      paddingTop: Platform.OS === 'ios' ? 60 : 40,
      paddingHorizontal: 20,
      paddingBottom: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: t.card,
    },
    backButton: {
      width: 40, height: 40, borderRadius: 20,
      backgroundColor: t.inputFilled, justifyContent: 'center', alignItems: 'center',
    },
    headerTitle: { fontSize: 20, lineHeight: 25, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
    centerFill: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 20 },
    emptyText: { fontSize: 14, fontFamily: Fonts.poppins, color: t.textMuted, textAlign: 'center' },
    scrollContent: { padding: 20, paddingBottom: 60 },
    banner: { width: '100%', height: 170, borderRadius: 20, marginBottom: 16, backgroundColor: t.inputFilled },
    bannerFallback: { justifyContent: 'center', alignItems: 'center' },
    discountBadge: {
      alignSelf: 'flex-start', backgroundColor: '#FFF7ED', paddingHorizontal: 12,
      paddingVertical: 6, borderRadius: 10, marginBottom: 10,
    },
    discountBadgeText: { fontSize: 13, fontFamily: Fonts.poppinsBold, color: '#F97316' },
    title: { fontSize: 22, lineHeight: 28, fontFamily: Fonts.poppinsBold, color: t.textPrimary, marginBottom: 8 },
    description: { fontSize: 14, lineHeight: 21, fontFamily: Fonts.poppins, color: t.textSecondary, marginBottom: 20 },
    termsCard: {
      backgroundColor: t.card, borderRadius: 16, padding: 16, gap: 12,
      borderWidth: 1, borderColor: t.borderSubtle, marginBottom: 24,
    },
    termRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    termText: { fontSize: 13, fontFamily: Fonts.poppins, color: t.textSecondary },
    claimButton: {
      backgroundColor: '#FFCE48', borderRadius: 16, paddingVertical: 16,
      alignItems: 'center', justifyContent: 'center',
    },
    claimButtonText: { fontSize: 15, fontFamily: Fonts.poppinsBold, color: '#111827' },
    claimButtonDisabled: { backgroundColor: t.inputFilled },
    claimButtonDisabledText: { fontSize: 15, fontFamily: Fonts.poppinsBold, color: t.textMuted },
    scratchWrap: { alignItems: 'center', gap: 14 },
    scratchCard: { width: '100%', height: 150 },
    revealedStatic: {
      justifyContent: 'center', alignItems: 'center', backgroundColor: t.card,
      borderWidth: 1, borderColor: t.borderSubtle,
    },
    revealInner: { alignItems: 'center', gap: 6 },
    revealLabel: { fontSize: 12, fontFamily: Fonts.poppins, color: '#6B7280' },
    revealCode: { fontSize: 24, fontFamily: Fonts.poppinsBold, color: '#111827', letterSpacing: 2 },
    copyButton: {
      flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.inputFilled,
      paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12,
    },
    copyButtonText: { fontSize: 14, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
    useHint: { fontSize: 12, lineHeight: 17, fontFamily: Fonts.poppins, color: t.textSecondary, textAlign: 'center', marginTop: 10 },
  });
}
