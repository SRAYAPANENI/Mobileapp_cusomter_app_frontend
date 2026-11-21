import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { Image } from 'expo-image';
import { ImageOff, X } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, StatusBar, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native';
// The gesture library's list: its paging and the zoom gestures cooperate —
// React Native's own list could take a pinch over on Android.
import { FlatList, Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// A photo seen whole: full screen on black, never cropped, pinch or double-tap
// to zoom, swipe between several. Same file in both apps (no shared code
// between them): skofy-customer-app and skofy-service-provider-app
// components/photo-viewer.tsx.

export interface ViewerPhoto { uri: string; caption?: string }

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

/** Opens photos full screen: `open(photos, index)`; render `element` once. */
export function usePhotoViewer() {
  const [shown, setShown] = useState<{ photos: ViewerPhoto[]; index: number } | null>(null);
  const open = useCallback((photos: (ViewerPhoto | string | null | undefined)[], index = 0) => {
    const list = photos
      .map((p) => (typeof p === 'string' ? { uri: p } : p))
      .filter((p): p is ViewerPhoto => !!p?.uri);
    if (!list.length) return;
    setShown({ photos: list, index: Math.min(Math.max(index, 0), list.length - 1) });
  }, []);
  const element = shown
    ? <PhotoViewer photos={shown.photos} initialIndex={shown.index} onClose={() => setShown(null)} />
    : null;
  return { open, element };
}

function PhotoViewer({ photos, initialIndex, onClose }: { photos: ViewerPhoto[]; initialIndex: number; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(initialIndex);
  // Zoomed in: the pictures stop swiping, so a drag moves around this one.
  const [zoomed, setZoomed] = useState(false);
  const caption = photos[index]?.caption;

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      {/* Gestures inside a Modal need their own root (Android). */}
      <GestureHandlerRootView style={s.root}>
        <StatusBar barStyle="light-content" />
        <FlatList
          data={photos}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed && photos.length > 1}
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={(p, i) => `${i}-${p.uri}`}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item, index: i }) => (
            <ZoomableImage uri={item.uri} width={width} height={height} active={i === index} onZoomChange={setZoomed} />
          )}
        />

        <View style={[s.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
          {photos.length > 1 ? (
            <View style={s.pill}><ThemedText style={s.pillText}>{index + 1} / {photos.length}</ThemedText></View>
          ) : <View />}
          <TouchableOpacity style={s.close} onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close photo">
            <X size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {!!caption && (
          <View style={[s.bottom, { paddingBottom: insets.bottom + 16 }]} pointerEvents="none">
            <ThemedText style={s.caption} numberOfLines={3}>{caption}</ThemedText>
          </View>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

function ZoomableImage({ uri, width, height, active, onZoomChange }: {
  uri: string; width: number; height: number; active: boolean; onZoomChange: (zoomed: boolean) => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const [zoomed, setZoomedHere] = useState(false);
  // Still loading, or it didn't (a weak connection): said, never a blank black screen.
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const setZoom = useCallback((z: boolean) => { setZoomedHere(z); onZoomChange(z); }, [onZoomChange]);

  // Swiped away from: back to the whole picture for next time.
  useEffect(() => {
    if (active) return;
    scale.value = 1; savedScale.value = 1;
    tx.value = 0; ty.value = 0; savedTx.value = 0; savedTy.value = 0;
    setZoomedHere(false);
  }, [active, scale, savedScale, tx, ty, savedTx, savedTy]);

  const reset = () => {
    'worklet';
    scale.value = withTiming(1); savedScale.value = 1;
    tx.value = withTiming(0); ty.value = withTiming(0); savedTx.value = 0; savedTy.value = 0;
  };
  // How far a zoomed picture can move: no further than its own edges.
  const clamp = (v: number, s: number, size: number) => {
    'worklet';
    const max = (size * (s - 1)) / 2;
    return Math.min(Math.max(v, -max), max);
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(Math.max(savedScale.value * e.scale, 1), MAX_SCALE);
    })
    .onEnd(() => {
      if (scale.value <= 1.02) {
        reset();
        runOnJS(setZoom)(false);
        return;
      }
      savedScale.value = scale.value;
      tx.value = clamp(tx.value, scale.value, width); ty.value = clamp(ty.value, scale.value, height);
      savedTx.value = tx.value; savedTy.value = ty.value;
      runOnJS(setZoom)(true);
    });

  const pan = Gesture.Pan()
    .enabled(zoomed)
    .onUpdate((e) => {
      tx.value = clamp(savedTx.value + e.translationX, scale.value, width);
      ty.value = clamp(savedTy.value + e.translationY, scale.value, height);
    })
    .onEnd(() => { savedTx.value = tx.value; savedTy.value = ty.value; });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        reset();
        runOnJS(setZoom)(false);
      } else {
        scale.value = withTiming(DOUBLE_TAP_SCALE); savedScale.value = DOUBLE_TAP_SCALE;
        runOnJS(setZoom)(true);
      }
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  if (failed) {
    return (
      <View style={[s.state, { width, height }]}>
        <ImageOff size={32} color="rgba(255,255,255,0.7)" />
        <ThemedText style={s.stateText}>Couldn’t load this photo. Check your connection and open it again.</ThemedText>
      </View>
    );
  }

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
      <Animated.View style={[{ width, height }, style]}>
        <Image source={{ uri }} style={{ width, height }} contentFit="contain" transition={150}
          onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
          accessibilityLabel="Photo, full size. Pinch or double-tap to zoom." />
        {!loaded && <ActivityIndicator style={StyleSheet.absoluteFill} color="#FFFFFF" />}
      </Animated.View>
    </GestureDetector>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  close: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)' },
  pill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.16)' },
  pillText: { fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: '#FFFFFF' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 16, backgroundColor: 'rgba(0,0,0,0.45)' },
  caption: { fontSize: 14, lineHeight: 20, fontFamily: Fonts.poppins, color: '#FFFFFF', textAlign: 'center' },
  state: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
  stateText: { fontSize: 14, lineHeight: 20, fontFamily: Fonts.poppins, color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
});
