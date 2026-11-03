import { AppAlert } from '@/components/app-alert';
import React from 'react';

// The session ended: the shared dialog (components/app-alert.tsx), so it
// looks like every other one. It's information, not something the user did
// wrong, so it's "info", and its one action says what happens next. The
// caller navigates to login in onDismiss: the button only closes the
// dialog, and onDismiss runs once.
export default function SessionExpiredModal({
  visible,
  onDismiss,
}: {
  visible: boolean;
  onDismiss: () => void;
}) {
  return (
    <AppAlert
      visible={visible}
      type="info"
      title="Signed out"
      message="Your session has ended. Please log in again."
      buttons={[{ text: 'Log in' }]}
      onDismiss={onDismiss}
    />
  );
}
