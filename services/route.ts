// The road from where the provider is to where they're going, for the live
// tracking maps (customer: app/track-provider.tsx; provider: their
// navigate-to-site.tsx has the same file). One place for:
//
//   - asking Google for the road: the Routes API first (the one Google offers
//     today), then the older Directions API. Only one needs to be allowed on
//     the key. A key refused for both isn't asked again for a couple of
//     minutes — every move used to ask again, and fail again. Not for the
//     rest of the session: an app left open while the API was switched on
//     (or still being switched on — Google takes a few minutes) never drew
//     a road until it was restarted.
//   - what's left of the trip at each location: along the road when there's
//     a road route; without one, the straight line × 1.3 (roads aren't
//     straight — the server's own estimate, app/domain/trip_fare.py
//     ROAD_FACTOR). Recomputed on every location, so distance and time go
//     down as the provider drives. A two-point "route" used to freeze them.
//   - one average speed for an estimate, the same as the server's.

export type LatLng = { latitude: number; longitude: number };

export interface Route {
  coords: LatLng[];
  /** Along the roads (true), or a straight-line estimate (false — never drawn: a map shows the road or no line). */
  road: boolean;
  distanceMi: number;
  durationMins: number;
  /** Google's own encoding of the road — what the provider's phone sends the
   * customer's, so both draw and measure the same road (fromEncoded). */
  encoded?: string;
}

/** Roads aren't straight: a straight line × this is close to the driving distance. */
export const ROAD_FACTOR = 1.3;
/** For an estimate without a road route — the server's too (JobService track_job). */
export const AVG_SPEED_KMH = 40;
const KM_PER_MILE = 1.609344;

/** Google said no to this key: not asked again until then. */
const REFUSED_PAUSE_MS = 2 * 60_000;
let refusedUntil = 0;

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = (b.latitude - a.latitude) * Math.PI / 180;
  const dLon = (b.longitude - a.longitude) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * Math.PI / 180) * Math.cos(b.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let shift = 0, result = 0, b: number;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

/** The straight line × ROAD_FACTOR, at AVG_SPEED_KMH. */
export function estimate(from: LatLng, to: LatLng): { distanceMi: number; durationMins: number } {
  const km = haversineKm(from, to) * ROAD_FACTOR;
  return { distanceMi: km / KM_PER_MILE, durationMins: Math.max(1, Math.round(km / AVG_SPEED_KMH * 60)) };
}

/** The stretch of road (coords[index] → coords[index + 1]) nearest `p`, and
 * how far `p` is from it. Flat-earth over a stretch this short is exact enough. */
export function nearestSegment(p: LatLng, coords: LatLng[]): { index: number; km: number } {
  const kx = 111.32 * Math.cos(p.latitude * Math.PI / 180);   // km per degree of longitude here
  const ky = 110.574;                                          // km per degree of latitude
  let index = 0;
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = (coords[i].longitude - p.longitude) * kx, ay = (coords[i].latitude - p.latitude) * ky;
    const bx = (coords[i + 1].longitude - p.longitude) * kx, by = (coords[i + 1].latitude - p.latitude) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) { best = d; index = i; }
  }
  return { index, km: best };
}

function lineKm(coords: LatLng[]): number {
  let km = 0;
  for (let i = 1; i < coords.length; i++) km += haversineKm(coords[i - 1], coords[i]);
  return km;
}

async function viaRoutesApi(origin: LatLng, dest: LatLng, key: string): Promise<Route | null> {
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
    },
    body: JSON.stringify({
      origin: { location: { latLng: origin } },
      destination: { location: { latLng: dest } },
      travelMode: 'DRIVE',
    }),
  });
  if (res.status === 403) return null;
  const json = await res.json();
  const r = json?.routes?.[0];
  const encoded = r?.polyline?.encodedPolyline;
  if (!encoded) return null;
  const seconds = parseInt(String(r.duration ?? '0'), 10) || 0;
  return { coords: decodePolyline(encoded), road: true, encoded, distanceMi: (r.distanceMeters ?? 0) / 1609.344, durationMins: Math.max(1, Math.ceil(seconds / 60)) };
}

