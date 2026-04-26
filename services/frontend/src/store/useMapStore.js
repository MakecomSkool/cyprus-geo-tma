/**
 * src/store/useMapStore.js — Zustand store for map + live-places state.
 *
 * State:
 *   places        — GeoJSON FeatureCollection from clusters API
 *   selectedPlace — { id, name, ... } of clicked polygon
 *   livePlaces    — Map<placeId, onlineCount> from WS live feed
 *   bbox          — current viewport [w,s,e,n]
 *   zoom          — current zoom level
 */

import { create } from "zustand";
import { fetchClusters, fetchPlaces } from "../lib/api.js";
import { getSocket, onSocketEvent } from "../lib/socket.js";

const useMapStore = create((set, get) => ({
  // ── State ──────────────────────────────────────────────
  /** @type {object | null} GeoJSON FeatureCollection */
  places: null,

  /** Currently selected place */
  selectedPlace: null,

  /** Map<placeId, onlineCount> for live pulse rendering */
  livePlaces: {},

  /** Current viewport bbox */
  bbox: null,

  /** Current zoom level */
  zoom: 9,

  /** Loading state */
  loading: false,

  /** Error message */
  error: null,

  /** Active category filter */
  category: null,

  /** Map base style: 'osm' | 'satellite' | 'hybrid' | 'dark' */
  currentStyle: localStorage.getItem("mapStyle") || "osm",

  // ── Actions ────────────────────────────────────────────

  /**
   * Load places from API using LOD strategy.
   * Falls back to legacy /api/places for zoom >= 16.
   */
  loadPlaces: async (bbox, zoom) => {
    set({ loading: true, error: null, bbox, zoom });
    try {
      const data = await fetchClusters(bbox, zoom, {
        category: get().category,
      });
      set({ places: data, loading: false });
    } catch (err) {
      // Fallback to legacy endpoint
      try {
        const data = await fetchPlaces(bbox);
        set({ places: data, loading: false });
      } catch (fallbackErr) {
        set({ error: fallbackErr.message, loading: false });
      }
    }
  },

  /** Select a place (opens bottom sheet) */
  selectPlace: (place) => set({ selectedPlace: place }),

  /** Deselect place (closes bottom sheet) */
  clearSelection: () => set({ selectedPlace: null }),

  /** Set category filter */
  setCategory: (category) => {
    set({ category });
    // Reload with current bbox
    const { bbox, zoom } = get();
    if (bbox) get().loadPlaces(bbox, zoom);
  },

  /** Set map base style */
  setMapStyle: (style) => {
    localStorage.setItem("mapStyle", style);
    set({ currentStyle: style });
  },

  /**
   * Apply a live_places_update diff from the WebSocket.
   * Updates livePlaces map for rendering pulse effects.
   */
  applyLiveDiff: (diff) => {
    set((state) => {
      const next = { ...state.livePlaces };

      // Add new live places
      for (const item of diff.added || []) {
        next[item.placeId] = item.onlineCount;
      }

      // Update changed counts
      for (const item of diff.changed || []) {
        next[item.placeId] = item.onlineCount;
      }

      // Remove places no longer active
      for (const placeId of diff.removed || []) {
        delete next[placeId];
      }

      return { livePlaces: next };
    });
  },

  /**
   * Subscribe to live-places for the current viewport.
   * Called on map moveend.
   */
  subscribeLive: (bbox) => {
    const socket = getSocket();
    socket.emit("subscribe_live", { bbox });
  },

  /** Unsubscribe from live-places feed */
  unsubscribeLive: () => {
    const socket = getSocket();
    socket.emit("unsubscribe_live");
  },
}));

// ── Auto-subscribe to WS events ────────────────────────────
// This runs once when the module is imported.
onSocketEvent("live_places_update", (diff) => {
  useMapStore.getState().applyLiveDiff(diff);
});

export default useMapStore;
