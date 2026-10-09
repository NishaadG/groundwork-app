/** Map helpers for onboarding: roof area, DISCOM suggestion, place search. */

export type LngLat = [number, number];

const EARTH_RADIUS_M = 6_378_137;
export const SQFT_PER_SQM = 10.7639;

/**
 * Area of a small polygon on the Earth's surface (spherical excess, the same
 * method as turf/area). Accurate to well under 1% for roof-sized shapes.
 */
export function polygonAreaSqm(points: LngLat[]): number {
  if (points.length < 3) return 0;
  const rad = (d: number) => (d * Math.PI) / 180;
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const [lng1, lat1] = points[i]!;
    const [lng2, lat2] = points[(i + 1) % points.length]!;
    total += rad(lng2 - lng1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

export const sqmToSqft = (sqm: number) => sqm * SQFT_PER_SQM;

/**
 * Suggest a DISCOM from the place. Mumbai suburbs are served by Adani or Tata Power,
 * island city by BEST (not yet supported); elsewhere in Maharashtra it's MSEDCL.
 * The user always confirms or changes the suggestion.
 */
export function suggestDiscom(state: string | null | undefined, city: string | null | undefined): string | null {
  const s = (state ?? "").toLowerCase();
  const c = (city ?? "").toLowerCase();
  if (s.includes("maharashtra")) {
    if (/mumbai|thane/.test(c)) return null; // several companies serve Mumbai: ask
    return "msedcl";
  }
  if (s.includes("karnataka") && /bengaluru|bangalore/.test(c)) return "bescom";
  if (s.includes("karnataka")) return null;
  if (s.includes("delhi")) return null; // BRPL, BYPL or TPDDL depending on area: ask
  return "other";
}

export interface Place {
  label: string;
  city: string | null;
  state: string | null;
  lat: number;
  lng: number;
}

const NOMINATIM = "https://nominatim.openstreetmap.org";

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  address?: Record<string, string>;
}

function toPlace(r: NominatimResult): Place {
  const a = r.address ?? {};
  return {
    label: r.display_name,
    city: a.city ?? a.town ?? a.village ?? a.suburb ?? a.county ?? null,
    state: a.state ?? null,
    lat: Number(r.lat),
    lng: Number(r.lon),
  };
}

/**
 * One search per explicit user action (Nominatim usage policy: no autocomplete
 * from the client). Results limited to India.
 */
export async function searchPlaces(query: string, lang: string, signal?: AbortSignal): Promise<Place[]> {
  const url = new URL(`${NOMINATIM}/search`);
  url.search = new URLSearchParams({
    q: query,
    format: "jsonv2",
    addressdetails: "1",
    countrycodes: "in",
    limit: "5",
    "accept-language": lang,
  }).toString();
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`search failed: ${res.status}`);
  return ((await res.json()) as NominatimResult[]).map(toPlace);
}

export async function reversePlace(lat: number, lng: number, lang: string, signal?: AbortSignal): Promise<Place | null> {
  const url = new URL(`${NOMINATIM}/reverse`);
  url.search = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    format: "jsonv2",
    addressdetails: "1",
    zoom: "14",
    "accept-language": lang,
  }).toString();
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const body = (await res.json()) as NominatimResult & { error?: string };
  return body.error ? null : toPlace(body);
}
