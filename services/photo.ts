import type { ImageManipulatorContext, ImageRef } from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';

// Photos are shrunk before they're sent: a phone camera's full-size photo is
// 3–6 MB, and on a weak signal (a pickup, a basement, a building site) the
// upload took minutes or timed out after the server had kept it. How small
// depends on what the photo is for:
//   job      — proof and evidence (pickup, drop-off, inspection, a claim,
//              support): read on a phone screen, 1600 px is plenty to read
//              a receipt or a label.
//   document — an ID, a licence, a certificate: reviewed by a person who
//              must read small print, so kept larger and sharper.
//   avatar   — a profile picture, shown small.
export type PhotoSize = 'job' | 'document' | 'avatar';

const SIZES: Record<PhotoSize, { longSide: number; quality: number }> = {
  job: { longSide: 1600, quality: 0.7 },
  document: { longSide: 2400, quality: 0.85 },
  avatar: { longSide: 800, quality: 0.8 },
};

export interface JobPhoto {
  uri: string;
  mimeType: string;
  width?: number;
  height?: number;
  /** Only when asked for (`base64: true`) — for the uploads sent inside JSON. */
  base64?: string;
  /** From a picker that offers videos too (components/photo-picker.tsx). */
  kind?: 'image' | 'video';
}

type Shrinkable = Pick<ImagePickerAsset, 'uri' | 'width' | 'height' | 'mimeType'> & { base64?: string | null };

/** A photo, ready to upload: no bigger than its size allows, saved as JPEG.
 * If shrinking fails, the original is sent — a photo that's too big still
 * beats one that can't be sent at all. */
export async function shrinkPhoto(
  asset: Shrinkable,
  size: PhotoSize = 'job',
  options: { base64?: boolean } = {},
): Promise<JobPhoto> {
  const { longSide, quality } = SIZES[size];
  let context: ImageManipulatorContext | null = null;
  let image: ImageRef | null = null;
  try {
    // Loaded here, not imported at the top: the module looks for its native
    // half as it loads, and an app build without it (a dev client older than
    // this code) would otherwise fail every screen importing this file. Here
    // it only means the photo goes unshrunk.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ImageManipulator, SaveFormat } = require('expo-image-manipulator') as typeof import('expo-image-manipulator');
    context = ImageManipulator.manipulate(asset.uri);
    // The picker's width/height are as the photo is seen (EXIF rotation
    // applied, on Android too — expo-image-picker's DimensionsExporter), and
    // the loader turns the pixels the same way: the long side here is the
    // long side drawn. Only ever smaller; the other side follows.
    const { width, height } = asset;
    if (width > longSide || height > longSide) {
      context.resize(width >= height ? { width: longSide, height: null } : { width: null, height: longSide });
    }
    image = await context.renderAsync();
    const saved = await image.saveAsync({ compress: quality, format: SaveFormat.JPEG, base64: !!options.base64 });
    return {
      uri: saved.uri, mimeType: 'image/jpeg', width: saved.width, height: saved.height,
      ...(options.base64 && saved.base64 ? { base64: saved.base64 } : {}),
    };
  } catch {
    return {
      uri: asset.uri, mimeType: asset.mimeType || 'image/jpeg', width: asset.width, height: asset.height,
      ...(options.base64 ? { base64: (await readBase64(asset.uri)) ?? asset.base64 ?? undefined } : {}),
    };
  } finally {
    // Native memory (a full-size bitmap while it works), freed either way.
    context?.release();
    image?.release();
  }
}

/** The file as base64 — the fallback when it couldn't be shrunk. */
async function readBase64(uri: string): Promise<string | null> {
  try {
    // expo-file-system 19's File API (the old readAsStringAsync throws in this version).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { File } = require('expo-file-system') as typeof import('expo-file-system');
    return await new File(uri).base64();
  } catch {
    return null;
  }
}
