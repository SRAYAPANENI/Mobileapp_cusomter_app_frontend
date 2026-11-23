import { Linking, Platform } from 'react-native';

/** Opens the phone's maps with the way there: the pin when known, the address if not. */
export async function openDirections(address: string | null, lat?: number | null, lng?: number | null): Promise<void> {
  const to = encodeURIComponent(lat != null && lng != null ? `${lat},${lng}` : address ?? '');
  if (!to) return;
  const web = `https://www.google.com/maps/dir/?api=1&destination=${to}`;
  await Linking.openURL(Platform.OS === 'ios' ? `https://maps.apple.com/?daddr=${to}` : web);
}
