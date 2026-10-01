import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SkoFyApi } from '@/services/api';
import type { OfferResponse } from '@/types/offer';
import { discountText, expiryText, isExpiryUrgent, OFFER_CARD_COLORS } from '@/utils/offer-format';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ChevronLeft, Tag, TicketPercent } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';

interface Offer {
  id: string;
  code: string;
  title: string;
  description: string;
  imageUrl: string | null;
  expiry: string;
  expiryUrgent: boolean;
  discount: string;
  color: string;
}

export default function OffersScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    SkoFyApi.offers.list()
      .then((data: unknown) => {
        const list = Array.isArray(data) ? (data as OfferResponse[]) : [];
        setOffers(list.map((o, index) => ({
          id: o.id,
          code: o.code,
          title: o.title,
          description: o.description,
          imageUrl: o.image_url,
          expiry: expiryText(o.expires_at),
          expiryUrgent: isExpiryUrgent(o.expires_at),
          discount: discountText(o),
          color: OFFER_CARD_COLORS[index % OFFER_CARD_COLORS.length],
        })));
      })
      .catch((err: unknown) => console.warn('Failed to load offers:', err))
      .finally(() => setLoading(false));
  }, []);

  const openOffer = (offerId: string) => {
    router.push({ pathname: '/offer-detail', params: { offerId } } as any);
  };

  const renderOffer = ({ item, index }: { item: Offer; index: number }) => (
    <Animated.View entering={FadeInUp.delay(index * 100).duration(400)}>
      <TouchableOpacity style={styles.offerCard} activeOpacity={0.85} onPress={() => openOffer(item.id)}>
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={styles.offerImage} contentFit="cover" />
        ) : (
          <View style={[styles.leftStrip, { backgroundColor: item.color }]} />
        )}
        <View style={styles.content}>
          <View style={styles.headerRow}>
            <View style={[styles.iconBox, { backgroundColor: `${item.color}20` }]}>
              <Tag size={20} color={item.color} />
            </View>
            <View style={styles.discountBadge}>
              <ThemedText style={[styles.discountText, { color: item.color }]}>{item.discount} OFF</ThemedText>
            </View>
          </View>

          <ThemedText style={styles.offerTitle}>{item.title}</ThemedText>
          <ThemedText style={styles.offerDesc}>{item.description}</ThemedText>

          <View style={styles.footerRow}>
            <ThemedText style={[styles.expiryText, !item.expiryUrgent && styles.expiryTextMuted]}>
              {item.expiry}
            </ThemedText>
            <View style={styles.claimPill}>
              <ThemedText style={styles.claimPillText}>Claim</ThemedText>
            </View>
          </View>
        </View>

        {/* Decorative Circles for "Ticket" look */}
        <View style={styles.circleTop} />
        <View style={styles.circleBottom} />
      </TouchableOpacity>
    </Animated.View>
  );

  return (
    <ThemedView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={24} color={themeColors.textPrimary} />
        </TouchableOpacity>
        <ThemedText style={styles.headerTitle}>Offers & Promos</ThemedText>
        <TicketPercent size={24} color={themeColors.textPrimary} />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={themeColors.textPrimary} />
        </View>
      ) : offers.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ThemedText style={styles.emptyText}>No offers available right now.</ThemedText>
        </View>
      ) : (
        <FlatList
          data={offers}
          renderItem={renderOffer}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </ThemedView>
  );
}

function makeStyles(t: typeof Colors.light) { return StyleSheet.create({
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
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.inputFilled,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 20, lineHeight: 25, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  emptyText: { fontSize: 14, fontFamily: Fonts.poppins, color: t.textMuted },
  listContent: { padding: 20 },
  offerCard: {
    backgroundColor: t.card,
    borderRadius: 16,
    marginBottom: 16,
    flexDirection: 'row',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    overflow: 'hidden',
    position: 'relative',
  },
  leftStrip: { width: 6, height: '100%' },
  offerImage: { width: 96, height: '100%' },
  content: { flex: 1, padding: 16, paddingLeft: 20 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  iconBox: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  discountBadge: { backgroundColor: t.inputFilled, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  discountText: { fontSize: 12, lineHeight: 16, fontFamily: Fonts.poppinsBold },
  offerTitle: { fontSize: 16, lineHeight: 20, fontFamily: Fonts.poppinsBold, color: t.textPrimary, marginBottom: 4 },
  offerDesc: { fontSize: 13, fontFamily: Fonts.poppins, color: t.textSecondary, marginBottom: 16, lineHeight: 20 },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: t.borderSubtle, paddingTop: 12 },
  // Red is reserved for genuinely urgent ("Expired"/"Expires tomorrow") —
  // muted for anything with real runway left, like "Expires in 4 days".
  expiryText: { fontSize: 12, lineHeight: 16, fontFamily: Fonts.poppins, color: '#EF4444' },
  expiryTextMuted: { color: t.textMuted },
  claimPill: { backgroundColor: '#FFCE48', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  claimPillText: { fontSize: 12, lineHeight: 16, fontFamily: Fonts.poppinsBold, color: '#111827' },
  circleTop: { position: 'absolute', top: -10, left: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: t.surface },
  circleBottom: { position: 'absolute', bottom: -10, left: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: t.surface },
}); }
