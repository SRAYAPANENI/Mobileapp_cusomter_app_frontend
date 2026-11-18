import Constants from 'expo-constants';

/**
 * Google Places API Integration Service (New v1 API)
 * Uses the API key from app.json
 */

// Read from `extra`: Expo strips `android.config` from the config embedded in
// a release build (it treats it as private), so the googleMaps key is only
// there in dev — a release APK sent an empty key and every search failed with
// PERMISSION_DENIED. `android.config.googleMaps` stays for the native Maps SDK.
export const GOOGLE_PLACES_API_KEY: string =
  (Constants.expoConfig?.extra?.googlePlacesApiKey as string | undefined)
  ?? Constants.expoConfig?.android?.config?.googleMaps?.apiKey
  ?? '';
if (!GOOGLE_PLACES_API_KEY) {
  console.warn('GOOGLE_PLACES_API_KEY is not configured — set expo.extra.googlePlacesApiKey in app.json.');
}

export interface GooglePlaceSuggestion {
  description: string;
  place_id: string;
  distance?: string;
  // Every Google type the place carries (e.g. a Walgreens is "drugstore"
  // AND "convenience_store") — lets a caller rank or judge suggestions
  // without filtering the search itself. Empty for plain addresses.
  types: string[];
  structured_formatting: {
    main_text: string;
    secondary_text: string;
    main_text_matched_substrings?: Array<{ offset: number; length: number }>;
  };
}

export interface PlaceDetails {
  latitude: number;
  longitude: number;
  formatted_address: string;
  city?: string;
  state?: string;
  pincode?: string;
  // The place's primary Google Places type (e.g. "grocery_store") — used to
  // gate pickup/dropoff jobs' pickup location to verified business types.
  // Undefined for place lookups that didn't request it (most callers don't
  // need it) or when Places itself doesn't return one.
  primary_type?: string;
  // All of the place's Google types — a store is judged on these, not just
  // primary_type (Walgreens' primary is "drugstore", McDonald's'
  // "fast_food_restaurant"; both also carry an allowed type).
  types?: string[];
}

// Generate a random session token for billing optimization (New API uses sessionToken as part of the request)
let sessionToken = Math.random().toString(36).substring(2, 15);

