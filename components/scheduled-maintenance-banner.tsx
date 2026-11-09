import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAppConfig } from '@/services/queries/app-config';
import { CalendarClock, X } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';

const DISMISS_KEY = 'maintenance_schedule_dismissed_for';

function formatScheduled(iso: string): string {
  return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Advance warning, not a block — the admin portal's "schedule a future
// start" (app_configs.maintenance_scheduled_at). The app keeps working
// completely normally until that time actually arrives; MaintenanceGate
// only blocks once maintenance_enabled itself goes live. Dismissed per the
// exact scheduled value — rescheduling or extending it un-dismisses, since
// it's materially new information, not the same notice again.
export default function ScheduledMaintenanceBanner() {
  const colorScheme = useColorScheme() ?? 'light';
  const t = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(t), [colorScheme]);
  const { data: config } = useAppConfig();
  const scheduledAt = config?.maintenance.scheduled_at;
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    SecureStore.getItemAsync(DISMISS_KEY).then((v) => { if (live) setDismissedFor(v); }).catch(() => {});
    return () => { live = false; };
  }, []);

  if (!scheduledAt || scheduledAt === dismissedFor) return null;

  const dismiss = () => {
    setDismissedFor(scheduledAt);
    SecureStore.setItemAsync(DISMISS_KEY, scheduledAt).catch(() => {});
  };

  return (
    <Animated.View entering={FadeInDown} exiting={FadeOutUp} style={styles.wrap}>
      <CalendarClock size={18} color="#B45309" />
      <ThemedText style={styles.text} numberOfLines={2}>
        {config?.maintenance.message
          ? `${config.maintenance.message} — scheduled for ${formatScheduled(scheduledAt)}.`
          : `Scheduled maintenance: ${formatScheduled(scheduledAt)}. The app will be briefly unavailable then.`}
      </ThemedText>
      <TouchableOpacity style={styles.closeBtn} onPress={dismiss} hitSlop={10}>
        <X size={16} color="#92400E" />
      </TouchableOpacity>
    </Animated.View>
  );
}

function makeStyles(t: typeof Colors.light) {
  return StyleSheet.create({
    wrap: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: '#FFFBEB', borderRadius: 14, borderWidth: 1, borderColor: '#FDE68A',
      paddingVertical: 10, paddingHorizontal: 14, marginHorizontal: 16, marginBottom: 12,
    },
    text: { flex: 1, fontFamily: Fonts.poppinsSemiBold, fontSize: 12.5, color: '#92400E', lineHeight: 17 },
    closeBtn: { padding: 4 },
  });
}
