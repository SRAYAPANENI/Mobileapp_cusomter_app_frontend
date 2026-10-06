/**
 * Home screen cache — lets a reopen show the last known dashboard instantly
 * instead of a blank "Finding your location..." gate while a fresh fetch
 * runs. A plain JSON file via expo-file-system (already a dependency; no
 * new native module needed) rather than AsyncStorage, which isn't installed
 * in this app.
 *
 * Deliberately narrow: only the fields home.tsx actually needs to paint a
 * convincing first frame (header identity, location, job/provider lists).
 * Not a general-purpose cache — if another screen needs this pattern, it
 * gets its own small cache file the same way, not a shared abstraction
 * built ahead of a second real use case.
 */
import { File, Paths } from 'expo-file-system';
import { SkoFyApi, TokenStore } from './api';

// This SDK's expo-file-system (v19) is the rewritten File/Directory/Paths
// class API — the older documentDirectory/readAsStringAsync/EncodingType
// surface (still seen elsewhere in this codebase, e.g. post-requirement/
// step1.tsx) was removed from the default export in this installed version.
//
// Lazily constructed, not at module scope — this module is imported from
// the SPLASH screen (for prefetch), which runs before anything else. If
// the native module somehow isn't available in whatever build is
// currently installed, constructing a File at import time throws
// synchronously and crashes the entire bundle evaluation before React
// renders anything — including the splash screen itself. A caching
// nicety must never be able to take down app launch; deferring this
// until first actual use (already inside a try/catch below) means that
// just makes the cache silently a no-op instead.
let cacheFile: File | null | undefined;

function getCacheFile(): File | null {
  if (cacheFile === undefined) {
    try {
      cacheFile = new File(Paths.document, 'home_cache.json');
    } catch {
      cacheFile = null;
    }
  }
  return cacheFile;
}

// Cached data is only ever a bridge to the real fetch, which always runs
// right behind it — this just bounds how stale that bridge can be if the
// real fetch is unusually slow or fails outright (e.g. opening the app
// offline after days away shouldn't show weeks-old "nearby" providers).
const MAX_CACHE_AGE_MS = 30 * 60 * 1000; // 30 minutes

export interface HomeCacheData {
  userName?: string;
  profileImageUrl?: string | null;
  address?: string;
  location?: { latitude: number; longitude: number };
  jobs?: unknown[];
  serviceProviders?: unknown[];
  savedAddresses?: unknown[];
  unreadNotifCount?: number;
}

// Stamped on every write, checked on every read — this file lives on the
// DEVICE, not scoped to any one account. Logging out and a different
// customer logging in on the same device (or, concretely, a dev database
// getting wiped and the same phone number re-registering as a brand-new
// account) left a stale file on disk with no idea the underlying account
// had changed. Without this check, the new account's very first app open
// rendered the PREVIOUS account's name/address/jobs/providers instantly
// from cache, correct-looking long enough to be genuinely confusing,
// before any live fetch had a chance to correct it.
interface StoredHomeCache extends HomeCacheData {
  cachedAt: number;
  userId: string;
}

async function getCurrentUserId(): Promise<string | null> {
  const user = await TokenStore.getUser();
  return user?.user_id ?? null;
}

export async function readHomeCache(): Promise<HomeCacheData | null> {
  try {
    const file = getCacheFile();
    if (!file || !file.exists) return null;
    const raw = await file.text();
    const data: StoredHomeCache = JSON.parse(raw);
    if (!data.cachedAt || Date.now() - data.cachedAt > MAX_CACHE_AGE_MS) return null;
    const currentUserId = await getCurrentUserId();
    if (!currentUserId || data.userId !== currentUserId) return null;
    return data;
  } catch {
    // A corrupt/unreadable cache file is never worse than no cache — the
    // live fetch this is only ever a bridge to still runs regardless.
    return null;
  }
}

