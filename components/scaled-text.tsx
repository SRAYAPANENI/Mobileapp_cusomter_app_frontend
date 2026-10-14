import React, { forwardRef } from 'react';
import {
  PixelRatio,
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  useWindowDimensions,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';

// The app's own Text and TextInput — every screen imports these instead of
// React Native's, so how text responds to the phone is decided here, once.
//
// 1. The phone's font-size setting. It used to scale every label and input
//    freely: at a large setting, buttons, badges, chips and cards overflowed.
//    MAX_FONT_SCALE: 1 = the size as designed, whatever the setting. Raise it
//    (e.g. 1.15) to let people with larger system fonts get slightly larger
//    text, after checking the tightest screens still fit.
//
// 2. The screen's width. The layouts were designed for phones about
//    DESIGN_WIDTH wide; on a narrower screen — a small phone, or Android's
//    "Display size" set larger — labels wrapped onto two lines and pushed rows
//    out of line. Text shrinks in proportion to the missing width, never by
//    more than MIN_NARROW_FACTOR. Wider screens are unchanged.
export const MAX_FONT_SCALE = 1;
export const DESIGN_WIDTH = 390;
export const MIN_NARROW_FACTOR = 0.85;

// A smaller system font is ignored too (it shrank text below the design);
// a larger one is capped at MAX_FONT_SCALE.
function scalingProps() {
  return PixelRatio.getFontScale() < 1
    ? { allowFontScaling: false }
    : { maxFontSizeMultiplier: MAX_FONT_SCALE };
}

/** 1 on screens at least DESIGN_WIDTH wide, down to MIN_NARROW_FACTOR. */
export function narrowFactor(width: number): number {
  if (width >= DESIGN_WIDTH) return 1;
  return Math.max(MIN_NARROW_FACTOR, width / DESIGN_WIDTH);
}

function fitToWidth<S extends StyleProp<TextStyle>>(style: S, factor: number): StyleProp<TextStyle> {
  if (factor >= 1 || !style) return style;
  const flat = StyleSheet.flatten(style) ?? {};
  const scaled: TextStyle = {};
  if (typeof flat.fontSize === 'number') scaled.fontSize = flat.fontSize * factor;
  if (typeof flat.lineHeight === 'number') scaled.lineHeight = flat.lineHeight * factor;
  if (typeof flat.letterSpacing === 'number') scaled.letterSpacing = flat.letterSpacing * factor;
  return [style, scaled];
}

export const Text = forwardRef<React.ComponentRef<typeof RNText>, TextProps>(
  ({ style, ...props }, ref) => {
    const factor = narrowFactor(useWindowDimensions().width);
    return <RNText {...scalingProps()} {...props} style={fitToWidth(style, factor)} ref={ref} />;
  },
);
Text.displayName = 'Text';

export const TextInput = forwardRef<React.ComponentRef<typeof RNTextInput>, TextInputProps>(
  ({ style, ...props }, ref) => {
    const factor = narrowFactor(useWindowDimensions().width);
    return <RNTextInput {...scalingProps()} {...props} style={fitToWidth(style, factor)} ref={ref} />;
  },
);
TextInput.displayName = 'TextInput';

// So `useRef<TextInput>(null)` and similar keep working as types.
export type Text = RNText;
export type TextInput = RNTextInput;
