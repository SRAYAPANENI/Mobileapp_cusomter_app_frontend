import { Fonts } from '@/constants/theme';
import NetInfo from '@react-native-community/netinfo';
import { Wifi, WifiOff } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from './themed-text';

// Same palette as app-alert.tsx's 'error'/'success' types, so this reads as
// part of the same design language rather than a generic OS-style bar.
const CONFIG = {
  offline: { bg: '#FEF2F2', color: '#EF4444', icon: WifiOff, text: 'No Internet Connection' },
  online: { bg: '#ECFDF5', color: '#10B981', icon: Wifi, text: 'Back Online' },
};

export function NetworkStatusBanner() {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<'offline' | 'online' | null>(null);
  const wasOffline = useRef(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      // isInternetReachable starts as null until NetInfo has actually
      // determined it — treat that as "assume online" so we don't flash
      // an offline banner on every cold start.
      const connected = state.isConnected && state.isInternetReachable !== false;
      if (!connected) {
        wasOffline.current = true;
        setStatus('offline');
      } else if (wasOffline.current) {
        wasOffline.current = false;
        setStatus('online');
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (status === 'online') {
      const timer = setTimeout(() => setStatus(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [status]);

  if (!status) return null;

  const cfg = CONFIG[status];
  const Icon = cfg.icon;

  return (
    <Animated.View
      entering={FadeInDown}
      exiting={FadeOutUp}
      style={[styles.banner, { top: insets.top, backgroundColor: cfg.bg, borderBottomColor: cfg.color }]}
    >
      <Icon size={15} color={cfg.color} />
      <ThemedText style={[styles.text, { color: cfg.color }]}>{cfg.text}</ThemedText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 2,
    zIndex: 9999,
    elevation: 9999,
  },
  text: {
    fontSize: 13, lineHeight: 17,
    fontFamily: Fonts.poppinsBold,
  },
});
