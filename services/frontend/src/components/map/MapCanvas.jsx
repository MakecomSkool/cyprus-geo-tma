/**
 * src/components/map/MapCanvas.jsx
 *
 * Leaflet map — Wikimapia-like behaviour:
 *  • Click on map → find ALL polygons at that point
 *  • If 1 polygon → open place sheet directly
 *  • If many → show picker popup (like Wikimapia does)
 *  • Hover → highlight polygon + tooltip
 */

import { useRef, useEffect } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import useMapStore from "../../store/useMapStore";

const API_BASE = import.meta.env.VITE_API_URL || "";

const CYPRUS_CENTER = [35.13, 33.43];
const CYPRUS_ZOOM   = 10;
const CYPRUS_BOUNDS = L.latLngBounds(
  L.latLng(34.50, 32.20),
  L.latLng(35.75, 34.65)
);

// ── Styles — precise Wikimapia color palette ─────────────────────────────
// DEFAULT: fillOpacity=0 (transparent) — only border visible
// HOVER:   fillOpacity=0.45 — fill appears on mouseover
// ACTIVE:  fillOpacity=0.50 + orange border
const CAT_STYLE = {
  wikimapia:  { color: "#9e948a", weight: 1, fillColor: "#dfd6cb", fillOpacity: 0 },
  park:       { color: "#6aaa50", weight: 1, fillColor: "#c0e8a8", fillOpacity: 0 },
  beach:      { color: "#5090c8", weight: 1, fillColor: "#b0d8f4", fillOpacity: 0 },
  hotel:      { color: "#c09030", weight: 1, fillColor: "#f0d898", fillOpacity: 0 },
  food:       { color: "#c07030", weight: 1, fillColor: "#f0c090", fillOpacity: 0 },
  religious:  { color: "#9060b8", weight: 1, fillColor: "#e0c8f0", fillOpacity: 0 },
  education:  { color: "#4060b0", weight: 1, fillColor: "#c0d0f0", fillOpacity: 0 },
  healthcare: { color: "#b83050", weight: 1, fillColor: "#f0b8c8", fillOpacity: 0 },
  shopping:   { color: "#a08820", weight: 1, fillColor: "#f0e098", fillOpacity: 0 },
  district:   { color: "#7090b8", weight: 1.5, fillColor: "#c8d8f0", fillOpacity: 0,
                dashArray: "8,5" },
  sport:      { color: "#309878", weight: 1, fillColor: "#a0e0c8", fillOpacity: 0 },
  parking:    { color: "#7880a0", weight: 1, fillColor: "#c8d0e0", fillOpacity: 0 },
  transport:  { color: "#4870b8", weight: 1, fillColor: "#b0c8f0", fillOpacity: 0 },
  military:   { color: "#904030", weight: 1, fillColor: "#f0c8c0", fillOpacity: 0,
                dashArray: "5,5" },
  road:       { color: "#a09030", weight: 1, fillColor: "#f0e0a0", fillOpacity: 0 },
};

const DEFAULT_STYLE = CAT_STYLE.wikimapia;

// Hover: fill appears with the category color (Wikimapia behaviour)
function hoverStyle(base) {
  return { ...base, fillOpacity: 0.45, weight: 2 };
}

// Selected: orange border + fill stays visible
const ACTIVE_STYLE = { color: "#e08000", weight: 3, fillColor: "#ffd060", fillOpacity: 0.50 };

// Category icons for picker
const CAT_ICON = {
  park: "🌳", beach: "🏖️", hotel: "🏨", food: "🍴",
  religious: "⛪", education: "🎓", healthcare: "🏥", shopping: "🛍️",
  district: "🗺️", sport: "⚽", parking: "🅿️", transport: "🚌",
  military: "🪖", road: "🛣️", wikimapia: "📍",
};

function getStyle(feature) {
  return CAT_STYLE[feature.properties?.category] || DEFAULT_STYLE;
}

// Check if latlng is inside a GeoJSON polygon feature
function pointInFeature(latlng, feature) {
  if (!feature.geometry) return false;
  const pt = [latlng.lng, latlng.lat];
  const geom = feature.geometry;
  const rings = geom.type === "Polygon"
    ? geom.coordinates
    : geom.type === "MultiPolygon"
      ? geom.coordinates.flat()
      : [];
  for (const ring of rings) {
    if (pointInRing(pt, ring)) return true;
  }
  return false;
}

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > pt[1]) !== (yj > pt[1]))
      && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ── Component ─────────────────────────────────────────────────────────────