async function viaDirectionsApi(origin: LatLng, dest: LatLng, key: string): Promise<Route | 'refused' | null> {
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.latitude},${origin.longitude}&destination=${dest.latitude},${dest.longitude}&mode=driving&key=${key}`;
  const json = await (await fetch(url)).json();
  if (json?.status === 'REQUEST_DENIED') return 'refused';
  const route = json?.routes?.[0];
  const encoded = route?.overview_polyline?.points;
  const leg = route?.legs?.[0];
  if (!encoded || !leg) return null;
  return { coords: decodePolyline(encoded), road: true, encoded, distanceMi: leg.distance.value / 1609.344, durationMins: Math.max(1, Math.ceil(leg.duration.value / 60)) };
}

/** The road from `origin` to `dest`, or the straight-line estimate when
 * there's no road route to be had (no key, refused, offline). */
export async function fetchRoute(origin: LatLng, dest: LatLng, key: string): Promise<Route> {
  if (key && Date.now() >= refusedUntil) {
    try {
      const routes = await viaRoutesApi(origin, dest, key);
      if (routes) return routes;
      const directions = await viaDirectionsApi(origin, dest, key);
      if (directions === 'refused') {
        refusedUntil = Date.now() + REFUSED_PAUSE_MS;
        console.warn('[route] Google refused this key for the Routes and Directions APIs — enable the Routes API on it '
          + '(Google Cloud Console → APIs & Services) for road routes. Showing an estimate; asking again in 2 minutes.');
      } else if (directions) {
        return directions;
      }
    } catch {
      // Offline or a blip: the estimate, and the next move asks again.
    }
  }
  return { coords: [origin, dest], road: false, ...estimate(origin, dest) };
}

export interface Progress { coords: LatLng[]; road: boolean; distanceMi: number; durationMins: number }

// When to ask Google again. Each ask is billed, so not on every move: what's
// left is worked out along the road we have (progress). Again only when
//   - they've left that road (a turn it didn't take) — further from it than
//     GPS wobble or the 50 m a marker is snapped to it on the customer's map,
//     having moved since the last ask, and not more than every so often (a
//     start in a car park, off the road, would otherwise ask on every fix);
//   - the road is a few minutes old (its time is refreshed);
//   - there's no road yet, after a while (a blip, or the first ask failing).
const OFF_ROUTE_KM = 0.075;
const MOVED_KM = 0.05;
const MIN_GAP_MS = 15_000;
const REFRESH_MS = 5 * 60_000;
const RETRY_MS = 30_000;

const keyOf = (p: LatLng) => `${p.latitude},${p.longitude}`;

/** Follows one trip as the start moves — the one place for when to ask
 * Google again, used by every live map. Each location gets what's left
 * (`progress`) at once; the road is asked for again only when it's due, and
 * its answer is shown from wherever they are by then. Guards that each
 * caller used to get wrong on its own:
 *   - an answer for an older destination (a delivery's pickup, once it's
 *     been collected) is dropped, never drawn toward the wrong stop;
 *   - a failed ask (offline for a moment) keeps the road already had,
 *     rather than replacing it with the estimate;
 *   - without a road yet, it asks again after a while even standing still
 *     — the first ask failing used to leave no road until they'd moved. */
export class RouteFollower {
  private route: Route | null = null;
  private here: LatLng | null = null;
  private destKey = '';
  private askedFrom: LatLng | null = null;
  private askedAt = 0;
  private seq = 0;

  constructor(private readonly key: string) {}

  /** The whole road being followed (empty without one) — to snap a marker to. */
  /** The road being followed, if there is one (for the provider to send). */
  get road(): Route | null {
    return this.route?.road ? this.route : null;
  }

  get roadCoords(): LatLng[] {
    return this.route?.road ? this.route.coords : [];
  }

  follow(here: LatLng, dest: LatLng, onUpdate: (left: Progress) => void): void {
    this.here = here;
    const destKey = keyOf(dest);
    if (destKey !== this.destKey) {
      this.destKey = destKey;
      this.route = null;
      this.askedFrom = null;
      this.seq += 1;   // an answer still on its way is for the old stop
    }
    onUpdate(progress(here, dest, this.route));

    if (!this.due(here)) return;
    this.askedFrom = here;
    this.askedAt = Date.now();
    const mine = ++this.seq;
    fetchRoute(here, dest, this.key).then((r) => {
      if (mine !== this.seq) return;                  // a newer ask, or a new stop
      if (r.road || !this.route?.road) this.route = r;
      onUpdate(progress(this.here ?? here, dest, this.route));
    });
  }

  private due(here: LatLng): boolean {
    if (!this.askedFrom) return true;
    const since = Date.now() - this.askedAt;
    const route = this.route;
    if (!route?.road) return since >= RETRY_MS;
    if (since >= REFRESH_MS) return true;
    return since >= MIN_GAP_MS
      && haversineKm(this.askedFrom, here) >= MOVED_KM
      && nearestSegment(here, route.coords).km > OFF_ROUTE_KM;
  }

  /** Stop: an answer still on its way is dropped (the screen has closed). */
  stop(): void {
    this.seq += 1;
  }
}

/** What's left of the trip from `here`: along the road route (trimmed to
 * start where the provider is), or the estimate without one. */
/** A road the other phone sent (its encoding and Google's time for it). */
export function fromEncoded(encoded: string, durationMins: number): Route | null {
  try {
    const coords = decodePolyline(encoded);
    if (coords.length < 2) return null;
    return { coords, road: true, encoded, distanceMi: lineKm(coords) / KM_PER_MILE, durationMins: Math.max(1, durationMins) };
  } catch {
    return null;   // a broken string: no road, not a crash
  }
}

export function progress(here: LatLng, dest: LatLng, route: Route | null): Progress {
  if (!route || !route.road || route.coords.length < 2) {
    return { coords: [here, dest], road: false, ...estimate(here, dest) };
  }
  // From the nearest stretch of road, not the nearest point on it: Google
  // leaves long straight roads with few points, and the nearest one is often
  // just ahead — skipping it cut the corner and came up short.
  const { index } = nearestSegment(here, route.coords);
  const coords = [here, ...route.coords.slice(index + 1)];
  const leftKm = lineKm(coords);
  const totalKm = Math.max(lineKm(route.coords), 0.001);
  // Google's time for the route, in proportion to what's left of it.
  const durationMins = Math.max(1, Math.round(route.durationMins * Math.min(leftKm / totalKm, 1)));
  return { coords, road: true, distanceMi: leftKm / KM_PER_MILE, durationMins };
}
