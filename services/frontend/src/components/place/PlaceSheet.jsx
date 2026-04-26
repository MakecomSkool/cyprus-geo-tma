/**
 * src/components/place/PlaceSheet.jsx
 *
 * Apple Maps-style bottom sheet with 3 snap-points:
 *   Peek (180px) → Half (50%) → Full (90%)
 *
 * Features:
 *   - Drag handle with spring snap via framer-motion
 *   - Action row: Chat, Route, Share, Favorite
 *   - Photo carousel (half+)
 *   - Segmented tabs (full)
 *   - Integration with mapStore + chatStore
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from "framer-motion";
import {
  MessageCircle, Navigation, Share2, Heart,
  X, Star, MapPin, Users,
} from "lucide-react";
import useMapStore from "../../store/useMapStore";
import useChatStore from "../../store/useChatStore";
import { fetchPlaceDetails } from "../../lib/api";
import IconButton from "../ui/IconButton";
import Skeleton, { SkeletonText } from "../ui/Skeleton";
import PhotoCarousel from "./PhotoCarousel";
import PlaceTabs from "./PlaceTabs";
import ChatView from "../chat/ChatView";
import ReviewsTab from "./ReviewsTab";
import "./PlaceSheet.css";

// Snap-points (from bottom of viewport)
const PEEK_H = 180;

function getSnapPoints() {
  const vh = window.innerHeight;
  return {
    peek: vh - PEEK_H,
    half: vh * 0.5,
    full: vh * 0.1,
  };
}

export default function PlaceSheet() {
  const selectedPlace = useMapStore((s) => s.selectedPlace);
  const clearSelection = useMapStore((s) => s.clearSelection);
  const onlineCount = useChatStore((s) =>
    selectedPlace ? (s.onlineCounts[selectedPlace.id] || 0) : 0
  );

  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [snap, setSnap] = useState("peek"); // peek | half | full
  const [activeTab, setActiveTab] = useState("chat");
  const [isFavorited, setIsFavorited] = useState(false);

  const y = useMotionValue(0);
  const snaps = useMemo(getSnapPoints, []);

  // Overlay opacity synced with sheet position
  const overlayOpacity = useTransform(
    y,
    [snaps.full, snaps.peek],
    [0.4, 0.1]
  );

  // ── Load place details ────────────────────────────────────
  useEffect(() => {
    if (!selectedPlace?.id) {
      setDetails(null);
      return;
    }

    setLoading(true);
    setSnap("peek");
    setActiveTab("chat");
    setIsFavorited(false);

    // Animate to peek
    animate(y, snaps.peek, { type: "spring", stiffness: 300, damping: 30 });

    fetchPlaceDetails(selectedPlace.id)
      .then((data) => {
        setDetails(data);
        setIsFavorited(data.isFavorited || false);
      })
      .catch((err) => console.error("Failed to load place:", err))
      .finally(() => setLoading(false));
  }, [selectedPlace?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Snap logic on drag end ────────────────────────────────
  const handleDragEnd = useCallback(
    (_, info) => {
      const currentY = y.get();
      const velocity = info.velocity.y;

      // Fast swipe down → close
      if (velocity > 600) {
        handleClose();
        return;
      }
      // Fast swipe up → expand
      if (velocity < -600) {
        const target = snap === "peek" ? "half" : "full";
        setSnap(target);
        animate(y, snaps[target], { type: "spring", stiffness: 300, damping: 30 });
        return;
      }

      // Nearest snap
      const distances = {
        peek: Math.abs(currentY - snaps.peek),
        half: Math.abs(currentY - snaps.half),
        full: Math.abs(currentY - snaps.full),
      };

      const nearest = Object.entries(distances).sort((a, b) => a[1] - b[1])[0][0];

      // If dragged below peek → close
      if (currentY > snaps.peek + 60) {
        handleClose();
        return;
      }

      setSnap(nearest);
      animate(y, snaps[nearest], { type: "spring", stiffness: 300, damping: 30 });
    },
    [snap, snaps] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleClose = useCallback(() => {
    const vh = window.innerHeight;
    animate(y, vh, { type: "spring", stiffness: 300, damping: 30 }).then(() => {
      clearSelection();
    });
  }, [clearSelection, y]);

  // ── Action handlers ───────────────────────────────────────
  const goToChat = useCallback(() => {
    setSnap("full");
    setActiveTab("chat");
    animate(y, snaps.full, { type: "spring", stiffness: 300, damping: 30 });
  }, [snaps, y]);

  const openRoute = useCallback(() => {
    const d = details || selectedPlace;
    if (!d?.centroid) return;
    const { lat, lon } = d.centroid;
    window.open(
      `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`,
      "_blank"
    );
  }, [details, selectedPlace]);

  const sharePlace = useCallback(() => {
    const d = details || selectedPlace;
    const text = `📍 ${d?.name || "Place"}\nhttps://t.me/CyprusBot?startapp=place_${d?.id}`;
    try {
      window.Telegram?.WebApp?.switchInlineQuery?.(text);
    } catch {
      navigator.clipboard?.writeText(text);
    }
  }, [details, selectedPlace]);

  const toggleFavorite = useCallback(async () => {
    if (!selectedPlace?.id) return;
    const newState = !isFavorited;
    setIsFavorited(newState); // Optimistic UI

    try {
      if (newState) {
        const { addFavorite } = await import("../../lib/api");
        await addFavorite(selectedPlace.id, "loved");
      } else {
        const { removeFavorite } = await import("../../lib/api");
        await removeFavorite(selectedPlace.id);
      }
    } catch (err) {
      console.error("Favorite toggle error:", err);
      setIsFavorited(!newState); // Rollback on failure
    }
  }, [selectedPlace?.id, isFavorited]);

  // ── Rating display ────────────────────────────────────────
  const ratingStr = details?.stats?.ratingAvg
    ? `★ ${Number(details.stats.ratingAvg).toFixed(1)}`
    : null;
  const reviewsStr = details?.stats?.reviewsCount
    ? `${details.stats.reviewsCount} отзыв${details.stats.reviewsCount === 1 ? "" : "ов"}`
    : null;

  const place = details || selectedPlace || {};

  return (
    <AnimatePresence>
      {selectedPlace && (
        <>
          {/* Overlay backdrop */}
          <motion.div
            className="place-sheet-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ opacity: overlayOpacity }}
            onClick={handleClose}
          />

          {/* Sheet panel */}
          <motion.div
            className="place-sheet"
            style={{ y }}
            drag="y"
            dragConstraints={{ top: snaps.full, bottom: snaps.peek + 80 }}
            dragElastic={0.15}
            onDragEnd={handleDragEnd}
          >
            {/* ── Drag handle ──────────────────────────────── */}
            <div className="sheet-handle" />

            {/* ── PEEK content (always visible) ─────────────── */}
            <div className="place-sheet-peek">
              {/* Title row */}
              <div className="place-sheet-title-row">
                <div className="place-sheet-title-text">
                  {loading ? (
                    <Skeleton height={22} width="60%" borderRadius={11} />
                  ) : (
                    <h2 className="place-sheet-name">{place.name || "Место"}</h2>
                  )}

                  <div className="place-sheet-subtitle">
                    {loading ? (
                      <Skeleton height={14} width="40%" borderRadius={7} />
                    ) : (
                      <>
                        {ratingStr && <span className="place-sheet-rating">{ratingStr}</span>}
                        {reviewsStr && <span>{reviewsStr}</span>}
                        {onlineCount > 0 && (
                          <span className="place-sheet-online">
                            <Users size={12} /> {onlineCount} онлайн
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <IconButton label="Закрыть" onClick={handleClose} size={32}>
                  <X size={18} />
                </IconButton>
              </div>

              {/* Action row */}
              <div className="place-sheet-actions">
                <button className="action-btn" onClick={goToChat}>
                  <MessageCircle size={20} />
                  <span>Чат</span>
                </button>
                <button className="action-btn" onClick={openRoute}>
                  <Navigation size={20} />
                  <span>Маршрут</span>
                </button>
                <button className="action-btn" onClick={sharePlace}>
                  <Share2 size={20} />
                  <span>Поделиться</span>
                </button>
                <button
                  className={`action-btn ${isFavorited ? "action-btn-active" : ""}`}
                  onClick={toggleFavorite}
                >
                  <Heart size={20} fill={isFavorited ? "var(--danger)" : "none"} />
                  <span>Избранное</span>
                </button>
              </div>
            </div>

            {/* ── HALF content (photos + description) ────────── */}
            {(snap === "half" || snap === "full") && (
              <div className="place-sheet-half">
                {loading ? (
                  <Skeleton height={200} borderRadius={0} />
                ) : (
                  <PhotoCarousel photos={place.photos || []} />
                )}

                {place.description && (
                  <div className="place-sheet-description">
                    <p className={snap === "half" ? "line-clamp-3" : ""}>
                      {place.description}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── FULL content (tabs) ────────────────────────── */}
            {snap === "full" && (
              <div className="place-sheet-full">
                <PlaceTabs
                  active={activeTab}
                  onChange={setActiveTab}
                  chatCount={onlineCount}
                />

                <div className={`place-sheet-tab-content ${activeTab === "chat" ? "place-sheet-tab-chat" : ""}`}>
                  {activeTab === "chat" && (
                    <ChatView placeId={selectedPlace.id} />
                  )}
                  {activeTab === "reviews" && (
                    <ReviewsTab placeId={selectedPlace.id} />
                  )}
                  {activeTab === "info" && (
                    <div className="place-sheet-info">
                      {place.category && (
                        <div className="info-row">
                          <MapPin size={16} />
                          <span>{place.category}{place.subcategory ? ` · ${place.subcategory}` : ""}</span>
                        </div>
                      )}
                      {place.sourceUrl && (
                        <div className="info-row">
                          <span className="text-secondary text-footnote">
                            <a href={place.sourceUrl} target="_blank" rel="noopener">
                              Источник данных
                            </a>
                          </span>
                        </div>
                      )}
                      {!place.category && !place.sourceUrl && (
                        <div className="tab-placeholder">
                          <span>Информация скоро появится</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
