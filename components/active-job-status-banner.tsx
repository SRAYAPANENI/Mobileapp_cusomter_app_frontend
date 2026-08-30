import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams, usePathname } from 'expo-router';
import { Activity, ChevronRight, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fonts } from '@/constants/theme';
import { useActiveJobStatus } from '@/hooks/use-active-job-status';

import { ThemedText } from './themed-text';

// Replaces the old fixed top banner — that approach didn't push a screen's
// own content down, it just floated on top at a fixed position, so it could
// end up overlapping/clipping whatever a given screen already had at its own
// top (a job title, a header) instead of coexisting with it. A draggable
// pill the customer can park anywhere sidesteps that entirely.
//
// Collapsed state shows a live status sliver (icon + one line of what's
// actually happening) rather than a bare icon — a bare dot forces a tap just
// to find out anything changed, which read as inert/decorative rather than
// a live tracker. A soft shimmer sweep stands in for the old expanding
// pulse-ring, which looked more like an alert badge than an ambient "this is
// live" cue.
//
// Known limitation, not fixable from here: a screen that opens a real RN
// <Modal> (Service Room, the AI voice modal, rating/cancel modals, image
// viewers…) renders in a genuinely separate native window that sits above
// the ENTIRE React tree, this pill included — no JS-level zIndex/elevation
// can draw on top of that. That's very likely what "invisible on some
// screens" refers to; it reappears the instant that modal closes.
const PILL_WIDTH = 168;
const PILL_HEIGHT = 40;
// Default/idle state — a small circle, not the text pill. Tapping it
// expands to the pill; tapping the pill again either collapses back to this
// (single active job) or expands further into the job list (more than one —
// the pill can only ever show one job's message, so with more than one
// active job there needs to be a way to actually reach the rest of them,
// not just a badge count promising they exist).
const CIRCLE_SIZE = 52;
const SHIMMER_WIDTH = 52;
const LIST_WIDTH = 220;
const LIST_HEADER_HEIGHT = 34;
const LIST_ROW_HEIGHT = 46;
// Below this total drag distance, a gesture is treated as a tap (toggle
// expand/collapse) rather than a reposition — matches the same tap-vs-drag
// disambiguation pattern already used for the Service Room sheet's
// drag-to-dismiss handle in the provider app.
const DRAG_THRESHOLD = 6;
// How long the panel auto-expands for when a new/changed status arrives,
// before collapsing itself back down.
const AUTO_EXPAND_MS = 4500;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function ActiveJobStatusBanner() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  // Only the job currently open on track-provider or job-details should be
  // suppressed — those screens already show that job's own status/details
  // in full, and job-details' title sits right where this pill would
  // otherwise default to, overlapping it. A DIFFERENT active job (the
  // customer hired more than one provider at once) must still surface here
  // even while one of these screens is open for the other one.
  const { jobId: viewedJobId } = useLocalSearchParams<{ jobId?: string }>();
  const allBanners = useActiveJobStatus();
  const banners = (pathname === '/track-provider' || pathname === '/job-details')
    ? allBanners.filter(b => b.jobId !== viewedJobId)
    : allBanners;

  type ViewState = 'circle' | 'pill' | 'list';
  const [viewState, setViewState] = useState<ViewState>('circle');
  // Mirrors `viewState` for use inside the PanResponder's callbacks — those
  // closures are captured once (PanResponder.create runs inside a useRef
  // initializer) so they'd otherwise always see the state from first render.
  const viewStateRef = useRef<ViewState>('circle');
  useEffect(() => { viewStateRef.current = viewState; }, [viewState]);
  // Same trap, same fix, for `banners` — it's a plain const recomputed every
  // render (not a ref), so without mirroring it, every reference inside the
  // PanResponder's closure stays frozen at whatever it was on the very
  // first render, which is always `[]` (useActiveJobStatus starts empty and
  // fills in async). That silently broke the list feature entirely: the
  // `banners.length > 1` gate inside the handler was always comparing
  // against 0, so tapping the pill could never actually reach 'list', and
  // `banners[rowIndex]` was always indexing into an empty array.
  const bannersRef = useRef(banners);
  useEffect(() => { bannersRef.current = banners; }, [banners]);
  const boxSizeFor = (state: ViewState, bannerCount: number) =>
    state === 'list'
      ? { w: LIST_WIDTH, h: LIST_HEADER_HEIGHT + bannerCount * LIST_ROW_HEIGHT }
      : state === 'pill'
      ? { w: PILL_WIDTH, h: PILL_HEIGHT }
      : { w: CIRCLE_SIZE, h: CIRCLE_SIZE };

  // Bottom-right, clear of the bottom nav bar — a standard FAB spot that
  // stays out of the way regardless of what a given screen's own content
  // looks like above it. A header-relative default (what this used to be)
  // kept landing on top of whatever screen-specific content lived there —
  // the greeting name, then the home screen's voice-hero card and its
  // mascot — because that content isn't fixed-height across screens/states.
  const [fabPos, setFabPos] = useState(() => ({
    x: width - CIRCLE_SIZE - 16,
    y: clamp(height - CIRCLE_SIZE - insets.bottom - 110, insets.top + 8, height - CIRCLE_SIZE - insets.bottom - 8),
  }));
  // Mirrors `fabPos` for the same stale-closure reason as viewStateRef —
  // needed inside onPanResponderRelease to know which list row a tap landed
  // on (the row "buttons" aren't real Touchables — see note there).
  const fabPosRef = useRef(fabPos);
  useEffect(() => { fabPosRef.current = fabPos; }, [fabPos]);
  // Transient offset applied only while a drag gesture is in progress —
  // fabPos itself only updates once, on release, to the final settled spot.
  const dragOffset = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const dragDistanceRef = useRef(0);

  // ── "Announce itself" when something actually changes ────────────────────
  // A silently-updating badge is easy to miss entirely. When a job's status
  // line changes (or a new active job appears), briefly pop/scale the pill
  // and auto-expand the panel for a few seconds so the update is impossible
  // to miss, then let it collapse back down on its own.
  const bounceAnim = useRef(new Animated.Value(1)).current;
  const bannersKey = banners.map(b => `${b.jobId}:${b.message}`).join('|');
  const prevBannersKeyRef = useRef<string | null>(null);
  const autoCollapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userToggledRef = useRef(false);

  useEffect(() => {
    const isFirstRun = prevBannersKeyRef.current === null;
    const changed = !isFirstRun && prevBannersKeyRef.current !== bannersKey;
    prevBannersKeyRef.current = bannersKey;
    if (!changed || !banners.length) return;

    Animated.sequence([
      Animated.timing(bounceAnim, { toValue: 1.15, duration: 160, useNativeDriver: true }),
      Animated.spring(bounceAnim, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();

    userToggledRef.current = false;
    setViewState('pill');
    if (autoCollapseTimerRef.current) clearTimeout(autoCollapseTimerRef.current);
    autoCollapseTimerRef.current = setTimeout(() => {
      // Don't auto-collapse out from under the customer if they've since
      // interacted with the panel themselves (dragged, tapped a row, or
      // manually collapsed/expanded it).
      if (!userToggledRef.current) setViewState('circle');
    }, AUTO_EXPAND_MS);
    return () => { if (autoCollapseTimerRef.current) clearTimeout(autoCollapseTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bannersKey]);

  // ── Ambient "this is live" cue ─────────────────────────────────────────
  // A soft light sweep across the pill every few seconds — reads as a live
  // status chip (closer to delivery-app tracking UI) rather than a static
  // icon or an alert-style pulsing ring.
  const shimmerAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.delay(1800),
        Animated.timing(shimmerAnim, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [shimmerAnim]);
  const shimmerTranslate = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-SHIMMER_WIDTH, PILL_WIDTH + SHIMMER_WIDTH],
  });

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragDistanceRef.current = 0;
      },
      onPanResponderMove: (_, gesture) => {
        dragDistanceRef.current = Math.abs(gesture.dx) + Math.abs(gesture.dy);
        dragOffset.setValue({ x: gesture.dx, y: gesture.dy });
      },
      onPanResponderRelease: (_, gesture) => {
        dragOffset.setValue({ x: 0, y: 0 });
        const wasState = viewStateRef.current;
        const cur = boxSizeFor(wasState, bannersRef.current.length);
        // Keep the right edge and vertical center anchored so the
        // circle/pill/list grows or shrinks from the same spot instead of
        // jumping — shared by every transition below (cycling size, tapping
        // a list row, or dismissing the list), not just the main cycle.
        const transitionTo = (nextState: ViewState) => {
          const next = boxSizeFor(nextState, bannersRef.current.length);
          setFabPos(prev => ({
            x: clamp(prev.x + cur.w - next.w, 8, width - next.w - 8),
            y: clamp(prev.y + (cur.h - next.h) / 2, insets.top + 8, height - next.h - insets.bottom - 8),
          }));
          setViewState(nextState);
        };
        if (dragDistanceRef.current < DRAG_THRESHOLD) {
          userToggledRef.current = true;

          // The list panel's rows aren't real Touchables — this whole area
          // is one PanResponder (that's how tap-vs-drag already gets told
          // apart everywhere else here), so a tap landing on a specific row
          // has to be resolved by position instead of a nested onPress.
          if (wasState === 'list') {
            const relativeY = gesture.y0 - fabPosRef.current.y;
            if (relativeY >= LIST_HEADER_HEIGHT) {
              const rowIndex = Math.floor((relativeY - LIST_HEADER_HEIGHT) / LIST_ROW_HEIGHT);
              const tapped = bannersRef.current[rowIndex];
              if (tapped) {
                transitionTo('circle');
                router.push({ pathname: '/track-provider', params: { jobId: tapped.jobId } });
                return;
              }
            }
            // Header row (or a miss past the last row) — just collapse.
            transitionTo('circle');
            return;
          }

          // circle -> pill -> list (only if there's more than one job to
          // show — with just one, the pill already shows everything there
          // is) -> circle. A single-job case just toggles circle <-> pill,
          // same as before.
          transitionTo(wasState === 'circle' ? 'pill' : (bannersRef.current.length > 1 ? 'list' : 'circle'));
          return;
        }
        userToggledRef.current = true;
        setFabPos(prev => ({
          x: clamp(prev.x + gesture.dx, 8, width - cur.w - 8),
          y: clamp(prev.y + gesture.dy, insets.top + 8, height - cur.h - insets.bottom - 8),
        }));
      },
    })
  ).current;

  if (!banners.length || pathname === '/track-provider') return null;

  const primary = banners[0];
  const { w: boxW, h: boxH } = boxSizeFor(viewState, banners.length);
  // Re-clamped against the LIVE width/height on every render (unlike the
  // stale width/height captured inside the PanResponder's closures) — a
  // real safety net if fabPos was ever set for a different box size or the
  // window resizes (e.g. orientation change).
  const renderX = clamp(fabPos.x, 8, width - boxW - 8);
  const renderY = clamp(fabPos.y, insets.top + 8, height - boxH - insets.bottom - 8);

  return (
    <Animated.View
      style={[
        styles.touchArea,
        { left: renderX, top: renderY, width: boxW, height: boxH },
        { transform: [...dragOffset.getTranslateTransform(), { scale: bounceAnim }] },
      ]}
      {...panResponder.panHandlers}
    >
      {viewState === 'list' ? (
        <LinearGradient
          colors={['#2563EB', '#1D4ED8']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.listPanel}
        >
          <View style={styles.listHeader}>
            <ThemedText style={styles.listHeaderText}>Active Jobs</ThemedText>
            <X size={13} color="rgba(255,255,255,0.85)" />
          </View>
          {banners.map(b => (
            <View key={b.jobId} style={styles.listRow}>
              <View style={styles.pillIconBadge}>
                <Activity size={11} color="#2563EB" />
              </View>
              <ThemedText style={styles.listRowText} numberOfLines={1} ellipsizeMode="tail">
                {b.message}
              </ThemedText>
              <ChevronRight size={12} color="rgba(255,255,255,0.7)" />
            </View>
          ))}
        </LinearGradient>
      ) : viewState === 'pill' ? (
        <LinearGradient
          colors={['#2563EB', '#1D4ED8']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.pill}
        >
          <Animated.View
            pointerEvents="none"
            style={[styles.shimmer, { transform: [{ translateX: shimmerTranslate }, { rotate: '20deg' }] }]}
          />
          <View style={styles.pillIconBadge}>
            <Activity size={12} color="#2563EB" />
          </View>
          <ThemedText style={styles.pillText} numberOfLines={1} ellipsizeMode="tail">
            {primary.message}
          </ThemedText>
          <ChevronRight size={13} color="rgba(255,255,255,0.85)" />
        </LinearGradient>
      ) : (
        <LinearGradient
          colors={['#2563EB', '#1D4ED8']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.circle}
        >
          <Activity size={20} color="#FFFFFF" />
        </LinearGradient>
      )}
      {/* Rendered outside the gradient, not inside it — the pill's gradient
          has overflow:'hidden' to mask the shimmer sweep, which would clip
          this badge since it deliberately pokes out past the edge. */}
      {banners.length > 1 && viewState !== 'list' && (
        <View style={styles.badge}>
          <ThemedText style={styles.badgeText}>{banners.length}</ThemedText>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  touchArea: {
    position: 'absolute',
    zIndex: 99999,
    elevation: 99999,
  },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: PILL_HEIGHT / 2,
    paddingLeft: 5,
    paddingRight: 10,
    gap: 6,
    overflow: 'hidden',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  circle: {
    flex: 1,
    borderRadius: CIRCLE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  shimmer: {
    position: 'absolute',
    top: -16,
    bottom: -16,
    width: SHIMMER_WIDTH,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  pillIconBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    flex: 1,
    fontSize: 11,
    fontFamily: Fonts.poppinsSemiBold,
    color: '#FFFFFF',
  },
  listPanel: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  listHeader: {
    height: LIST_HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.2)',
  },
  listHeaderText: {
    fontSize: 11,
    fontFamily: Fonts.poppinsBold,
    color: '#FFFFFF',
  },
  listRow: {
    height: LIST_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  listRowText: {
    flex: 1,
    fontSize: 11,
    fontFamily: Fonts.poppinsSemiBold,
    color: '#FFFFFF',
  },
  badge: {
    position: 'absolute',
    top: -7,
    right: -7,
    minWidth: 21,
    height: 21,
    borderRadius: 10.5,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: '#fff',
    // Higher than the pill's own elevation (8) — Android stacks siblings by
    // elevation, not paint order, so without this the badge (elevation 0 by
    // default) would render underneath the gradient pill.
    elevation: 9,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: Fonts.poppinsBold,
    color: '#fff',
  },
});
