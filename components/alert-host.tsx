import React, { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { AlertButton, AlertType, AppAlert } from './app-alert';

// The app's one dialog, callable from anywhere: screens, components and
// services like the call manager that have no screen of their own. It takes
// the same arguments as React Native's Alert.alert, so a call reads the same,
// but it shows the app's dialog (components/app-alert.tsx) instead of the
// phone's grey system box. <AlertHost /> is mounted once at the app's root.

/** Alert.alert's button: `style` says what kind of action it is. */
export interface NativeStyleButton {
  text?: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface Options {
  /** What it's about; guessed from the title and buttons when not given. */
  type?: AlertType;
  /** false: a tap outside doesn't close it, for a dialog that must be
   * answered. Back still does. Defaults to true, as on Android. */
  cancelable?: boolean;
}

interface Pending {
  type: AlertType;
  title: string;
  message: string;
  buttons?: AlertButton[];
  dismissable: boolean;
}

let present: ((a: Pending) => void) | null = null;
const waiting: Pending[] = [];

const ERROR_WORDS = /\b(error|failed|fail|couldn'?t|could not|not sent|not connected|not saved|didn'?t)\b/i;
const SUCCESS_WORDS = /\b(thanks|thank you|welcome|done|saved|sent|success|submitted|hired|completed)\b/i;

function guessType(title: string, buttons?: NativeStyleButton[]): AlertType {
  if (buttons?.some((b) => b.style === 'destructive')) return 'warning';
  if (ERROR_WORDS.test(title)) return 'error';
  if (SUCCESS_WORDS.test(title)) return 'success';
  return 'info';
}

/** Alert.alert's buttons as the dialog's: cancel ones first (on the left, or
 * at the bottom when stacked), the last plain one as the main action, any
 * other plain ones as secondary choices, destructive ones in red. */
function toButtons(buttons?: NativeStyleButton[]): AlertButton[] | undefined {
  if (!buttons?.length) return undefined;
  const cancels = buttons.filter((b) => b.style === 'cancel');
  const rest = buttons.filter((b) => b.style !== 'cancel');
  const lastPlain = [...rest].reverse().find((b) => b.style !== 'destructive');
  return [...cancels, ...rest].map((b) => ({
    text: b.text ?? 'OK',
    onPress: b.onPress,
    cancel: b.style === 'cancel',
    variant: b.style === 'cancel' ? 'secondary'
      : b.style === 'destructive' ? 'destructive'
      : b === lastPlain ? 'primary' : 'secondary',
  }));
}

/** Shows the app's dialog, the way Alert.alert would. */
export function showDialog(title: string, message?: string, buttons?: NativeStyleButton[], options?: Options): void {
  if (!present) {
    // Not mounted yet (the very first moments of launch): the system dialog
    // rather than nothing.
    Alert.alert(title, message, buttons);
    return;
  }
  const next: Pending = {
    type: options?.type ?? guessType(title, buttons),
    title,
    message: message ?? '',
    buttons: toButtons(buttons),
    dismissable: options?.cancelable !== false,
  };
  present(next);
}

/** Mounted once, at the root. One dialog at a time; others wait their turn. */
export function AlertHost() {
  const [current, setCurrent] = useState<Pending | null>(null);

  useEffect(() => {
    present = (a) => setCurrent((cur) => {
      if (cur) { waiting.push(a); return cur; }
      return a;
    });
    return () => { present = null; };
  }, []);

  const close = () => setCurrent(waiting.shift() ?? null);

  return (
    <AppAlert
      visible={!!current}
      type={current?.type ?? 'info'}
      title={current?.title ?? ''}
      message={current?.message ?? ''}
      buttons={current?.buttons}
      dismissable={current?.dismissable ?? true}
      onDismiss={close}
    />
  );
}