export default function MapCanvas({ onPlaceClick }) {
  const containerRef    = useRef(null);
  const mapRef          = useRef(null);
  const geoLayerRef     = useRef(null);
  const featuresRef     = useRef([]);   // all loaded features for point-in-polygon
  const activeLayerRef  = useRef(null);
  const pickerPopupRef  = useRef(null);
  const loadAbortRef    = useRef(null);
  const onPlaceClickRef = useRef(onPlaceClick);
  onPlaceClickRef.current = onPlaceClick;

  const subscribeLive = useMapStore((s) => s.subscribeLive);
  const selectedPlace = useMapStore((s) => s.selectedPlace);
  const category      = useMapStore((s) => s.category);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: CYPRUS_CENTER,
      zoom:   CYPRUS_ZOOM,
      minZoom: 8,
      maxZoom: 19,
      maxBounds: CYPRUS_BOUNDS,
      maxBoundsViscosity: 1.0,
      zoomControl: false,
    });

    // OSM Humanitarian — beige/clean like Wikimapia
    L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/">OSM</a>',
      maxZoom: 19,
    }).addTo(map);

    // ── Single GeoJSON layer — all polygons visible ─────────────────────
    const geoLayer = L.geoJSON(null, {
      style: getStyle,

      onEachFeature(feature, layer) {
        const props = feature.properties || {};

        // Hover highlight + tooltip
        layer.on("mouseover", function () {
          if (activeLayerRef.current !== this) {
            const base = getStyle(feature);
            this.setStyle(hoverStyle(base));
          }
          const name = props.name;
          if (name) {
            this.bindTooltip(name, {
              sticky: true, direction: "top", offset: [0, -6],
              className: "place-tooltip-leaflet",
            }).openTooltip();
          }
        });

        layer.on("mouseout", function () {
          if (activeLayerRef.current !== this) geoLayer.resetStyle(this);
          this.unbindTooltip();
        });
      },
    }).addTo(map);

    geoLayerRef.current = geoLayer;

    // ── Map click → find ALL polygons at that point (Wikimapia behaviour) ─
    map.on("click", (e) => {
      // Close any open picker
      if (pickerPopupRef.current) {
        pickerPopupRef.current.remove();
        pickerPopupRef.current = null;
      }

      // Find all features containing the clicked point
      const hits = featuresRef.current.filter(f => pointInFeature(e.latlng, f));
      if (hits.length === 0) return;

      // Sort: smallest area first (most specific = most relevant)
      hits.sort((a, b) => {
        const area = (f) => {
          try {
            const coords = f.geometry.type === "Polygon"
              ? f.geometry.coordinates[0]
              : f.geometry.coordinates[0][0];
            // Rough bounding box area
            const lons = coords.map(c => c[0]);
            const lats = coords.map(c => c[1]);
            return (Math.max(...lons) - Math.min(...lons)) *
                   (Math.max(...lats) - Math.min(...lats));
          } catch { return 999; }
        };
        return area(a) - area(b);
      });

      if (hits.length === 1) {
        // Only one match — open directly
        openPlace(hits[0], geoLayer, e.latlng);
      } else {
        // Multiple matches — show Wikimapia-style picker
        showPicker(hits, geoLayer, e.latlng, map);
      }
    });

    // ── Helper: open a place ─────────────────────────────────────────────
    function openPlace(feature, gl, latlng) {
      const props = feature.properties;

      // Highlight on map
      if (activeLayerRef.current) {
        try { gl.resetStyle(activeLayerRef.current); } catch {}
      }

      // Find the Leaflet layer for this feature
      gl.eachLayer(layer => {
        if (layer.feature?.properties?.wikimapia_id === props.wikimapia_id) {
          activeLayerRef.current = layer;
          layer.setStyle(ACTIVE_STYLE);
          layer.bringToFront();
        }
      });

      onPlaceClickRef.current?.(props.wikimapia_id, {
        id:           props.wikimapia_id,
        name:         props.name,
        description:  props.description,
        category:     props.category,
        wikimapia_id: props.wikimapia_id,
      });
    }

    // ── Helper: show picker popup ─────────────────────────────────────────
    function showPicker(hits, gl, latlng, map) {
      const items = hits.slice(0, 8).map(f => {
        const p = f.properties;
        const icon = CAT_ICON[p.category] || "📍";
        return `<div class="wm-picker-item" data-wid="${p.wikimapia_id}">
          <span class="wm-picker-icon">${icon}</span>
          <span class="wm-picker-name">${p.name || `#${p.wikimapia_id}`}</span>
        </div>`;
      }).join("");

      const popup = L.popup({
        closeButton: true,
        className: "wm-picker-popup",
        maxWidth: 260,
        minWidth: 180,
      })
        .setLatLng(latlng)
        .setContent(`<div class="wm-picker">${items}</div>`)
        .addTo(map);

      pickerPopupRef.current = popup;

      // Attach click handlers after popup renders
      setTimeout(() => {
        const el = popup.getElement();
        if (!el) return;
        el.querySelectorAll(".wm-picker-item").forEach((div, idx) => {
          div.addEventListener("click", () => {
            popup.remove();
            pickerPopupRef.current = null;
            openPlace(hits[idx], gl, latlng);
          });
        });
      }, 50);
    }

    // ── Load polygons for viewport — zoom-aware like Wikimapia ─────────────
    async function loadPolygons() {
      const z = map.getZoom();

      if (z < 11) {
        geoLayer.clearLayers();
        featuresRef.current = [];
        return;
      }

      const b = map.getBounds();
      const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;

      if (loadAbortRef.current) loadAbortRef.current.abort();
      const ctrl = new AbortController();
      loadAbortRef.current = ctrl;

      try {
        const cat = useMapStore.getState().category;
        const catParam = cat ? `&category=${cat}` : "";
        const resp = await fetch(
          `${API_BASE}/api/places/geojson?bbox=${bbox}${catParam}&zoom=${Math.floor(z)}`,
          { signal: ctrl.signal }
        );
        if (!resp.ok) return;
        const data = await resp.json();

        // ── Zoom-based visibility (Wikimapia rules) ──────────────────────
        // minZoom per area: larger = visible earlier
        const visible = data.features.filter(f => {
          const area  = f.properties.area_m2 || 0;
          const cat   = f.properties.category || "wikimapia";

          // Districts: only show at z11-14, hide when zoomed in close
          if (cat === "district") return z >= 11 && z <= 14;

          // Large areas (parks, beaches, military) — visible from z11
          if (area > 80_000)  return z >= 11;
          // Medium (campus, shopping mall) — from z12
          if (area > 15_000)  return z >= 12;
          // City objects (hotel, school, church) — from z13
          if (area > 3_000)   return z >= 13;
          // Small objects (restaurant, shop) — from z14
          if (area > 500)     return z >= 14;
          // Tiny objects (ATM, kiosk) — only close up
          return z >= 15;
        });

        // Sort: large → bottom, small → top (so small are clickable)
        visible.sort((a, b) => (b.properties.area_m2 || 0) - (a.properties.area_m2 || 0));

        geoLayer.clearLayers();
        geoLayer.addData({ type: "FeatureCollection", features: visible });
        featuresRef.current = visible;
      } catch (e) {
        if (e.name !== "AbortError") console.warn("GeoJSON load:", e);
      }
    }

    map.on("moveend", loadPolygons);
    map.on("zoomend", loadPolygons);
    loadPolygons();

    map.on("moveend", () => {
      const b = map.getBounds();
      subscribeLive([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    });
    const b0 = map.getBounds();
    subscribeLive([b0.getWest(), b0.getSouth(), b0.getEast(), b0.getNorth()]);

    mapRef.current = map;
    window.__mapRef = map;

    return () => { map.remove(); mapRef.current = null; delete window.__mapRef; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Category filter
  useEffect(() => {
    mapRef.current?.fire("moveend");
  }, [category]);

  // Highlight selected place from outside
  useEffect(() => {
    const gl = geoLayerRef.current;
    if (!gl || !selectedPlace?.wikimapia_id) return;
    gl.eachLayer(layer => {
      if (layer.feature?.properties?.wikimapia_id === selectedPlace.wikimapia_id) {
        if (activeLayerRef.current && activeLayerRef.current !== layer)
          try { gl.resetStyle(activeLayerRef.current); } catch {}
        activeLayerRef.current = layer;
        layer.setStyle(ACTIVE_STYLE);
        layer.bringToFront();
      }
    });
  }, [selectedPlace]);

  // flyTo helper
  useEffect(() => {
    window.__mapFlyTo = (c, z = 16) =>
      mapRef.current?.flyTo([c[1], c[0]], z, { duration: 0.8 });
    return () => { delete window.__mapFlyTo; };
  }, []);

  return <div ref={containerRef} className="map-container" />;
}
