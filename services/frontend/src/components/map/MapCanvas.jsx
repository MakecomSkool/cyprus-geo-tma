/**
 * src/components/map/MapCanvas.jsx
 *
 * Core Mapbox GL map canvas with MVT vector tiles + multi-style support.
 *
 * Places are loaded as MVT from /api/tiles/{z}/{x}/{y}.mvt (PostGIS on-the-fly).
 * Falls back to static GeoJSON if backend is unavailable.
 *
 * Base styles: OSM (raster), Satellite, Hybrid, Dark.
 * On every style change, data layers are re-applied via 'style.load'.
 */

import { useRef, useEffect } from "react";
import mapboxgl from "mapbox-gl";
import useMapStore from "../../store/useMapStore";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const API_BASE = import.meta.env.VITE_API_URL || "";

const CYPRUS_CENTER = [33.43, 35.13];
const CYPRUS_ZOOM = 9;
// Bounding box: SW corner → NE corner (all of Cyprus incl. Northern)
const CYPRUS_BOUNDS = [[32.20, 34.50], [34.65, 35.75]];

// ── Wikimapia-style colors ──────────────────────────────────
const FILL_DEFAULT = "rgba(255, 140, 0, 0.10)";
const FILL_HOVER   = "rgba(255, 140, 0, 0.30)";
const FILL_ACTIVE  = "rgba(255, 140, 0, 0.45)";
const LINE_DEFAULT = "rgba(200, 100, 0, 0.55)";
const LINE_HOVER   = "rgba(200, 100, 0, 0.85)";
const LINE_ACTIVE  = "rgba(220, 80, 0, 1)";
const LIVE_COLOR   = "#FF2D55";

// MVT source layer name (must match ST_AsMVT layer name in tiles.js)
const MVT_LAYER = "places";

// ── Style definitions ───────────────────────────────────────
const OSM_STYLE = {
  version: 8,
  name: "OSM",
  sources: {
    "osm-tiles": {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: '© <a href="https://www.openstreetmap.org/">OpenStreetMap</a>',
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "osm-tiles-layer",
      type: "raster",
      source: "osm-tiles",
      minzoom: 0,
      maxzoom: 19,
    },
  ],
  glyphs: "mapbox://fonts/mapbox/{fontstack}/{range}.pbf",
};

const MAPBOX_STYLES = {
  osm: OSM_STYLE,
  satellite: "mapbox://styles/mapbox/satellite-v9",
  hybrid: "mapbox://styles/mapbox/satellite-streets-v12",
  dark: "mapbox://styles/mapbox/dark-v11",
};

// ── Feature state helper (includes sourceLayer for MVT) ─────
const FS = (id) => ({ source: "places", sourceLayer: MVT_LAYER, id });

