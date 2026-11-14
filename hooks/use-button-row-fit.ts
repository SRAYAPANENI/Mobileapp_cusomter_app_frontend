import { useCallback, useState } from 'react';
import type { NativeSyntheticEvent, TextLayoutEventData, ViewStyle } from 'react-native';

const STACKED_BUTTON: ViewStyle = { flex: 0, width: '100%', marginLeft: 0, marginRight: 0, marginHorizontal: 0 };
const ROW_MAIN_LAST: ViewStyle = { flexDirection: 'column-reverse', alignItems: 'stretch', gap: 10 };
const ROW_MAIN_FIRST: ViewStyle = { flexDirection: 'column', alignItems: 'stretch', gap: 10 };

/**
 * Buttons side by side, unless a label would wrap there ("Send to provider"
 * on a narrow phone, or with the phone's text size turned up): then they
 * stack, full width, the main action on top. Measured from the labels as
 * they're laid out, not guessed from their length.
 *
 *   const fit = useButtonRowFit();
 *   <View style={[s.row, fit.row]}>
 *     <TouchableOpacity style={[s.secondary, fit.button]}>
 *       <Text onTextLayout={fit.onLabelLayout}>Cancel</Text>
 *
 * `mainAction`: where the row's main button is — 'last' (the usual, on the
 * right) or 'first' — so it ends up on top either way.
 */
export function useButtonRowFit(mainAction: 'last' | 'first' = 'last') {
  const [stacked, setStacked] = useState(false);
  const onLabelLayout = useCallback((e: NativeSyntheticEvent<TextLayoutEventData>) => {
    if (e.nativeEvent.lines.length > 1) setStacked(true);
  }, []);
  return {
    stacked,
    onLabelLayout,
    row: stacked ? (mainAction === 'last' ? ROW_MAIN_LAST : ROW_MAIN_FIRST) : undefined,
    button: stacked ? STACKED_BUTTON : undefined,
  };
}
