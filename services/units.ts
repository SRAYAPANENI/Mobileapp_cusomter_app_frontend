// SkoFy launches in the US, where distances are expected in miles — the
// backend (PostGIS, distribution radius config, etc.) stays in km internally
// since that's what's already built and tested. These convert only at the
// UI boundary (display, and any user-facing input before sending to the API).
export const kmToMiles = (km: number): number => km * 0.621371;
export const milesToKm = (miles: number): number => miles / 0.621371;