// ── Helper: add all data layers to map ──────────────────────
function addDataLayers(map) {
  // ── Places source: MVT vector tiles from PostGIS ──────────
  if (!map.getSource("places")) {
    map.addSource("places", {
      type: "vector",
      tiles: [`${API_BASE}/api/tiles/{z}/{x}/{y}.mvt`],
      minzoom: 8,
      maxzoom: 16,
      promoteId: "wikimapia_id",
    });
  }

  // ── FILL layer ────────────────────────────────────────────
  if (!map.getLayer("places-fill")) {
    map.addLayer({
      id: "places-fill",
      type: "fill",
      source: "places",
      "source-layer": MVT_LAYER,
      paint: {
        "fill-color": [
          "case",
          ["boolean", ["feature-state", "active"], false], FILL_ACTIVE,
          ["boolean", ["feature-state", "hover"], false], FILL_HOVER,
          FILL_DEFAULT,
        ],
        "fill-opacity": [
          "interpolate", ["linear"], ["zoom"],
          7, 0.3, 10, 0.7, 14, 0.9,
        ],
      },
    });
  }

  // ── OUTLINE layer ─────────────────────────────────────────
  if (!map.getLayer("places-line")) {
    map.addLayer({
      id: "places-line",
      type: "line",
      source: "places",
      "source-layer": MVT_LAYER,
      paint: {
        "line-color": [
          "case",
          ["boolean", ["feature-state", "active"], false], LINE_ACTIVE,
          ["boolean", ["feature-state", "hover"], false], LINE_HOVER,
          LINE_DEFAULT,
        ],
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          7, 0.3, 10, 0.8, 14, 1.5, 18, 2.5,
        ],
        "line-dasharray": [4, 2],
      },
    });
  }

  // ── NAME LABELS ───────────────────────────────────────────
  if (!map.getLayer("places-labels")) {
    map.addLayer({
      id: "places-labels",
      type: "symbol",
      source: "places",
      "source-layer": MVT_LAYER,
      minzoom: 13,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
        "text-size": [
          "interpolate", ["linear"], ["zoom"],
          13, 10, 15, 12, 18, 14,
        ],
        "text-max-width": 8,
        "text-allow-overlap": false,
        "text-ignore-placement": false,
        "text-optional": true,
        "text-padding": 4,
        "symbol-placement": "point",
      },
      paint: {
        "text-color": "rgba(80, 40, 0, 0.9)",
        "text-halo-color": "rgba(255, 255, 255, 0.95)",
        "text-halo-width": 1.5,
        "text-halo-blur": 0.5,
      },
    });
  }

  // ── LIVE PULSE source (GeoJSON — always separate from MVT) ─
  if (!map.getSource("live-places")) {
    map.addSource("live-places", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }

  if (!map.getLayer("live-pulse-outer")) {
    map.addLayer({
      id: "live-pulse-outer",
      type: "circle",
      source: "live-places",
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["get", "count"],
          1, 16, 5, 24, 10, 32,
        ],
        "circle-color": LIVE_COLOR,
        "circle-opacity": 0.15,
        "circle-blur": 1,
      },
    });
  }

  if (!map.getLayer("live-pulse-inner")) {
    map.addLayer({
      id: "live-pulse-inner",
      type: "circle",
      source: "live-places",
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["get", "count"],
          1, 6, 5, 9, 10, 12,
        ],
        "circle-color": LIVE_COLOR,
        "circle-opacity": 0.7,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });
  }

  if (!map.getLayer("live-badge")) {
    map.addLayer({
      id: "live-badge",
      type: "symbol",
      source: "live-places",
      layout: {
        "text-field": ["concat", "👥 ", ["to-string", ["get", "count"]]],
        "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
        "text-size": 11,
        "text-offset": [0, -2],
        "text-anchor": "bottom",
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": LIVE_COLOR,
        "text-halo-color": "#fff",
        "text-halo-width": 1.5,
      },
    });
  }
}

