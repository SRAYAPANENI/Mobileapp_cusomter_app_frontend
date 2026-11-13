import AnimatedBrandMark from '@/components/animated-brand-mark';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAppConfig } from '@/services/queries/app-config';
import { currentAppVersion, isBelowVersion, platformGate } from '@/services/appVersion';
import { Download } from 'lucide-react-native';
import React from 'react';
import { Linking, StyleSheet, TouchableOpacity } from 'react-native';

// Set from the admin portal (app_configs.*_min_version) — same unmount-the-
// whole-tree approach as MaintenanceGate, but unlike it, never lets an
// active job through: a version below the minimum is assumed incompatible
// (or carrying a fix that can't safely wait), not a matter of convenience.
export default function UpdateRequiredGate({ children }: { children: React.ReactNode }) {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);

  const { data: config } = useAppConfig();
  const gate = platformGate(config);
  const current = currentAppVersion();
  const blocked = isBelowVersion(current, gate?.min_version);

  if (blocked) {
    return (
      <ThemedView style={styles.container}>
        <AnimatedBrandMark size={56} nameSize={32} />
        <Download size={28} color={themeColors.textSecondary} style={styles.icon} />
        <ThemedText style={styles.title}>Update required</ThemedText>
        <ThemedText style={styles.subtitle}>
          This version of the app is no longer supported. Update to keep using Dodorez.
        </ThemedText>
        {!!gate?.store_url && (
          <TouchableOpacity style={styles.button} onPress={() => Linking.openURL(gate.store_url!).catch(() => {})}>
            <ThemedText style={styles.buttonText}>Update Now</ThemedText>
          </TouchableOpacity>
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
    button: { marginTop: 24, backgroundColor: '#FFCE48', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 32 },
    buttonText: { fontFamily: Fonts.poppinsBold, fontSize: 15, color: '#111827' },
  });
}
