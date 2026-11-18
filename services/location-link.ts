/**
 * A location pasted as a link — shared on WhatsApp or Google Maps — turned
 * into a place, wherever an address is asked for (posting a job, Pickup &
 * Drop, saved addresses, registering).
 *
 * The server reads the link (POST /jobs/pickup-location-link): its pin and,
 * when the link names it, the place — a business's Google Maps link does.
 * A named place is then found on Google next to that pin, so a store comes
 * back with its Google types and can be checked like a typed one.
 */
import * as Clipboard from 'expo-clipboard';
import * as Location from 'expo-location';
import { SkoFyApi } from './api';
import { GooglePlacesService } from './google-places';
import { looksLikeLink, tripMiles } from './pickupOptions';

export { looksLikeLink };

/** A place a link gave. */
export interface LinkedPlace {
  lat: number;
  lng: number;
  /** What to show in the address box. */
  address: string;
  /** The Google place the link is for — only when it named one found at its pin. */
  placeId: string | null;
  primaryType: string | null;
  types: string[];
  city?: string;
  state?: string;
  pincode?: string;
}

/** A link gives a place, or — with no pin — a name to search for as typed. */
export type LinkResult = { kind: 'place'; place: LinkedPlace } | { kind: 'search'; query: string };

/** Why a link couldn't be used, said to the customer. */
export class LinkError extends Error {}

// How near the pin the named place must be to be the one the link means.
const SAME_PLACE_MILES = 0.2; // about 300 m

/**
 * What the link points to. `store`: the place must be a business found on
 * Google (to be checked against the allowed store types) — a bare pin, a
 * spot on the map, can't be checked, so it's refused with what to do instead.
 */
export async function placeFromLink(text: string, opts: { store?: boolean } = {}): Promise<LinkResult> {
  let found: { lat: number | null; lng: number | null; query: string | null; name?: string | null };
  try {
    found = await SkoFyApi.jobs.resolveLocationLink(text);
  } catch (e: any) {
    throw new LinkError(e?.message || "Couldn't read that link. Type the address instead.");
  }
  if (found.lat == null || found.lng == null) {
    if (found.query) return { kind: 'search', query: found.query };
    throw new LinkError("Couldn't read that link. Type the address instead.");
  }
  const pin = { lat: found.lat, lng: found.lng };

  const named = found.name ? await placeNamedAt(found.name, pin) : null;
  if (named) return { kind: 'place', place: named };
  if (opts.store) {
    throw new LinkError(found.name
      ? `Couldn't find ${found.name} on the map there. Search for the store by name instead.`
      : "That link is a spot on the map, not a store. Share the store's own link from Google Maps, or search for it by name.");
  }
  return { kind: 'place', place: await pinnedPlace(pin, found.name ?? null) };
}

/** The clipboard's text, for a "Paste a location link" button. */
export async function clipboardText(): Promise<string> {
  const text = (await Clipboard.getStringAsync().catch(() => '')).trim();
  if (!text) throw new LinkError('Nothing to paste — copy the location link first.');
  if (!looksLikeLink(text)) throw new LinkError("What's copied isn't a link. Copy the location link from WhatsApp or Google Maps.");
  return text;
}

/** The place named `name` nearest the pin, if one is close enough to be it. */
async function placeNamedAt(name: string, pin: { lat: number; lng: number }): Promise<LinkedPlace | null> {
  try {
    const suggestions = await GooglePlacesService.searchAddress(name, undefined, { latitude: pin.lat, longitude: pin.lng });
    // The nearest few: each look-up is a paid call, and the right one is
    // nearly always first (the search leans on the pin).
    for (const s of suggestions.slice(0, 3)) {
      const d = await GooglePlacesService.getPlaceDetails(s.place_id);
      if (tripMiles(pin, { lat: d.latitude, lng: d.longitude }) <= SAME_PLACE_MILES) {
        return {
          lat: d.latitude, lng: d.longitude, address: d.formatted_address,
          placeId: s.place_id, primaryType: d.primary_type ?? null, types: d.types ?? [],
          city: d.city, state: d.state, pincode: d.pincode,
        };
      }
    }
  } catch {
    // Search down: the pin still stands (or, for a store, is refused).
  }
  return null;
}

/** A bare pin, named from the map. */
async function pinnedPlace(pin: { lat: number; lng: number }, name: string | null): Promise<LinkedPlace> {
  let address = name ?? `Shared location (${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)})`;
  let city: string | undefined, state: string | undefined, pincode: string | undefined;
  try {
    const [p] = await Location.reverseGeocodeAsync({ latitude: pin.lat, longitude: pin.lng });
    if (p) {
      const street = [p.streetNumber, p.street].filter(Boolean).join(' ');
      const line = [name ?? p.name, street && street !== p.name ? street : null, p.city, p.region, p.postalCode]
        .filter(Boolean).join(', ');
      if (line) address = line;
      city = p.city ?? undefined; state = p.region ?? undefined; pincode = p.postalCode ?? undefined;
    }
  } catch { /* the coordinates are enough */ }
  return { lat: pin.lat, lng: pin.lng, address, placeId: null, primaryType: null, types: [], city, state, pincode };
}
