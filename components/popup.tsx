import React from 'react';
import { Keyboard, Modal, ModalProps, Pressable, StyleSheet, View, ViewProps } from 'react-native';

/**
 * How a popup may be closed without pressing one of its own buttons.
 *
 *  - 'outside': tapping outside the card or pressing Back closes it. For
 *    popups where nothing is lost or decided — menus, pickers, viewers, info.
 *  - 'back':    only Back closes it; a stray tap outside does nothing. For
 *    popups holding typed text or a decision — forms, payments, ratings.
 *  - 'none':    nothing closes it. Only while something is running that must
 *    not be interrupted, e.g. a payment being processed.
 *
 * iPhones have no Back button, so a popup that isn't 'outside' must offer its
 * own Close / Cancel button.
 */
export type PopupCloseOn = 'outside' | 'back' | 'none';

export interface PopupProps extends Omit<ModalProps, 'onRequestClose'> {
  visible: boolean;
  /** Called when the popup asks to close (Back, or a tap outside). */
  onClose?: () => void;
  closeOn: PopupCloseOn;
  children?: React.ReactNode;
}

/**
 * Every popup in the app goes through this one wrapper, so each one closes
 * the same way. The look stays with the caller: this adds no styling.
 *
 * With closeOn="outside" a tap anywhere that isn't a button or a
 * <PopupCard> closes the popup — wrap the popup's card in <PopupCard> so
 * taps on the card itself are kept.
 */
export function Popup({ visible, onClose, closeOn, children, ...modalProps }: PopupProps) {
  const requestClose = () => {
    if (closeOn !== 'none') onClose?.();
  };

  // A tap outside while typing (a search box, say) only puts the keyboard
  // away; the next one closes. Otherwise hiding the keyboard would throw
  // away the popup and whatever was typed in it.
  const tapOutside = () => {
    if (Keyboard.isVisible()) Keyboard.dismiss();
    else requestClose();
  };

  return (
    <Modal visible={visible} onRequestClose={requestClose} {...modalProps}>
      {closeOn === 'outside' ? (
        <Pressable
          style={styles.fill}
          onPress={tapOutside}
          accessible={false}
          // VoiceOver's "escape" gesture (two-finger Z) closes it, as Back does.
          onAccessibilityEscape={requestClose}
        >
          {children}
        </Pressable>
      ) : (
        <View style={styles.fill} onAccessibilityEscape={requestClose}>
          {children}
        </View>
      )}
    </Modal>
  );
}

/**
 * The popup's own surface. A tap on it stays here instead of reaching the
 * popup's background, so it never closes the popup.
 */
export function PopupCard(props: ViewProps) {
  return <View onStartShouldSetResponder={() => true} {...props} />;
}

/**
 * Put inside a bottom sheet's card, last: the card's colour carried on below
 * its bottom edge, so the sheet always meets the bottom of the screen. On
 * Android a sheet could stop short of it — the navigation bar's room left
 * out, or a keyboard's lift kept after it closed — and the page behind showed
 * through in a strip under the sheet. Behind an open keyboard it's unseen.
 */
export function SheetBottomFill({ color }: { color: string }) {
  return <View pointerEvents="none" style={[styles.bottomFill, { backgroundColor: color }]} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bottomFill: { position: 'absolute', top: '100%', left: 0, right: 0, height: 400 },
});
