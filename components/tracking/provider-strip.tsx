import { ThemedText } from '@/components/themed-text';
import { VehicleIcon } from '@/components/vehicle-icon';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Image } from 'expo-image';
import { MessageCircle, MoreHorizontal, Phone, ShieldCheck, Star } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

export interface StripProvider {
  name: string;
  role: string;
  rating: number;
  image: string | null;
}

export interface StripVehicle {
  description: string;
  vehicle_type?: string;
  plate?: string;
  plate_state?: string;
}

// Who's coming, in one row: photo, name, trade and rating, the vehicle to
// look out for, and the ways to reach them — call and chat — with everything
// else (cancel, report, help) behind the "more" button.
export function ProviderStrip({ provider, vehicle, onOpenProfile, onCall, onChat, onMore }: {
  provider: StripProvider | null;
  vehicle: StripVehicle | null;
  onOpenProfile: () => void;
  onCall: () => void;
  onChat: () => void;
  onMore: () => void;
}) {
  const t = Colors[useColorScheme() ?? 'light'];
  return (
    <View style={s.wrap}>
      <TouchableOpacity
        style={s.who}
        onPress={onOpenProfile}
        disabled={!provider}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${provider?.name ?? 'Provider'}, view profile`}
      >
        <View>
          <Image
            source={provider?.image ? { uri: provider.image } : require('@/assets/images/icon-mark.png')}
            style={[s.avatar, { backgroundColor: t.inputFilled }]}
          />
          <View style={[s.verified, { borderColor: t.card }]}>
            <ShieldCheck size={11} color="#fff" />
          </View>
        </View>
        <View style={s.info}>
          <ThemedText style={[s.name, { color: t.textPrimary }]} numberOfLines={1}>{provider?.name ?? 'Your provider'}</ThemedText>
          <View style={s.meta}>
            <Star size={12} color="#F59E0B" fill="#F59E0B" />
            <ThemedText style={[s.metaStrong, { color: t.textPrimary }]}>{(provider?.rating ?? 0).toFixed(1)}</ThemedText>
            {!!provider?.role && (
              <ThemedText style={[s.metaText, { color: t.textSecondary }]} numberOfLines={1}> · {provider.role}</ThemedText>
            )}
          </View>
          {vehicle && (
            <View style={s.vehicle}>
              <VehicleIcon type={vehicle.vehicle_type} size={13} color={t.textSecondary} />
              <ThemedText style={[s.metaText, { color: t.textSecondary, flexShrink: 1 }]} numberOfLines={1}>{vehicle.description}</ThemedText>
              {!!vehicle.plate && (
                <View style={s.plate}>
                  <ThemedText style={s.plateText}>{vehicle.plate}</ThemedText>
                </View>
              )}
            </View>
          )}
        </View>
      </TouchableOpacity>

      <View style={s.actions}>
        <RoundButton label="Call" onPress={onCall} background="#FFCE48">
          <Phone size={19} color="#111827" />
        </RoundButton>
        <RoundButton label="Chat" onPress={onChat} background="#111827">
          <MessageCircle size={19} color="#fff" />
        </RoundButton>
        <RoundButton label="More options" onPress={onMore} background={t.inputFilled}>
          <MoreHorizontal size={19} color={t.textPrimary} />
        </RoundButton>
      </View>
    </View>
  );
}

function RoundButton({ label, onPress, background, children }: {
  label: string; onPress: () => void; background: string; children: React.ReactNode;
}) {
  return (
    <TouchableOpacity
      style={[s.round, { backgroundColor: background }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
    >
      {children}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 52, height: 52, borderRadius: 26 },
  verified: {
    position: 'absolute', right: -2, bottom: -2, width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#10B981', alignItems: 'center', justifyContent: 'center', borderWidth: 2,
  },
  info: { flex: 1, gap: 1 },
  name: { fontSize: 16, lineHeight: 22, fontFamily: Fonts.poppinsBold },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaStrong: { fontSize: 12.5, lineHeight: 17, fontFamily: Fonts.poppinsSemiBold },
  metaText: { fontSize: 12.5, lineHeight: 17, fontFamily: Fonts.poppins },
  vehicle: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  plate: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5, borderWidth: 1.5, borderColor: '#111827', backgroundColor: '#FFFFFF' },
  plateText: { fontSize: 11, lineHeight: 15, fontFamily: Fonts.poppinsBold, color: '#111827', letterSpacing: 0.8 },
  actions: { flexDirection: 'row', gap: 8 },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
