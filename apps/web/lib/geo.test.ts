import { describe, expect, it } from "vitest";

import { type LngLat, polygonAreaSqm, sqmToSqft, suggestDiscom } from "./geo";

/** A rectangle of w × h metres at a given latitude, as lng/lat corners. */
function rect(lat: number, lng: number, w: number, h: number): LngLat[] {
  const dLat = h / 111_320;
  const dLng = w / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [
    [lng, lat],
    [lng + dLng, lat],
    [lng + dLng, lat + dLat],
    [lng, lat + dLat],
  ];
}

describe("polygonAreaSqm", () => {
  it("measures a 10 m × 20 m roof in Pune within 1%", () => {
    expect(polygonAreaSqm(rect(18.52, 73.86, 10, 20))).toBeGreaterThan(198);
    expect(polygonAreaSqm(rect(18.52, 73.86, 10, 20))).toBeLessThan(202);
  });
  it("does not depend on winding direction", () => {
    const r = rect(28.6, 77.2, 12, 8);
    expect(polygonAreaSqm([...r].reverse())).toBeCloseTo(polygonAreaSqm(r), 6);
  });
  it("is zero for fewer than three points", () => {
    expect(polygonAreaSqm([[73.8, 18.5], [73.9, 18.5]])).toBe(0);
  });
  it("converts to square feet", () => {
    expect(sqmToSqft(10)).toBeCloseTo(107.639, 3);
  });
});

describe("suggestDiscom", () => {
  it.each([
    ["Maharashtra", "Pune", "msedcl"],
    ["Maharashtra", "Nagpur", "msedcl"],
    ["Maharashtra", "Mumbai", null],
    ["Karnataka", "Bengaluru", "bescom"],
    ["Karnataka", "Mysuru", null],
    ["Delhi", "New Delhi", null],
    ["Tamil Nadu", "Chennai", "other"],
  ])("%s / %s → %s", (state, city, expected) => {
    expect(suggestDiscom(state, city)).toBe(expected);
  });
});
