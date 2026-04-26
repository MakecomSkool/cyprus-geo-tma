/**
 * src/App.jsx — Root component for the Cyprus Geo-Social TMA.
 *
 * Orchestration:
 *  1. Initialize Telegram SDK
 *  2. Onboarding gate
 *  3. Deep links (place_<id>)
 *  4. Tab navigation: Map / Favorites / Profile
 *  5. PlaceSheet overlay (renders above everything)
 */

import { useState, useEffect, useCallback } from "react";
import { initTelegram } from "./lib/telegram";
import { fetchPlaceDetails } from "./lib/api";
import useMapStore from "./store/useMapStore";
import OnboardingScreen from "./screens/OnboardingScreen";
import MapScreen from "./screens/MapScreen";
import FavoritesScreen from "./screens/FavoritesScreen";
import ProfileScreen from "./screens/ProfileScreen";
import PlaceSheet from "./components/place/PlaceSheet";

export default function App() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [appReady, setAppReady] = useState(false);
  const [currentTab, setCurrentTab] = useState("map");

  const selectPlace = useMapStore((s) => s.selectPlace);

  useEffect(() => {
    const { deepLink } = initTelegram();
    const hasSeenOnboarding = localStorage.getItem("hasSeenOnboarding") === "true";

    if (!hasSeenOnboarding) setShowOnboarding(true);
    setAppReady(true);

    // Deep link handling
    if (deepLink?.type === "place" && deepLink.id) {
      fetchPlaceDetails(deepLink.id)
        .then((place) => {
          selectPlace({
            id: place.id,
            name: place.name,
            category: place.category,
          });
          if (place.centroid?.lat && place.centroid?.lon) {
            setTimeout(() => {
              window.__mapFlyTo?.([place.centroid.lon, place.centroid.lat], 16);
            }, 1500);
          }
        })
        .catch((err) => console.warn("[DeepLink] Failed:", err));
    }

    // Fly to saved geo
    if (hasSeenOnboarding) {
      try {
        const saved = JSON.parse(localStorage.getItem("userGeo") || "null");
        if (saved?.lat && saved?.lon) {
          setTimeout(() => window.__mapFlyTo?.([saved.lon, saved.lat], 13), 1000);
          localStorage.removeItem("userGeo");
        }
      } catch { /* ignore */ }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false);
    try {
      const saved = JSON.parse(localStorage.getItem("userGeo") || "null");
      if (saved?.lat && saved?.lon) {
        setTimeout(() => window.__mapFlyTo?.([saved.lon, saved.lat], 13), 500);
        localStorage.removeItem("userGeo");
      }
    } catch { /* ignore */ }
  }, []);

  if (!appReady) return null;

  if (showOnboarding) {
    return <OnboardingScreen onComplete={handleOnboardingComplete} />;
  }

  return (
    <>
      {/* Map is always mounted (preserves WebGL context).
          Hidden via CSS when another tab is active. */}
      <div style={{ display: currentTab === "map" ? "contents" : "none" }}>
        <MapScreen currentTab={currentTab} onTabChange={setCurrentTab} />
      </div>

      {/* Favorites screen */}
      {currentTab === "favorites" && (
        <FavoritesScreen onTabChange={setCurrentTab} />
      )}

      {/* Profile screen */}
      {currentTab === "profile" && (
        <ProfileScreen onTabChange={setCurrentTab} />
      )}

      {/* PlaceSheet overlay — always available */}
      <PlaceSheet />
    </>
  );
}
