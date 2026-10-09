"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, Marker } from "maplibre-gl";
import { useEffect, useRef } from "react";

import type { LngLat } from "@/lib/geo";

/** MapLibre + OpenFreeMap (free, no key; attribution shown by the map). */
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const INDIA_CENTER: LngLat = [78.96, 22.59];

export interface RoofMapProps {
  pin: LngLat | null;
  onPinChange: (p: LngLat) => void;
  measuring: boolean;
  polygon: LngLat[];
  onPolygonChange: (points: LngLat[]) => void;
  onPolygonClose: () => void;
  label: string;
}

const POLY_SOURCE = "roof-polygon";

function polygonData(points: LngLat[], closed: boolean) {
  const ring = closed && points.length >= 3 ? [...points, points[0]!] : points;
  return {
    type: "FeatureCollection" as const,
    features: [
      ...(closed && points.length >= 3
        ? [{ type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [ring] } }]
        : []),
      { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: ring } },
      ...points.map((p) => ({ type: "Feature" as const, properties: { vertex: true }, geometry: { type: "Point" as const, coordinates: p } })),
    ],
  };
}

export function RoofMap({ pin, onPinChange, measuring, polygon, onPolygonChange, onPolygonClose, label }: RoofMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const state = useRef({ measuring, polygon, onPinChange, onPolygonChange, onPolygonClose });
  state.current = { measuring, polygon, onPinChange, onPolygonChange, onPolygonClose };

  // Create the map once (maplibre is loaded lazily so it stays out of other pages' bundles).
  useEffect(() => {
    let cancelled = false;
    void import("maplibre-gl").then((maplibre) => {
      if (cancelled || !container.current) return;
      // Served from public/ (see scripts/copy-maplibre-worker.mjs)
      maplibre.setWorkerUrl(`${window.location.origin}/maplibre/maplibre-gl-worker.mjs`);
      const m = new maplibre.Map({
        container: container.current,
        style: STYLE_URL,
        center: pin ?? INDIA_CENTER,
        zoom: pin ? 18 : 4,
        attributionControl: { compact: true },
        cooperativeGestures: true,
      });
      m.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      const el = document.createElement("div");
      el.className = "size-6 -translate-y-3 rounded-full border-[3px] border-[var(--parapet)] bg-[var(--cell)] shadow-sheet";
      marker.current = new maplibre.Marker({ element: el, draggable: true })
        .setLngLat(pin ?? INDIA_CENTER)
        .addTo(m);
      marker.current.on("dragend", () => {
        const { lng, lat } = marker.current!.getLngLat();
        state.current.onPinChange([lng, lat]);
      });
      m.on("load", () => {
        m.addSource(POLY_SOURCE, { type: "geojson", data: polygonData([], false) });
        m.addLayer({ id: "roof-fill", type: "fill", source: POLY_SOURCE, paint: { "fill-color": "#f3b21b", "fill-opacity": 0.35 } });
        m.addLayer({ id: "roof-line", type: "line", source: POLY_SOURCE, paint: { "line-color": "#18213d", "line-width": 2 } });
        m.addLayer({
          id: "roof-vertex",
          type: "circle",
          source: POLY_SOURCE,
          filter: ["==", ["get", "vertex"], true],
          paint: { "circle-radius": 5, "circle-color": "#ffffff", "circle-stroke-color": "#18213d", "circle-stroke-width": 2 },
        });
      });
      m.on("click", (e: MapMouseEvent) => {
        const p: LngLat = [e.lngLat.lng, e.lngLat.lat];
        const s = state.current;
        if (!s.measuring) {
          marker.current?.setLngLat(p);
          s.onPinChange(p);
          return;
        }
        // Tapping near the first corner closes the shape
        if (s.polygon.length >= 3) {
          const first = m.project(s.polygon[0]!);
          if (Math.hypot(first.x - e.point.x, first.y - e.point.y) < 18) {
            s.onPolygonClose();
            return;
          }
        }
        s.onPolygonChange([...s.polygon, p]);
      });
      map.current = m;
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- create once; updates handled below
  }, []);

  // Follow the pin when it changes from outside (search, geolocation)
  useEffect(() => {
    if (!pin || !map.current || !marker.current) return;
    const cur = marker.current.getLngLat();
    if (Math.abs(cur.lng - pin[0]) > 1e-7 || Math.abs(cur.lat - pin[1]) > 1e-7) {
      marker.current.setLngLat(pin);
      map.current.flyTo({ center: pin, zoom: Math.max(map.current.getZoom(), 17), essential: true });
    }
  }, [pin]);

  // Draw the polygon
  useEffect(() => {
    const src = map.current?.getSource(POLY_SOURCE) as GeoJSONSource | undefined;
    src?.setData(polygonData(polygon, !measuring));
    if (map.current) map.current.getCanvas().style.cursor = measuring ? "crosshair" : "";
  }, [polygon, measuring]);

  return (
    <div
      ref={container}
      role="application"
      aria-label={label}
      className="h-72 w-full overflow-hidden rounded-panel border border-concrete bg-concrete/40 sm:h-96"
    />
  );
}