export default function MapCanvas({ onPlaceClick }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const hoveredIdRef = useRef(null);
  const dataLoadedRef = useRef(false);
  const onPlaceClickRef = useRef(onPlaceClick);
  onPlaceClickRef.current = onPlaceClick;

  const subscribeLive = useMapStore((s) => s.subscribeLive);
  const livePlaces = useMapStore((s) => s.livePlaces);
  const selectedPlace = useMapStore((s) => s.selectedPlace);
  const currentStyle = useMapStore((s) => s.currentStyle);

  // ── Initialize map ────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const initStyle = MAPBOX_STYLES[
      useMapStore.getState().currentStyle
    ] || OSM_STYLE;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: initStyle,
      center: CYPRUS_CENTER,
      zoom: CYPRUS_ZOOM,
      attributionControl: false,
      maxZoom: 19,
      minZoom: 8,
      maxBounds: CYPRUS_BOUNDS,
      renderWorldCopies: false,
      pitchWithRotate: false,
      dragRotate: false,
    });

    // ── style.load: add data layers (init + style change) ───
    map.on("style.load", () => {
      addDataLayers(map);
      dataLoadedRef.current = true;

      const b = map.getBounds();
      subscribeLive([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    });

    // ── moveend ─────────────────────────────────────────────
    map.on("moveend", () => {
      const b = map.getBounds();
      subscribeLive([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    });

    // ── HOVER (feature-state with sourceLayer) ──────────────
    map.on("mousemove", "places-fill", (e) => {
      if (!e.features?.length) return;
      map.getCanvas().style.cursor = "pointer";
      const fid = e.features[0].id;

      if (hoveredIdRef.current !== null && hoveredIdRef.current !== fid) {
        map.setFeatureState(FS(hoveredIdRef.current), { hover: false });
      }
      hoveredIdRef.current = fid;
      map.setFeatureState(FS(fid), { hover: true });
    });

    map.on("mouseleave", "places-fill", () => {
      map.getCanvas().style.cursor = "";
      if (hoveredIdRef.current !== null) {
        map.setFeatureState(FS(hoveredIdRef.current), { hover: false });
        hoveredIdRef.current = null;
      }
    });

    // ── CLICK ───────────────────────────────────────────────
    map.on("click", "places-fill", (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const props = feature.properties;
      onPlaceClickRef.current?.(props.wikimapia_id || feature.id, {
        id: props.wikimapia_id || feature.id,
        name: props.name,
        description: props.description,
        category: props.category,
        wikimapia_id: props.wikimapia_id,
      });
    });

    // ── Tooltip ─────────────────────────────────────────────
    const popup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 8,
      className: "place-tooltip",
    });

    map.on("mousemove", "places-fill", (e) => {
      if (!e.features?.length) return;
      const props = e.features[0].properties;
      popup
        .setLngLat(e.lngLat)
        .setHTML(`<strong>${props.name || "—"}</strong>`)
        .addTo(map);
    });

    map.on("mouseleave", "places-fill", () => {
      popup.remove();
    });

    mapRef.current = map;
    window.__mapRef = map;

    return () => {
      popup.remove();
      map.remove();
      mapRef.current = null;
      delete window.__mapRef;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Switch style when currentStyle changes ────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const newStyle = MAPBOX_STYLES[currentStyle] || OSM_STYLE;
    map.setStyle(newStyle, { diff: false });
  }, [currentStyle]);

  // ── Category filter on MVT layers ─────────────────────────
  const category = useMapStore((s) => s.category);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !dataLoadedRef.current) return;

    const filter = category
      ? ["==", ["get", "category"], category]
      : null; // null = show all

    const layers = ["places-fill", "places-line", "places-labels"];
    for (const layerId of layers) {
      if (map.getLayer(layerId)) {
        map.setFilter(layerId, filter);
      }
    }
  }, [category]);

  // ── Update live pulse data ────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !dataLoadedRef.current) return;
    const source = map.getSource("live-places");
    if (!source) return;

    const features = [];
    for (const [placeId, count] of Object.entries(livePlaces)) {
      if (count <= 0) continue;

      // Query rendered MVT features to get centroid for pulse
      const rendered = map.querySourceFeatures("places", {
        sourceLayer: MVT_LAYER,
        filter: ["==", ["get", "wikimapia_id"], Number(placeId)],
      });

      if (rendered.length > 0) {
        const geom = rendered[0].geometry;
        let center;
        if (geom.type === "Point") {
          center = geom.coordinates;
        } else if (geom.coordinates?.[0]) {
          const coords = geom.coordinates[0];
          const lons = coords.map((c) => c[0]);
          const lats = coords.map((c) => c[1]);
          center = [
            (Math.min(...lons) + Math.max(...lons)) / 2,
            (Math.min(...lats) + Math.max(...lats)) / 2,
          ];
        }
        if (center) {
          features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: center },
            properties: { placeId, count },
          });
        }
      }
    }
    source.setData({ type: "FeatureCollection", features });
  }, [livePlaces]);

  // ── Active state for selected place ───────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !dataLoadedRef.current) return;

    if (selectedPlace?.wikimapia_id) {
      map.setFeatureState(FS(selectedPlace.wikimapia_id), { active: true });
    }
    return () => {
      if (selectedPlace?.wikimapia_id) {
        try {
          map.setFeatureState(FS(selectedPlace.wikimapia_id), { active: false });
        } catch { /* style may have changed */ }
      }
    };
  }, [selectedPlace]);

  // ── Expose flyTo ──────────────────────────────────────────
  useEffect(() => {
    window.__mapFlyTo = (center, zoom = 16) => {
      mapRef.current?.flyTo({ center, zoom, duration: 800 });
    };
    return () => { delete window.__mapFlyTo; };
  }, []);

  return <div ref={containerRef} className="map-container" />;
}