export const GooglePlacesService = {
  /**
   * Fetch address suggestions based on user input (New v1 API)
   */
  searchAddress: async (
    input: string,
    signal?: AbortSignal,
    coords?: { latitude: number, longitude: number },
  ): Promise<GooglePlaceSuggestion[]> => {
    if (!input || input.length < 2) return [];

    try {
      const url = `https://places.googleapis.com/v1/places:autocomplete`;

      const body: Record<string, unknown> = { input, sessionToken };
      // Biased toward the given point when there is one. Without one Google
      // biases by the phone's IP, which is better than any fixed default
      // (this used to fall back to the middle of India).
      if (coords) {
        body.locationBias = { circle: { center: { latitude: coords.latitude, longitude: coords.longitude }, radius: 50000 } };
      }
      // No type filter: Google takes at most 5 types and judges them on a
      // place's PRIMARY type only, which buried nearby stores ("McDonalds"
      // near Dallas suggested a bakery in another town) — callers that care
      // rank the results on `types` instead.

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        },
        body: JSON.stringify(body),
        signal
      });

      // A non-2xx response (a proxy/captive-portal page, a firewall block,
      // an API-level rejection with no JSON body) used to fall straight
      // into response.json() — either throwing an opaque "Unexpected
      // character" parse error, or silently parsing as valid-but-unrelated
      // JSON and reading as "no suggestions" with no error at all. Checking
      // status first surfaces the actual HTTP outcome instead of guessing
      // at it from whatever the body happened to contain. Google's own
      // error body (when present) carries the actual reason — e.g.
      // PERMISSION_DENIED (key/restriction/API-not-enabled) vs
      // RESOURCE_EXHAUSTED (quota) — which a bare status code can't tell
      // apart, so it's read out here rather than just reporting the status.
      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        // ErrorInfo.reason says WHY (API_KEY_IP_ADDRESS_BLOCKED,
        // API_KEY_ANDROID_APP_BLOCKED, SERVICE_DISABLED, BILLING_DISABLED…)
        // where status alone is just PERMISSION_DENIED for all of them.
        const reason = errJson?.error?.details?.find((d: any) => d?.reason)?.reason;
        const code = reason || errJson?.error?.status;
        const detail = code
          ? `${code}: ${errJson.error.message || ''}`.trim()
          : `${response.status} ${response.statusText}`;
        throw new Error(`Places API error — ${detail}`);
      }

      const json = await response.json();

      if (json.suggestions) {
        return json.suggestions.map((item: any) => {
          const prediction = item.placePrediction;
          return {
            description: prediction.text.text,
            place_id: prediction.placeId,
            types: prediction.types ?? [],
            structured_formatting: {
              main_text: prediction.structuredFormat.mainText.text,
              secondary_text: prediction.structuredFormat.secondaryText?.text || '',
              main_text_matched_substrings: prediction.structuredFormat.mainText.matchedSubstrings?.map((ms: any) => ({
                offset: ms.startOffset || 0,
                length: ms.length || 0
              }))
            }
          };
        });
      } else {
        if (json.error) {
          console.error('Google Places API Error (New):', json.error.status, json.error.message);
          throw new Error(json.error.message || json.error.status);
        }
        return [];
      }
    } catch (error: any) {
      if (error.name === 'AbortError') return [];
      console.error('Autocomplete Network/Fetch Error (New):', error);
      throw error;
    }
  },

  /**
   * Fetch specific coordinates and address components for a place (New v1 API)
   */
  getPlaceDetails: async (place_id: string): Promise<PlaceDetails> => {
    // Asked again once when the request itself fails (a dropped or slow
    // mobile connection, a brief Google 5xx) — a customer on weak signal
    // got "Could not fetch location details" for a place that was fine.
    // A real refusal from Google (key, quota, a bad place id) isn't retried.
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await fetchPlaceDetails(place_id);
      } catch (error: any) {
        lastError = error;
        if (!error?.retryable) break;
      }
    }
    console.error('Place Details Error (New):', lastError);
    throw lastError;
  },

};

/** One Place Details request (New v1 API). Errors carry Google's reason —
 * "Places API error — <REASON>: …", as the search's do — and say whether
 * asking again could help (`retryable`). */
async function fetchPlaceDetails(place_id: string): Promise<PlaceDetails> {
  // Fields must be specified for the New API.
  const fields = 'location,formattedAddress,addressComponents,primaryType,types';
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(place_id)}?fields=${fields}&key=${GOOGLE_PLACES_API_KEY}&sessionToken=${sessionToken}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error: any) {
    // No answer at all: the connection.
    throw Object.assign(new Error(`Places API error — NETWORK: ${error?.message ?? 'no response'}`), { retryable: true });
  }
  if (!response.ok) {
    const errJson = await response.json().catch(() => null);
    const reason = errJson?.error?.details?.find((d: any) => d?.reason)?.reason;
    const code = reason || errJson?.error?.status;
    const detail = code ? `${code}: ${errJson.error.message || ''}`.trim() : `${response.status} ${response.statusText}`;
    throw Object.assign(new Error(`Places API error — ${detail}`), { retryable: response.status >= 500 });
  }
  const json = await response.json();
  // A complete session (autocomplete then details): the next search starts a new one.
  sessionToken = Math.random().toString(36).substring(2, 15);

  if (!json.formattedAddress || !json.location) {
    throw Object.assign(new Error('Places API error — NO_LOCATION: this place has no address or point'), { retryable: false });
  }
  const details: PlaceDetails = {
    latitude: json.location.latitude,
    longitude: json.location.longitude,
    formatted_address: json.formattedAddress,
      primary_type: json.primaryType,
      types: json.types ?? [],
  };
  // v1 names the parts differently; a place may have none (an area, a landmark).
  (json.addressComponents ?? []).forEach((comp: any) => {
    if (comp.types?.includes('locality')) details.city = comp.longText;
    if (comp.types?.includes('administrative_area_level_1')) details.state = comp.longText;
    if (comp.types?.includes('postal_code')) details.pincode = comp.longText;
  });
  return details;
}
