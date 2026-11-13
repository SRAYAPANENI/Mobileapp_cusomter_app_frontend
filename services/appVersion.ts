import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { AppConfig } from '@/services/api';

/** Mirrors app/domain/app_config.py's parse_version — "1.2.3" -> [1,2,3].
 * null for anything that isn't plain dot-separated integers. */
function parseVersion(v: string): number[] | null {
  const parts = v.trim().split('.');
  if (parts.length === 0 || !parts.every(p => /^\d+$/.test(p))) return null;
  return parts.map(Number);
}

/** Whether `current` meets `minimum`, padding the shorter one with zeros so
 * "1.2" compares equal to "1.2.0". null when either side doesn't parse —
 * callers skip the check rather than guessing. */
export function versionAtLeast(current: string, minimum: string): boolean | null {
  const c = parseVersion(current);
  const m = parseVersion(minimum);
  if (c === null || m === null) return null;
  const width = Math.max(c.length, m.length);
  for (let i = 0; i < width; i++) {
    const cv = c[i] ?? 0;
    const mv = m[i] ?? 0;
    if (cv !== mv) return cv > mv;
  }
  return true;
}

/** This build's own version, from app.json's "version" field (embedded at
 * build time) — not expo-application's native build number, since that
 * needs a native module this app doesn't otherwise have a reason to carry.
 * The two are versioned together in practice (app.json bumps alongside any
 * store release), so the JS-visible value is enough to compare against. */
export function currentAppVersion(): string | null {
  return Constants.expoConfig?.version ?? null;
}

type PlatformGate = { min_version: string | null; latest_version: string | null; store_url: string | null };

/** This device's platform slice of the config's version gate — undefined
 * on a platform the backend doesn't model (web, during Expo Go testing
 * on an unlisted OS), which every caller treats as "no gate". */
export function platformGate(config: AppConfig | undefined): PlatformGate | undefined {
  // `version` is absent from a server older than this build (the field
  // shipped app-side first) — missing must read as "no gate", never throw:
  // this runs in the gate wrapping the whole tree, so a throw here kills
  // the app on launch.
  if (!config?.version) return undefined;
  if (Platform.OS === 'android') return config.version.android ?? undefined;
  if (Platform.OS === 'ios') return config.version.ios ?? undefined;
  return undefined;
}

/** True only when every input is present, parses, and current falls short —
 * a blank/unconfigured field (null, or "" from the admin clearing it) or an
 * unparseable one always reads as "not gated", never as a false block. */
export function isBelowVersion(current: string | null, gate: string | null | undefined): boolean {
  if (!current || !gate) return false;
  return versionAtLeast(current, gate) === false;
}
