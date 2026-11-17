import { useAppAlert } from '@/components/app-alert';
import { Popup, PopupCard } from '@/components/popup';
import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { JobPhoto, PhotoSize, shrinkPhoto } from '@/services/photo';
import * as ImagePicker from 'expo-image-picker';
import { Camera, FileText, Image as ImageIcon, Trash2 } from 'lucide-react-native';
import React, { useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// "Take Photo / Choose from Gallery" — the app's one way to add a photo
// that isn't proof taken on the spot (those stay camera-only: a pickup, a
// drop-off, a door, an inspection). The popup is the app's own design (the
// one Profile's photo used), not the phone's system sheet.
//
// A hook with an element, like useAppAlert: the screen renders `element`
// where it is — inside its own popup when the photo is added from one. On
// iPhone a popup opens over the screen it's drawn in; one drawn at the app's
// root couldn't open while another popup was showing.

export type { JobPhoto } from '@/services/photo';

export interface PickPhotosOptions {
  /** The popup's title — "Add a photo", "Profile Photo". */
  title: string;
  /** What the photo is for — sets how much it's shrunk (services/photo.ts). */
  size?: PhotoSize;
  /** From the gallery: several at once (a number: at most that many). */
  multiple?: boolean | number;
  /** Cropped to this ratio before it's used — [1, 1] for a profile picture. One photo. */
  crop?: [number, number];
  /** Also as base64, for the uploads that send it inside JSON. */
  base64?: boolean;
  /** The camera opens on the front lens (a selfie). */
  frontCamera?: boolean;
  /** The gallery offers videos too (skill proof). Videos aren't shrunk;
   * each result's `kind` says which it is. The camera still takes a photo. */
  videos?: boolean;
  /** One more row under the two: "Choose a File" (a PDF), "Remove Photo". */
  extra?: { label: string; kind: 'file' | 'remove'; onPress: () => void };
}

type Choice = 'camera' | 'library' | 'extra' | null;

export function usePhotoPicker() {
  const colorScheme = useColorScheme() ?? 'light';
  const t = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const alert = useAppAlert();
  const [asking, setAsking] = useState<PickPhotosOptions | null>(null);
  const [open, setOpen] = useState(false);
  // The caller's promise, and what was chosen — acted on once the popup has
  // gone: on iPhone the camera can't open while a popup is still closing.
  const pending = useRef<{ options: PickPhotosOptions; resolve: (photos: JobPhoto[]) => void } | null>(null);
  const chosen = useRef<Choice>(null);
  const settled = useRef(false);
  // Each ask is a round. A timer or a dismissal belongs to the round it was
  // started in: one left over from an ask just closed must not answer the
  // next one (closed, and the button tapped again within a moment).
  const round = useRef(0);
  const closingRound = useRef(0);

  /** Asks camera or gallery, opens it, and gives back the photos, shrunk —
   * none when it was closed, cancelled or not allowed. */
  const pickPhotos = (options: PickPhotosOptions): Promise<JobPhoto[]> => {
    pending.current?.resolve([]);   // an earlier ask left open counts as cancelled
    return new Promise((resolve) => {
      round.current += 1;
      pending.current = { options, resolve };
      chosen.current = null;
      settled.current = false;
      setAsking(options);
      setOpen(true);
    });
  };

  const choose = (choice: Choice) => {
    const r = round.current;
    closingRound.current = r;
    chosen.current = choice;
    setOpen(false);
    // iPhone says when the popup has gone (onDismiss); Android has no such
    // call, and its camera opens fine right after.
    setTimeout(() => { void proceed(r); }, Platform.OS === 'ios' ? 700 : 50);   // iPhone: in case onDismiss never comes
  };

  const proceed = async (r: number) => {
    if (r !== round.current || settled.current) return;
    settled.current = true;
    const job = pending.current;
    pending.current = null;
    if (!job) return;
    const { options, resolve } = job;
    const choice = chosen.current;
    if (choice === 'extra') {
      resolve([]);
      options.extra?.onPress();
      return;
    }
    if (choice !== 'camera' && choice !== 'library') {
      resolve([]);
      return;
    }
    try {
      resolve(await launch(choice, options));
    } catch {
      alert.show('error', 'Could Not Add the Photo', 'Please try again.');
      resolve([]);
    }
  };

  const launch = async (source: 'camera' | 'library', options: PickPhotosOptions): Promise<JobPhoto[]> => {
    // Only the camera asks. The gallery opens the phone's own photo picker
    // (Android, iOS 14+), which needs no permission — asking anyway added a
    // prompt, and a "no" on Android shut a gallery that would have worked.
    const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : { granted: true, canAskAgain: true };
    if (!permission.granted) {
      const what = source === 'camera' ? 'camera' : 'photo';
      if (permission.canAskAgain === false) {
        // Turned off for good: only Settings can turn it back on.
        alert.show('warning', `${source === 'camera' ? 'Camera' : 'Photo'} Access Needed`,
          `${what === 'camera' ? 'Camera' : 'Photo'} access is turned off for this app. Turn it on in Settings to add a photo.`,
          [{ text: 'Not now', cancel: true }, { text: 'Open Settings', variant: 'primary', onPress: () => { void Linking.openSettings(); } }]);
      } else {
        alert.show('warning', 'Permission Needed', `Allow ${what} access to add a photo.`);
      }
      return [];
    }

    const crop = options.crop;
    const several = !crop && !!options.multiple;
    // Full quality in, shrunk once after (services/photo.ts) — compressing
    // twice only blurs it. On iPhone the gallery hands over a JPEG, not HEIC
    // (the server takes JPEG, PNG and WEBP), should shrinking ever fail.
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'], quality: 1,
          allowsEditing: !!crop, aspect: crop,
          cameraType: options.frontCamera ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: options.videos ? ['images', 'videos'] : ['images'], quality: 1,
          allowsEditing: !!crop, aspect: crop,
          allowsMultipleSelection: several,
          selectionLimit: several && typeof options.multiple === 'number' ? options.multiple : 0,
          preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        });
    if (result.canceled || !result.assets?.length) return [];
    const photos: JobPhoto[] = [];
    // One at a time: each holds a full-size picture in memory while it shrinks.
    for (const asset of result.assets) {
      if (asset.type === 'video') {
        photos.push({ uri: asset.uri, mimeType: asset.mimeType ?? 'video/mp4', kind: 'video' });
        continue;
      }
      photos.push({ ...(await shrinkPhoto(asset, options.size ?? 'job', { base64: options.base64 })), kind: 'image' });
    }
    return photos;
  };

  const rowText = [styles.optionText, { color: t.textPrimary }];
  const element = (
    <>
      <Popup
        closeOn="outside"
        visible={open}
        transparent
        animationType="fade"
        onClose={() => choose(null)}
        onDismiss={() => { void proceed(closingRound.current); }}
      >
        <View style={styles.overlay}>
          {/* Lifted above the navigation bar, whichever kind the phone uses. */}
          <PopupCard style={[styles.sheet, { backgroundColor: t.card, marginBottom: 24 + insets.bottom }]}>
            <View style={[styles.header, { borderBottomColor: t.borderSubtle }]}>
              <ThemedText style={[styles.title, { color: t.textPrimary }]}>{asking?.title ?? 'Add a Photo'}</ThemedText>
            </View>

            <TouchableOpacity style={styles.option} onPress={() => choose('camera')} accessibilityRole="button">
              <View style={[styles.iconBox, { backgroundColor: '#E0F2FE' }]}>
                <Camera size={20} color="#0EA5E9" />
              </View>
              <ThemedText style={rowText}>Take Photo</ThemedText>
            </TouchableOpacity>

            <TouchableOpacity style={styles.option} onPress={() => choose('library')} accessibilityRole="button">
              <View style={[styles.iconBox, { backgroundColor: '#F0F9FF' }]}>
                <ImageIcon size={20} color="#0369A1" />
              </View>
              <ThemedText style={rowText}>Choose from Gallery</ThemedText>
            </TouchableOpacity>

            {!!asking?.extra && (
              <TouchableOpacity style={styles.option} onPress={() => choose('extra')} accessibilityRole="button">
                {asking.extra.kind === 'remove' ? (
                  <View style={[styles.iconBox, { backgroundColor: '#FEF2F2' }]}>
                    <Trash2 size={20} color="#EF4444" />
                  </View>
                ) : (
                  <View style={[styles.iconBox, { backgroundColor: '#F3F4F6' }]}>
                    <FileText size={20} color="#374151" />
                  </View>
                )}
                <ThemedText style={[rowText, asking.extra.kind === 'remove' && { color: '#EF4444' }]}>
                  {asking.extra.label}
                </ThemedText>
              </TouchableOpacity>
            )}
          </PopupCard>
        </View>
      </Popup>
      {alert.element}
    </>
  );

  return { pickPhotos, element };
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    width: '90%',
    borderRadius: 24,
    padding: 24,
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  header: { marginBottom: 16, borderBottomWidth: 1, paddingBottom: 12 },
  title: { fontSize: 18, lineHeight: 24, fontFamily: Fonts.poppinsBold },
  option: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 12 },
  iconBox: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  optionText: { fontSize: 15, lineHeight: 21, fontFamily: Fonts.poppinsSemiBold },
});
