/**
 * src/screens/MapScreen.jsx
 *
 * Main screen: fullscreen map + overlay UI + search overlay + TabBar.
 * Accepts currentTab/onTabChange to drive global navigation.
 */

import { useState, useCallback } from "react";
import MapCanvas from "../components/map/MapCanvas";
import CategoryChips from "../components/map/CategoryChips";
import MapStylePicker from "../components/map/MapStylePicker";
import TabBar from "../components/map/TabBar";
import SearchInput from "../components/ui/SearchInput";
import IconButton from "../components/ui/IconButton";
import SearchScreen from "./SearchScreen";
import { Navigation } from "lucide-react";
import useMapStore from "../store/useMapStore";
import "./MapScreen.css";

export default function MapScreen({ currentTab = "map", onTabChange }) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const selectPlace = useMapStore((s) => s.selectPlace);

  const handlePlaceClick = useCallback(
    (placeId, props) => {
      selectPlace({ id: placeId, ...props });
    },
    [selectPlace]
  );

  const handleSearchOpen = useCallback(() => setIsSearchOpen(true), []);
  const handleSearchClose = useCallback(() => setIsSearchOpen(false), []);

  const handleGeolocate = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.__mapFlyTo?.([pos.coords.longitude, pos.coords.latitude], 15);
      },
      (err) => console.warn("Geolocation error:", err.message),
      { enableHighAccuracy: true, timeout: 5000 }
    );
  }, []);

  return (
    <div className="map-screen">
      <MapCanvas onPlaceClick={handlePlaceClick} />

      <div className="map-overlay-top">
        <SearchInput
          placeholder="Поиск места..."
          onFocus={handleSearchOpen}
          className="map-search-pill"
        />
        <CategoryChips />
      </div>

      <div className="map-fab-layers">
        <MapStylePicker />
      </div>

      <div className="map-fab-geo">
        <IconButton
          variant="glass"
          size={52}
          label="Моё местоположение"
          onClick={handleGeolocate}
        >
          <Navigation size={22} />
        </IconButton>
      </div>

      <TabBar active={currentTab} onChange={onTabChange} />

      <SearchScreen isOpen={isSearchOpen} onClose={handleSearchClose} />
    </div>
  );
}
