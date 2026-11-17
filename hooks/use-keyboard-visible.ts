import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/** Whether the keyboard is up. On iPhone from the moment it starts to rise
 * (keyboardWillShow), so what hides for it hides with it; Android only says
 * once it's up. */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return visible;
}
