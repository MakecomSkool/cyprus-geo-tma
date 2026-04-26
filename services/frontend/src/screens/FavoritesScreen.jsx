/**
 * src/screens/FavoritesScreen.jsx
 *
 * Screen 6: Favorites list with segmented control.
 * Tabs: Все / Хочу / Был / Любимые
 */

import { useState, useEffect, useCallback } from "react";
import { Heart, MapPin, Star, ChevronRight } from "lucide-react";
import { fetchProfile, fetchPlaceDetails } from "../lib/api";
import TabBar from "../components/map/TabBar";
import useMapStore from "../store/useMapStore";
import "./FavoritesScreen.css";

const SEGMENTS = [
  { key: "all", label: "Все" },
  { key: "loved", label: "❤️ Любимые" },
  { key: "want", label: "🎯 Хочу" },
  { key: "visited", label: "✅ Был" },
];

function PlaceCardMini({ placeId, listType, onOpen }) {
  const [place, setPlace] = useState(null);

  useEffect(() => {
    fetchPlaceDetails(placeId)
      .then(setPlace)
      .catch(() => setPlace({ id: placeId, name: `Место ${placeId.slice(0, 6)}…` }));
  }, [placeId]);

  if (!place) {
    return (
      <div className="fav-card fav-card-loading">
        <div className="fav-card-skeleton-icon" />
        <div className="fav-card-skeleton-text">
          <div className="skeleton-bar w60" />
          <div className="skeleton-bar w40" />
        </div>
      </div>
    );
  }

  const typeEmoji = listType === "loved" ? "❤️" : listType === "want" ? "🎯" : "✅";

  return (
    <button className="fav-card" onClick={() => onOpen(place)}>
      <div className="fav-card-icon">
        <MapPin size={20} />
      </div>
      <div className="fav-card-info">
        <span className="fav-card-name">{place.name}</span>
        <span className="fav-card-meta">
          {place.stats?.ratingAvg ? `★ ${Number(place.stats.ratingAvg).toFixed(1)}` : ""}
          {place.category ? ` · ${place.category}` : ""}
          {" "}{typeEmoji}
        </span>
      </div>
      <ChevronRight size={18} className="fav-card-arrow" />
    </button>
  );
}

export default function FavoritesScreen({ onTabChange }) {
  const [segment, setSegment] = useState("all");
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const selectPlace = useMapStore((s) => s.selectPlace);

  useEffect(() => {
    setLoading(true);
    fetchProfile()
      .then((data) => setFavorites(data.favorites || []))
      .catch(() => setFavorites([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = segment === "all"
    ? favorites
    : favorites.filter((f) => f.listType === segment);

  const handleOpen = useCallback((place) => {
    selectPlace({
      id: place.id,
      name: place.name,
      category: place.category,
      wikimapia_id: place.wikimapiaId,
    });
    onTabChange?.("map");
  }, [selectPlace, onTabChange]);

  return (
    <div className="favorites-screen">
      {/* Header */}
      <div className="fav-header">
        <h1 className="fav-title">Избранное</h1>
        <span className="fav-count">{favorites.length} мест</span>
      </div>

      {/* Segmented control */}
      <div className="fav-segments">
        {SEGMENTS.map(({ key, label }) => (
          <button
            key={key}
            className={`fav-segment ${segment === key ? "fav-segment-active" : ""}`}
            onClick={() => setSegment(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="fav-list">
        {loading ? (
          <div className="fav-empty">
            <div className="fav-spinner" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="fav-empty">
            <Heart size={40} opacity={0.2} />
            <span className="fav-empty-text">
              {segment === "all"
                ? "Пока ничего нет"
                : `Нет мест в категории «${SEGMENTS.find((s) => s.key === segment)?.label}»`}
            </span>
            <span className="fav-empty-hint">
              Нажмите ❤️ на карточке места, чтобы добавить
            </span>
          </div>
        ) : (
          filtered.map((fav) => (
            <PlaceCardMini
              key={fav.placeId}
              placeId={fav.placeId}
              listType={fav.listType}
              onOpen={handleOpen}
            />
          ))
        )}
      </div>

      <TabBar active="favorites" onChange={onTabChange} />
    </div>
  );
}
