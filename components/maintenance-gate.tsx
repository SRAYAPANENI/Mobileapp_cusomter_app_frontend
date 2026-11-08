import AnimatedBrandMark from '@/components/animated-brand-mark';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useActiveJobStatus } from '@/hooks/use-active-job-status';
import { useAppConfig } from '@/services/queries/app-config';
import { Wrench } from 'lucide-react-native';
import React from 'react';
import { StyleSheet } from 'react-native';

// Set from the admin portal (app_configs.maintenance_*) — same unmount-the-
// whole-tree approach as AppLockGate, and for the same reason: a real-time
// clock/data screen underneath a mere overlay would keep ticking/polling
// pointlessly, and any open native Modal would still show through it anyway.
//
// A session with a job already in one of the "pre-completion" active
// statuses (useActiveJobStatus — same signal the floating status pill uses)
// is let through rather than stranded mid-job; maintenance only blocks launch
// and login for everyone else. Logged-out entirely is always blocked while on.
export default function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);

  const { data: config } = useAppConfig();
  // Always called (Rules of Hooks) — internally a no-op logged out, since it
  // checks TokenStore itself before fetching anything.
  const activeJobs = useActiveJobStatus();

  const blocked = !!config?.maintenance.enabled && activeJobs.length === 0;

  if (blocked) {
    return (
      <ThemedView style={styles.container}>
        <AnimatedBrandMark size={56} nameSize={32} />
        <Wrench size={28} color={themeColors.textSecondary} style={styles.icon} />
        <ThemedText style={styles.title}>We&apos;ll be right back</ThemedText>
        <ThemedText style={styles.subtitle}>
          {config?.maintenance.message || "We're making some improvements. Back soon!"}
        </ThemedText>
        {config?.maintenance.until && (
          <ThemedText style={styles.until}>
            Expected back {new Date(config.maintenance.until).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
          </ThemedText>
        )}
      </ThemedView>
    );
  }

  return <>{children}</>;
}

function makeStyles(t: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
    icon: { marginTop: 24 },
    title: { fontFamily: Fonts.poppinsBold, fontSize: 22, color: t.textPrimary, marginTop: 12 },
    subtitle: { fontFamily: Fonts.poppins, fontSize: 14, color: t.textSecondary, textAlign: 'center', marginTop: 8 },
    until: { fontFamily: Fonts.poppinsSemiBold, fontSize: 13, color: t.textSecondary, textAlign: 'center', marginTop: 16 },
  });
}
