import { showDialog } from '@/components/alert-host';
import { useAppConfig } from '@/services/queries/app-config';
import { currentAppVersion, isBelowVersion, platformGate } from '@/services/appVersion';
import React, { useEffect, useRef } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Linking } from 'react-native';

// A dismissible nudge for anyone below the admin-configured "latest"
// version (app_configs.*_latest_version) — never blocks, just a heads-up.
// Snoozed per the exact version it was shown for (SecureStore), the same
// pattern terms-updated-banner.tsx uses, so a further release during a
// snooze still surfaces right away instead of waiting out the old one.
// Mounted once at the app's root; renders nothing itself, just watches
// app-config and fires the shared dialog (components/alert-host.tsx) when due.
const SNOOZE_KEY = 'update_available_dismissed';
const RESHOW_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

export default function UpdateAvailableCheck() {
  const { data: config } = useAppConfig();
  // Guards against firing again on every app-config re-poll while the
  // dialog from the last check is still sitting there unanswered.
  const shownForRef = useRef<string | null>(null);

  const gate = platformGate(config);
  const latest = gate?.latest_version ?? null;
  const current = currentAppVersion();
  // Below min_version is already covered by the full-screen UpdateRequiredGate
  // (a sibling in the tree, not a parent — this component keeps running
  // underneath it) — piling this dismissible nudge on top of that block
  // would be confusing at best, and "Later" on it would read as a way out
  // of a screen that otherwise has none.
  const hardBlocked = isBelowVersion(current, gate?.min_version);
  const due = !hardBlocked && !!latest && isBelowVersion(current, latest);

  useEffect(() => {
    if (!due || !latest || shownForRef.current === latest) return;
    let live = true;
    SecureStore.getItemAsync(SNOOZE_KEY)
      .then((v) => {
        if (!live) return;
        if (v) {
          const [atStr, verStr] = v.split(':');
          if (verStr === latest && Date.now() - Number(atStr) < RESHOW_AFTER_MS) return;
        }
        shownForRef.current = latest;
        showDialog(
          'Update available',
          'A newer version of the app is ready, with the latest features and fixes.',
          [
            {
              text: 'Later', style: 'cancel',
              onPress: () => { SecureStore.setItemAsync(SNOOZE_KEY, `${Date.now()}:${latest}`).catch(() => {}); },
            },
            {
              text: 'Update Now',
              onPress: () => { if (gate?.store_url) Linking.openURL(gate.store_url).catch(() => {}); },
            },
          ],
          { type: 'info' },
        );
      })
      .catch(() => {});
    return () => { live = false; };
  }, [due, latest, gate?.store_url]);

  return null;
}
