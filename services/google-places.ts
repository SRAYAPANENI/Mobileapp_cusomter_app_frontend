import Constants from 'expo-constants';

/**
 * Google Places API Integration Service (New v1 API)
 * Uses the API key from app.json
 */

export const GOOGLE_PLACES_API_KEY = Constants.expoConfig?.android?.config?.googleMaps?.apiKey || 'AIzaSyC9GCq5AcsfOek3gTzAJHe1105SryMJc8Q';

export interface GooglePlaceSuggestion {
  description: string;
  place_id: string;
  distance?: string;
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
    // Restricts suggestions to specific Google Places primary types — used
    // by pickup/dropoff job posting to only surface business-type pickup
    // points (grocery, pharmacy, etc.), not arbitrary/residential addresses.
    // This is a UX-level hint, not the actual security gate — the backend
    // independently validates the selected place's type against its own
    // allowlist (settings.PICKUP_ALLOWED_PLACE_TYPES) before accepting it.
    includedPrimaryTypes?: string[],
  ): Promise<GooglePlaceSuggestion[]> => {
    if (!input || input.length < 2) return [];

    try {
      const url = `https://places.googleapis.com/v1/places:autocomplete`;

      // Default to central India center if no coords provided for bias
      const latitude = coords?.latitude || 20.5937;
      const longitude = coords?.longitude || 78.9629;

      const body: Record<string, unknown> = {
        input,
        locationBias: {
          circle: {
            center: { latitude, longitude },
            radius: 50000 // 50km radius bias
          }
        },
        sessionToken
      };
      if (includedPrimaryTypes?.length) {
        // Google's Autocomplete (New) API hard-caps this at 5 values and
        // 400s the whole request otherwise (INVALID_ARGUMENT) — confirmed
        // live against the API. settings.PICKUP_ALLOWED_PLACE_TYPES has 11
        // entries, so every pickup search was silently failing and landing
        // on the caller's empty-suggestions catch block. This is a UX-only
        // hint (the backend re-validates the full allowlist independently),
        // so truncating here is safe — it just narrows autocomplete, not the
        // actual gate.
        body.includedPrimaryTypes = includedPrimaryTypes.slice(0, 5);
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        },
        body: JSON.stringify(body),
        signal
      });

      const json = await response.json();

      if (json.suggestions) {
        return json.suggestions.map((item: any) => {
          const prediction = item.placePrediction;
          return {
            description: prediction.text.text,
            place_id: prediction.placeId,
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
    try {
      // Fields must be specified for the New API
      const fields = 'location,formattedAddress,addressComponents,primaryType';
      const url = `https://places.googleapis.com/v1/places/${place_id}?fields=${fields}&key=${GOOGLE_PLACES_API_KEY}&sessionToken=${sessionToken}`;

      const response = await fetch(url);
      const json = await response.json();

      // Reset session token after a complete "Session"
      sessionToken = Math.random().toString(36).substring(2, 15);

      if (json.formattedAddress) {
        const details: PlaceDetails = {
          latitude: json.location.latitude,
          longitude: json.location.longitude,
          formatted_address: json.formattedAddress,
          primary_type: json.primaryType,
        };

        // Extract specific components (v1 uses different names)
        json.addressComponents.forEach((comp: any) => {
          if (comp.types.includes('locality')) details.city = comp.longText;
          if (comp.types.includes('administrative_area_level_1')) details.state = comp.longText;
          if (comp.types.includes('postal_code')) details.pincode = comp.longText;
        });

        return details;
      } else {
        if (json.error) {
          console.error('Place Details Error (New):', json.error.status, json.error.message);
          throw new Error(json.error.message || json.error.status);
        }
        throw new Error('Could not fetch place details');
      }
    } catch (error) {
      console.error('Place Details Error (New):', error);
      throw error;
    }
  }
};
