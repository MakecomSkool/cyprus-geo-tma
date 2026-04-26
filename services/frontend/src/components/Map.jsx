/**
 * src/components/Map.jsx — Mapbox GL JS map with polygon layer.
 *
 * - Centered on Cyprus
 * - Loads places from API on moveend
 * - Hover/active polygon styles
 * - Click to select a place → opens BottomSheet
 */

import { useRef, useEffect, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import useMapStore from "../store/useMapStore";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

// Cyprus center & bounds
const CYPRUS_CENTER = [33.43, 35.13];
const CYPRUS_ZOOM = 9;

const FILL_COLOR = "rgba(36, 129, 204, 0.25)";
const FILL_COLOR_HOVER = "rgba(36, 129, 204, 0.45)";
const FILL_COLOR_ACTIVE = "rgba(36, 129, 204, 0.6)";
const LINE_COLOR = "rgba(36, 129, 204, 0.7)";
const LINE_COLOR_ACTIVE = "rgba(36, 129, 204, 1)";

export default function Map() {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const hoveredIdRef = useRef(null);

  const { loadPlaces, selectPlace, selectedPlace, places } = useMapStore();

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: CYPRUS_CENTER,
      zoom: CYPRUS_ZOOM,
      attributionControl: false,
      maxZoom: 18,
      minZoom: 7,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new mapboxgl.GeolocateControl({ trackUserLocation: false }), "top-right");

    // Setup source & layers on load
    map.on("load", () => {
      // Empty GeoJSON source
      map.addSource("places", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        generateId: true,
      });

      // Fill layer
      map.addLayer({
        id: "places-fill",
        type: "fill",
        source: "places",
        paint: {
          "fill-color": [
            "case",
            ["boolean", ["feature-state", "active"], false],
            FILL_COLOR_ACTIVE,
            ["boolean", ["feature-state", "hover"], false],
            FILL_COLOR_HOVER,
            FILL_COLOR,
          ],
          "fill-opacity": 1,
        },
      });

      // Outline layer
      map.addLayer({
        id: "places-line",
        type: "line",
        source: "places",
        paint: {
          "line-color": [
            "case",
            ["boolean", ["feature-state", "active"], false],
            LINE_COLOR_ACTIVE,
            LINE_COLOR,
          ],
          "line-width": [
            "case",
            ["boolean", ["feature-state", "active"], false],
            2.5,
            1,
          ],
        },
      });

      // Initial data load
      const bounds = map.getBounds();
      loadPlaces([
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
      ]);
    });

    // ── moveend: reload places ──
    map.on("moveend", () => {
      const bounds = map.getBounds();
      loadPlaces([
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
      ]);
    });

    // ── Hover ──
    map.on("mousemove", "places-fill", (e) => {
      if (e.features.length === 0) return;
      map.getCanvas().style.cursor = "pointer";

      // Clear old hover
      if (hoveredIdRef.current !== null) {
        map.setFeatureState(
          { source: "places", id: hoveredIdRef.current },
          { hover: false }
        );
      }
      hoveredIdRef.current = e.features[0].id;
      map.setFeatureState(
        { source: "places", id: hoveredIdRef.current },
        { hover: true }
      );
    });

    map.on("mouseleave", "places-fill", () => {
      map.getCanvas().style.cursor = "";
      if (hoveredIdRef.current !== null) {
        map.setFeatureState(
          { source: "places", id: hoveredIdRef.current },
          { hover: false }
        );
        hoveredIdRef.current = null;
      }
    });

    // ── Click → select place ──
    map.on("click", "places-fill", (e) => {
      if (e.features.length === 0) return;
      const feature = e.features[0];
      selectPlace({
        id: feature.properties.id,
        name: feature.properties.name,
        description: feature.properties.description,
        wikimapia_id: feature.properties.wikimapia_id,
        source_url: feature.properties.source_url,
      });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update source data when places change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !places) return;

    const source = map.getSource("places");
    if (source) {
      source.setData(places);
    }
  }, [places]);

  // Set active feature state when selection changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear all active states
    const source = map.getSource("places");
    if (!source?._data?.features) return;

    source._data.features.forEach((_, i) => {
      map.setFeatureState({ source: "places", id: i }, { active: false });
    });

    // Set active for selected
    if (selectedPlace && places?.features) {
      const idx = places.features.findIndex(
        (f) => f.properties.id === selectedPlace.id
      );
      if (idx >= 0) {
        map.setFeatureState({ source: "places", id: idx }, { active: true });
      }
    }
  }, [selectedPlace, places]);

  return <div ref={containerRef} className="map-container" />;
}
