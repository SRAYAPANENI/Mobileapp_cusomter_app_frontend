/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: '#FFCE48',
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: '#FFCE48',
    brand: '#FFCE48',
    brandDark: '#111111',
    inputBackground: '#FFFFFF',
    inputBorder: '#E5E7EB',
    shadow: '#000',
    // Semantic surface tokens
    card: '#FFFFFF',
    modalBackground: '#FFFFFF',
    surface: '#F9FAFB',
    inputFilled: '#F3F4F6',
    border: '#E5E7EB',
    borderSubtle: '#F3F4F6',
    textPrimary: '#111827',
    textSecondary: '#6B7280',
    textMuted: '#9CA3AF',
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: '#FFCE48',
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: '#FFCE48',
    brand: '#FFCE48',
    brandDark: '#FFFFFF',
    inputBackground: '#1F2937',
    inputBorder: '#374151',
    shadow: '#000',
    // Semantic surface tokens
    card: '#1E2530',
    modalBackground: '#1E2530',
    surface: '#111827',
    inputFilled: '#1F2937',
    border: '#374151',
    borderSubtle: '#1F2937',
    textPrimary: '#F9FAFB',
    textSecondary: '#9CA3AF',
    textMuted: '#6B7280',
  },
};



export const Fonts = Platform.select({
  ios: {
    sans: 'Poppins-Regular',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
    poppins: 'Poppins-Regular',
    poppinsBold: 'Poppins-Bold',
    poppinsSemiBold: 'Poppins-SemiBold',
  },
  default: {
    sans: 'Poppins-Regular',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
    poppins: 'Poppins-Regular',
    poppinsBold: 'Poppins-Bold',
    poppinsSemiBold: 'Poppins-SemiBold',
  },
  web: {
    sans: "'Poppins-Regular', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    poppins: "'Poppins-Regular', sans-serif",
    poppinsBold: "'Poppins-Bold', sans-serif",
    poppinsSemiBold: "'Poppins-SemiBold', sans-serif",
  },
});
