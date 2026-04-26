/**
 * src/components/map/MapStylePicker.jsx
 *
 * Floating button → mini-menu with map style previews.
 * Styles: OSM, Satellite, Hybrid, Dark.
 *
 * Persists selection to localStorage via useMapStore.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Layers } from "lucide-react";
import useMapStore from "../../store/useMapStore";
import "./MapStylePicker.css";

const STYLES = [
  {
    key: "osm",
    label: "Карта",
    preview: "https://tile.openstreetmap.org/5/17/11.png",
  },
  {
    key: "satellite",
    label: "Спутник",
    preview: "https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/5/17/11?access_token=" + (import.meta.env.VITE_MAPBOX_TOKEN || ""),
  },
  {
    key: "hybrid",
    label: "Гибрид",
    preview: "https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/5/17/11?access_token=" + (import.meta.env.VITE_MAPBOX_TOKEN || ""),
  },
  {
    key: "dark",
    label: "Тёмная",
    preview: "https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/5/17/11?access_token=" + (import.meta.env.VITE_MAPBOX_TOKEN || ""),
  },
];

export default function MapStylePicker() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  const currentStyle = useMapStore((s) => s.currentStyle);
  const setMapStyle = useMapStore((s) => s.setMapStyle);

  const handleSelect = useCallback(
    (key) => {
      setMapStyle(key);
      setOpen(false);
    },
    [setMapStyle]
  );

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [open]);

  return (
    <div className="map-style-picker" ref={menuRef}>
      {/* Trigger button */}
      <button
        className="map-style-trigger glass"
        onClick={() => setOpen((v) => !v)}
        aria-label="Переключить стиль карты"
      >
        <Layers size={20} />
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            className="map-style-menu glass-strong"
            initial={{ opacity: 0, scale: 0.85, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: -8 }}
            transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
          >
            {STYLES.map(({ key, label, preview }) => (
              <button
                key={key}
                className={`map-style-option ${key === currentStyle ? "map-style-option-active" : ""}`}
                onClick={() => handleSelect(key)}
              >
                <div className="map-style-thumb">
                  <img src={preview} alt={label} loading="lazy" />
                  {key === currentStyle && (
                    <div className="map-style-check">✓</div>
                  )}
                </div>
                <span className="map-style-label">{label}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
