import { AppAlert, useAppAlert } from '@/components/app-alert';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { router } from 'expo-router';
import { ChevronLeft, Copy, Tag, TicketPercent } from 'lucide-react-native';
import React from 'react';
import {
  Clipboard,
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
  expiry: string;
  discount: string;
  color: string;
}

const OFFERS: Offer[] = [
  {
    id: '1',
    code: 'CLEAN20',
    title: '20% Off on Cleaning',
    description: 'Get 20% off up to $100 on your next home cleaning service. Valid for new users only.',
    expiry: 'Expires in 2 days',
    discount: '20%',
    color: '#EC4899',
  },
  {
    id: '2',
    code: 'FIRST50',
    title: 'Flat $50 Off',
    description: 'Flat $50 off on any service above $299. Use this code at checkout.',
    expiry: 'Expires in 5 days',
    discount: '$50',
    color: '#8B5CF6',
  },
  {
    id: '3',
    code: 'SUMMER25',
    title: 'Summer Special',
    description: '25% off on AC Repair and Servicing. Beat the heat with Skofy!',
    expiry: 'Expires Jun 30',
    discount: '25%',
    color: '#F59E0B',
  },
];

export default function OffersScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const alert = useAppAlert();

  const handleCopy = (code: string) => {
    Clipboard.setString(code);
    alert.show('copied', 'Copied!', `Coupon code "${code}" is ready to use.`, undefined, 2000);
  };

  const renderOffer = ({ item, index }: { item: Offer; index: number }) => (
    <Animated.View entering={FadeInUp.delay(index * 100).duration(400)}>
      <View style={styles.offerCard}>
        <View style={[styles.leftStrip, { backgroundColor: item.color }]} />
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
            <ThemedText style={styles.expiryText}>{item.expiry}</ThemedText>
            <TouchableOpacity style={styles.copyButton} onPress={() => handleCopy(item.code)}>
              <ThemedText style={styles.codeText}>{item.code}</ThemedText>
              <Copy size={14} color="#6B7280" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Decorative Circles for "Ticket" look */}
        <View style={styles.circleTop} />
        <View style={styles.circleBottom} />
      </View>
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

      <FlatList
        data={OFFERS}
        renderItem={renderOffer}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
      {alert.element}
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
  headerTitle: { fontSize: 20, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
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
  content: { flex: 1, padding: 16, paddingLeft: 20 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  iconBox: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  discountBadge: { backgroundColor: t.inputFilled, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  discountText: { fontSize: 12, fontFamily: Fonts.poppinsBold },
  offerTitle: { fontSize: 16, fontFamily: Fonts.poppinsBold, color: t.textPrimary, marginBottom: 4 },
  offerDesc: { fontSize: 13, fontFamily: Fonts.poppins, color: t.textSecondary, marginBottom: 16, lineHeight: 20 },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: t.borderSubtle, paddingTop: 12 },
  expiryText: { fontSize: 12, fontFamily: Fonts.poppins, color: '#EF4444' },
  copyButton: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.inputFilled, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderStyle: 'dashed', borderWidth: 1, borderColor: t.border },
  codeText: { fontSize: 13, fontFamily: Fonts.poppinsBold, color: t.textPrimary, letterSpacing: 1 },
  circleTop: { position: 'absolute', top: -10, left: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: t.surface },
  circleBottom: { position: 'absolute', bottom: -10, left: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: t.surface },
}); }
