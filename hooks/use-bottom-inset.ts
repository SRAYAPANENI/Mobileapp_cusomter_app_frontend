import { useEffect, useState } from 'react';
import { Keyboard, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Android draws the app behind its navigation bar (edge-to-edge). With the
// 3-button bar (Back / Home / Recents), whatever sat at the very bottom of a
// screen ended up underneath it — e.g. "View Applicants" on the last job in
// My Jobs couldn't be tapped. On iOS this is the home indicator.

/** Height of the phone's navigation bar / home indicator (0 when there's none).
 * 0 while the keyboard is up: it covers the bar, and keeping the space would
 * leave a gap between the keyboard and a reply box. */
export function useBottomInset(): number {
  const { bottom } = useSafeAreaInsets();
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardUp(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return keyboardUp ? 0 : bottom;
}

function numeric(...values: unknown[]): number {
  for (const v of values) if (typeof v === 'number') return v;
  return 0;
}

/** For the bottom-most content (a list's content, a footer): the style with
 * the navigation bar added to its bottom padding. */
export function padBottom(style: StyleProp<ViewStyle>, inset: number): ViewStyle {
  const flat = StyleSheet.flatten(style) ?? {};
  return { ...flat, paddingBottom: numeric(flat.paddingBottom, flat.paddingVertical, flat.padding) + inset };
}

/** For a footer or sheet whose own bottom padding was already a rough
 * allowance for the iPhone home indicator ("40 on iOS, 24 on Android"): at
 * least the bar plus a small gap, without adding the bar on top of that
 * allowance (which doubled it on iPhones). */
export function fitBottom(style: StyleProp<ViewStyle>, inset: number, gap = 12): ViewStyle {
  const flat = StyleSheet.flatten(style) ?? {};
  return { ...flat, paddingBottom: Math.max(numeric(flat.paddingBottom, flat.paddingVertical, flat.padding), inset + gap) };
}

/** For something pinned near the bottom (`bottom: 20`): lifted above the bar. */
export function liftBottom(style: StyleProp<ViewStyle>, inset: number): ViewStyle {
  const flat = StyleSheet.flatten(style) ?? {};
  return { ...flat, bottom: numeric(flat.bottom) + inset };
}
