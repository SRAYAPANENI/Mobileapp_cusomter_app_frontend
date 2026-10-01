import { Sparkles } from 'lucide-react-native';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, StyleSheet, Text, View } from 'react-native';
import ScratchChip from './scratch-chip';

interface ScratchCardProps {
  /** What's revealed underneath — this component has no idea what it is. */
  revealContent: React.ReactNode;
  /** Fires once, the moment enough of the cover has been scratched away. */
  onRevealed?: () => void;
  /** Fraction of the grid that must be crossed before it auto-completes. */
  threshold?: number;
  cols?: number;
  rows?: number;
  coverColor?: string;
  hintLabel?: string;
  style?: any;
}

/**
 * A generic PhonePe/GPay-style scratch-to-reveal surface. Purely a gesture +
 * animation shell: it renders whatever `revealContent` underneath a grid of
 * chips and fades chips out as a finger passes over them, then auto-reveals
 * the rest once enough of the surface has been cleared. It has no notion of
 * offers, claims, or any backend call — callers own that entirely via
 * `onRevealed`, which is what keeps this reusable for anything else that
 * ever wants the same reveal mechanic.
 */
export default function ScratchCard({
  revealContent,
  onRevealed,
  threshold = 0.5,
  cols = 9,
  rows = 6,
  coverColor = '#B8C4CE',
  hintLabel = 'Scratch to reveal',
  style,
}: ScratchCardProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [revealedVersion, setRevealedVersion] = useState(0);
  const revealedRef = useRef<Set<number>>(new Set());
  const hasCompletedRef = useRef(false);
  const [started, setStarted] = useState(false);

  const totalCells = cols * rows;

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  }, []);

  const completeReveal = useCallback(() => {
    if (hasCompletedRef.current) return;
    hasCompletedRef.current = true;
    for (let i = 0; i < totalCells; i++) revealedRef.current.add(i);
    setRevealedVersion(v => v + 1);
    onRevealed?.();
  }, [totalCells, onRevealed]);

  const revealAround = useCallback((locationX: number, locationY: number) => {
    if (hasCompletedRef.current || size.width === 0 || size.height === 0) return;
    const cellW = size.width / cols;
    const cellH = size.height / rows;
    const cx = Math.floor(locationX / cellW);
    const cy = Math.floor(locationY / cellH);

    let added = false;
    // A single cell under a fingertip reads as a pinprick, not a scratch —
    // clearing the 3x3 neighborhood gives an actual stroke width.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
        const idx = y * cols + x;
        if (!revealedRef.current.has(idx)) {
          revealedRef.current.add(idx);
          added = true;
        }
      }
    }
    if (added) setRevealedVersion(v => v + 1);

    if (revealedRef.current.size / totalCells >= threshold) completeReveal();
  }, [size, cols, rows, totalCells, threshold, completeReveal]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt) => {
      setStarted(true);
      revealAround(evt.nativeEvent.locationX, evt.nativeEvent.locationY);
    },
    onPanResponderMove: (evt) => {
      revealAround(evt.nativeEvent.locationX, evt.nativeEvent.locationY);
    },
  }), [revealAround]);

  const chips = useMemo(() => {
    if (size.width === 0 || size.height === 0) return null;
    const cellW = size.width / cols;
    const cellH = size.height / rows;
    const items = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = y * cols + x;
        items.push(
          <ScratchChip
            key={idx}
            revealed={revealedRef.current.has(idx)}
            color={coverColor}
            style={{ left: x * cellW, top: y * cellH, width: cellW + 0.5, height: cellH + 0.5 }}
          />
        );
      }
    }
    return items;
    // revealedVersion is the actual dependency driving re-renders here —
    // revealedRef itself is intentionally excluded, it's a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, cols, rows, coverColor, revealedVersion]);

  return (
    <View style={[styles.container, style]} onLayout={onLayout} {...panResponder.panHandlers}>
      <View style={styles.revealLayer} pointerEvents="none">{revealContent}</View>
      {chips}
      {!started && (
        <View style={styles.hint} pointerEvents="none">
          <Sparkles size={22} color="#4B5563" />
          <Text style={styles.hintText}>{hintLabel}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 20, overflow: 'hidden', position: 'relative' },
  revealLayer: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  hint: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', gap: 6 },
  hintText: { fontSize: 13, fontWeight: '600', color: '#4B5563' },
});
