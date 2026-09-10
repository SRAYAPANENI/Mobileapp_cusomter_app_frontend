import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated as RNAnimated,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Briefcase,
  Home,
  Mic,
  Pencil,
  Sparkles,
  User,
  X,
} from 'lucide-react-native';
import Reanimated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { VoicePostModal } from '@/components/voice-post-modal';
import { Fonts } from '@/constants/theme';
import { SkoFyApi } from '@/services/api';

interface SkoFyBottomBarProps {
  activeTab: 'home' | 'my-jobs' | 'book' | 'profile';
  /** If provided, the Book tab calls this instead of navigating directly (lets home screen add location first) */
  onBookPress?: () => void;
}

// ── JioHotstar & Siri inspired luxury AI glow stops ───────────────────────────
const GLOW_STOPS: [string, string, string][] = [
  ['#2563EB', '#7C3AED', '#EC4899'],
  ['#7C3AED', '#EC4899', '#FFCE48'],
  ['#EC4899', '#3B82F6', '#10B981'],
  ['#3B82F6', '#2563EB', '#7C3AED'],
];

export function SkoFyBottomBar({ activeTab, onBookPress }: SkoFyBottomBarProps) {
  const insets = useSafeAreaInsets();
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>('');
  const [activeJobsCount, setActiveJobsCount] = useState<number>(0);
  const [voiceModalVisible, setVoiceModalVisible] = useState(false);

  // ── JioHotstar-style auto-collapsing voice prompt nudge ──────────────────
  const [showVoiceNudge, setShowVoiceNudge] = useState(true);
  const nudgeAnim = useRef(new RNAnimated.Value(1)).current;

  useEffect(() => {
    // Auto collapse nudge banner after 3.2 seconds just like JioHotstar AI prompt
    const timer = setTimeout(() => {
      RNAnimated.timing(nudgeAnim, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }).start(() => setShowVoiceNudge(false));
    }, 3200);

    return () => clearTimeout(timer);
  }, [nudgeAnim]);

  // ── Animated luxury gradient glow ────────────────────────────────────────
  const orbScale = useRef(new RNAnimated.Value(1)).current;
  const [currentColors, setCurrentColors] = useState<[string, string, string]>(GLOW_STOPS[0]);

  useEffect(() => {
    let idx = 0;
    const tick = () => {
      idx = (idx + 1) % GLOW_STOPS.length;
      setCurrentColors(GLOW_STOPS[idx]);
    };
    const interval = setInterval(tick, 1400);
    return () => clearInterval(interval);
  }, []);

  // Soft breathing animation
  useEffect(() => {
    const pulse = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(orbScale, { toValue: 1.06, duration: 1000, useNativeDriver: true }),
        RNAnimated.timing(orbScale, { toValue: 1.0,  duration: 1000, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [orbScale]);

  useEffect(() => {
    SkoFyApi.customers.getProfile()
      .then((p: any) => {
        if (p?.name) setUserName(p.name);
        if (p?.profile_image_url) setProfileImageUrl(p.profile_image_url);
      })
      .catch(() => {});

    SkoFyApi.dashboard.getActiveJobs()
      .then((jobs: any[]) => {
        if (Array.isArray(jobs)) {
          const active = jobs.filter((j: any) =>
            !['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(j.status)
          );
          setActiveJobsCount(active.length);
        }
      })
      .catch(() => {});
  }, []);

  const handleVoiceTrigger = useCallback(() => {
    setVoiceModalVisible(true);
  }, []);

  const handleBookPress = useCallback(() => {
    if (onBookPress) {
      onBookPress();
    } else {
      router.push({ pathname: '/(tabs)/home', params: { triggerBookLocation: 'true' } });
    }
  }, [onBookPress]);

  const navBarHeight = 62;
  const bottomPad = Math.max(insets.bottom, 8);

  return (
    <>
      {/* ── Elevated outer wrapper ─────────────────────────────────────── */}
      <View
        style={[
          styles.outerWrapper,
          { bottom: bottomPad + 12 },
        ]}
        pointerEvents="box-none"
      >
        {/* JioHotstar-Style Collapsing Voice Nudge Tooltip */}
        {showVoiceNudge && (
          <RNAnimated.View
            style={[
              styles.nudgeBanner,
              {
                opacity: nudgeAnim,
                transform: [
                  {
                    translateY: nudgeAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [10, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <TouchableOpacity
              style={styles.nudgeBannerContent}
              onPress={handleVoiceTrigger}
              activeOpacity={0.85}
            >
              <Sparkles size={13} color="#FFCE48" />
              <Text style={styles.nudgeBannerText}>Need a service? Ask Hey Dodorez</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowVoiceNudge(false)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <X size={12} color="#9CA3AF" />
            </TouchableOpacity>
          </RNAnimated.View>
        )}

        {/* Center JioHotstar-Inspired Dark Glow AI Orb */}
        <View style={styles.centerOrbAbsolute} pointerEvents="box-none">
          <TouchableOpacity onPress={handleVoiceTrigger} activeOpacity={0.85} style={styles.centerOrbTap}>
            <RNAnimated.View style={[styles.centerOrbWrapper, { transform: [{ scale: orbScale }] }]}>
              {/* Outer animated gradient glow ring */}
              <LinearGradient
                colors={currentColors}
                start={{ x: 0.0, y: 0.0 }}
                end={{ x: 1.0, y: 1.0 }}
                style={[StyleSheet.absoluteFillObject, { borderRadius: 26 }]}
              />
              {/* White core with subtle inner ring — was a dark navy fill,
                  which read as flat/heavy against the colorful glow ring
                  around it. */}
              <View style={styles.centerOrbCore}>
                <Mic size={20} color="#7C3AED" strokeWidth={2.5} />
              </View>
            </RNAnimated.View>
          </TouchableOpacity>
          <ThemedText style={styles.centerOrbLabel} numberOfLines={1}>Hey Dodorez</ThemedText>
        </View>

        {/* Navigation pill */}
        <View style={[styles.navPill, { height: navBarHeight }]}>
          {/* 1. Home */}
          <TouchableOpacity
            style={styles.navTabItem}
            onPress={() => activeTab !== 'home' && router.push('/(tabs)/home')}
            activeOpacity={0.75}
          >
            {activeTab === 'home' ? (
              <View style={styles.activeTabPill}>
                <Home size={16} color="#111827" strokeWidth={2.5} />
                <ThemedText style={styles.navTabLabelActive}>Home</ThemedText>
              </View>
            ) : (
              <>
                <Home size={20} color="#6B7280" strokeWidth={2} />
                <ThemedText style={styles.navTabLabel}>Home</ThemedText>
              </>
            )}
          </TouchableOpacity>

          {/* 2. My Jobs */}
          <TouchableOpacity
            style={styles.navTabItem}
            onPress={() => activeTab !== 'my-jobs' && router.push('/my-jobs')}
            activeOpacity={0.75}
          >
            {activeTab === 'my-jobs' ? (
              <View style={styles.activeTabPill}>
                <Briefcase size={16} color="#111827" strokeWidth={2.5} />
                <ThemedText style={styles.navTabLabelActive}>My Jobs</ThemedText>
              </View>
            ) : (
              <>
                <View style={{ position: 'relative' }}>
                  <Briefcase size={20} color="#6B7280" strokeWidth={2} />
                  {activeJobsCount > 0 && (
                    <View style={styles.navBadge}>
                      <Text style={styles.navBadgeText}>{activeJobsCount}</Text>
                    </View>
                  )}
                </View>
                <ThemedText style={styles.navTabLabel}>My Jobs</ThemedText>
              </>
            )}
          </TouchableOpacity>

          {/* 3. Center dedicated spacer slot — wide enough so tabs never overlap */}
          <View style={styles.centerSpacer} />

          {/* 4. Book */}
          <TouchableOpacity
            style={styles.navTabItem}
            onPress={handleBookPress}
            activeOpacity={0.75}
          >
            {activeTab === 'book' ? (
              <View style={styles.activeTabPill}>
                <Pencil size={16} color="#111827" strokeWidth={2.5} />
                <ThemedText style={styles.navTabLabelActive}>Book</ThemedText>
              </View>
            ) : (
              <>
                <Pencil size={20} color="#6B7280" strokeWidth={2} />
                <ThemedText style={styles.navTabLabel}>Book</ThemedText>
              </>
            )}
          </TouchableOpacity>

          {/* 5. Profile */}
          <TouchableOpacity
            style={styles.navTabItem}
            onPress={() => activeTab !== 'profile' && router.push('/profile')}
            activeOpacity={0.75}
          >
            {activeTab === 'profile' ? (
              <View style={styles.activeTabPill}>
                {profileImageUrl ? (
                  <Image source={{ uri: profileImageUrl }} style={styles.navAvatarImageActive} />
                ) : (
                  <View style={styles.navAvatarFallbackActive}>
                    <Text style={styles.navAvatarInitialsTextActive}>{userName ? userName[0].toUpperCase() : 'U'}</Text>
                  </View>
                )}
                <ThemedText style={styles.navTabLabelActive}>Profile</ThemedText>
              </View>
            ) : (
              <>
                {profileImageUrl ? (
                  <Image source={{ uri: profileImageUrl }} style={styles.navAvatarImage} />
                ) : (
                  <View style={styles.navAvatarFallback}>
                    <Text style={styles.navAvatarInitialsText}>{userName ? userName[0].toUpperCase() : 'U'}</Text>
                  </View>
                )}
                <ThemedText style={styles.navTabLabel}>Profile</ThemedText>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Voice Modal */}
      <VoicePostModal
        visible={voiceModalVisible}
        onClose={() => setVoiceModalVisible(false)}
        onJobPosted={() => {
          setVoiceModalVisible(false);
          router.push('/my-jobs');
        }}
        onFallbackToManual={() => {
          setVoiceModalVisible(false);
          router.push('/post-requirement/step1');
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  outerWrapper: {
    position: 'absolute',
    left: 12,
    right: 12,
    alignItems: 'center',
    zIndex: 999,
  },

  // ── JioHotstar-style auto-collapsing banner ──────────────────────────────
  nudgeBanner: {
    position: 'absolute',
    top: -82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,206,72,0.3)',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 12,
    zIndex: 1001,
  },
  nudgeBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  nudgeBannerText: {
    fontSize: 11,
    lineHeight: 17,
    fontFamily: Fonts.poppinsSemiBold,
    color: '#FFFFFF',
  },

  // ── Navigation pill ──────────────────────────────────────────────────────
  navPill: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 4,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 5 },
    elevation: 12,
  },
  navTabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 8,
  },
  centerSpacer: {
    width: 78, // Dedicated space for the center orb + its "Hey Dodorez" label so tabs never collide
  },
  activeTabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  navTabLabel: { fontSize: 9.5, fontFamily: Fonts.poppinsSemiBold, color: '#6B7280' },
  navTabLabelActive: { fontSize: 10, fontFamily: Fonts.poppinsBold, color: '#111827' },
  navBadge: {
    position: 'absolute', top: -3, right: -7,
    minWidth: 15, height: 15, borderRadius: 7.5,
    backgroundColor: '#EF4444',
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3,
  },
  navBadgeText: { fontSize: 8.5, fontFamily: Fonts.poppinsBold, color: '#FFFFFF' },

  // ── JioHotstar-Inspired Dark Glow AI Orb ──────────────────────────────────
  centerOrbAbsolute: {
    position: 'absolute',
    top: -32,
    alignSelf: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  centerOrbTap: { alignItems: 'center' },
  centerOrbWrapper: {
    width: 52,
    height: 52,
    borderRadius: 26,
    padding: 2.5, // Gradient border width
    shadowColor: '#7C3AED',
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 14,
  },
  centerOrbCore: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.15)',
  },
  centerOrbLabel: {
    fontSize: 9.5,
    lineHeight: 15.5,
    fontFamily: Fonts.poppinsBold,
    color: '#111827',
    marginTop: 3,
    width: 72,
    textAlign: 'center',
  },

  // ── Profile avatar ────────────────────────────────────────────────────────
  navAvatarImage: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#D1D5DB' },
  navAvatarImageActive: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: '#FFCE48' },
  navAvatarFallback: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: '#F3F4F6',
    justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#D1D5DB',
  },
  navAvatarFallbackActive: {
    width: 18, height: 18, borderRadius: 9, backgroundColor: '#FFCE48',
    justifyContent: 'center', alignItems: 'center',
  },
  navAvatarInitialsText: { fontSize: 9.5, fontFamily: Fonts.poppinsBold, color: '#6B7280' },
  navAvatarInitialsTextActive: { fontSize: 8.5, fontFamily: Fonts.poppinsBold, color: '#111827' },
});
