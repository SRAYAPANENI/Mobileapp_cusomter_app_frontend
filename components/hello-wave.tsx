import Animated from 'react-native-reanimated';
import { MAX_FONT_SCALE } from '@/components/scaled-text';

export function HelloWave() {
  return (
    <Animated.Text maxFontSizeMultiplier={MAX_FONT_SCALE}
      style={{
        fontSize: 28,
        lineHeight: 32,
        marginTop: -6,
        animationName: {
          '50%': { transform: [{ rotate: '25deg' }] },
        },
        animationIterationCount: 4,
        animationDuration: '300ms',
      }}>
      👋
    </Animated.Text>
  );
}