// Logout and session-expiry (see services/api.ts's setSessionExpiredHandler)
// both call this directly too, as defense in depth on top of the userId
// check above — belt and suspenders, since the check above only protects
// reads that happen to run after TokenStore already reflects the new
// account, and a stale pre-expiry access token can briefly still look
// valid to the app before a live request actually gets rejected.
export async function clearHomeCache(): Promise<void> {
  try {
    const file = getCacheFile();
    if (file?.exists) file.delete();
  } catch {
    // Best-effort — worst case a stale file lingers until the userId
    // check above catches it on the next read.
  }
}

// Merges with whatever's already cached rather than overwriting wholesale —
// the profile fetch, the dashboard fetch, and the addresses fetch all land
// independently and at different times; without merging, whichever finished
// last would wipe out fields the others already wrote.
//
// That merge is only actually safe serialized. home.tsx calls this from
// several places that resolve within milliseconds of each other (profile
// name, profile image, unread count, saved addresses, location, address,
// and — since refreshDashboard's two fetches now run concurrently — jobs
// and serviceProviders too). Two overlapping calls would both read the
// same pre-write snapshot and each write back a merge that's missing the
// other's field, silently dropping it. Chaining every call onto a single
// module-level queue forces each write's read-merge-write to see the
// previous one's result instead of racing it.
let writeQueue: Promise<void> = Promise.resolve();

export function writeHomeCache(partial: HomeCacheData): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    try {
      const file = getCacheFile();
      if (!file) return;
      const currentUserId = await getCurrentUserId();
      if (!currentUserId) return; // never persist data with no known owner
      // readHomeCache() already discards anything stamped with a DIFFERENT
      // userId, so a fresh account's first write correctly starts from
      // nothing instead of merging its fields on top of whoever used this
      // device last.
      const existing = await readHomeCache();
      const merged: StoredHomeCache = { ...existing, ...partial, userId: currentUserId, cachedAt: Date.now() };
      // file.write() is synchronous in this API (no network/async I/O —
      // it's a local write) and creates the file on first write if it
      // doesn't exist yet.
      file.write(JSON.stringify(merged));
    } catch {
      // Best-effort — a failed cache write shouldn't surface anywhere or
      // interrupt the caller; next successful write simply catches up.
    }
  });
  return writeQueue;
}

// Called from the splash screen the moment a stored session is confirmed —
// fire-and-forget, never awaited by navigation. Deliberately limited to the
// LOCATION-INDEPENDENT pieces of the dashboard (profile identity, unread
// count, saved addresses): the rest (nearby providers, active jobs) needs a
// GPS fix, and that permission/timing flow is entirely home.tsx's own
// concern — duplicating it here would be two copies of the same logic free
// to drift out of sync for a feature (prefetch) that's purely a perceived-
// performance nicety, not worth that risk. By the time the user actually
// reaches the home screen, these three requests have had the whole splash
// animation to resolve in the background instead of starting from zero.
export async function prefetchHomeEssentials(): Promise<void> {
  try {
    const [profile, unreadNotifCount, addresses] = await Promise.all([
      SkoFyApi.customers.getProfile().catch(() => null),
      SkoFyApi.notifications.unreadCount().catch(() => undefined),
      (SkoFyApi.addresses.list() as Promise<any[]>).catch(() => null),
    ]);
    const partial: HomeCacheData = {};
    if ((profile as any)?.name) partial.userName = (profile as any).name;
    if ((profile as any)?.profile_image_url) partial.profileImageUrl = (profile as any).profile_image_url;
    if (unreadNotifCount !== undefined) partial.unreadNotifCount = unreadNotifCount;
    if (Array.isArray(addresses)) partial.savedAddresses = addresses;
    if (Object.keys(partial).length > 0) await writeHomeCache(partial);
  } catch {
    // Purely a head start for the next cache read — home.tsx's own fetches
    // are the real source of truth and run regardless of this succeeding.
  }
}
