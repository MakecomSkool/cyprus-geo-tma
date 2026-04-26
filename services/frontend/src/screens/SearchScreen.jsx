/**
 * src/screens/SearchScreen.jsx
 *
 * Full-screen search overlay (Screen 4).
 *
 * States:
 *  - Empty: Recent searches (localStorage) + Category grid
 *  - Loading: Skeleton list
 *  - Results: List of places with rating/distance/category
 *  - No results: Empty state illustration
 *
 * On result click → save to recent, flyTo, selectPlace, close.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, X, Clock, Trash2, MapPin,
  Star, Trees, Utensils, ShoppingBag, Hotel, Landmark, Waves,
} from "lucide-react";
import { searchPlaces } from "../lib/api";
import useMapStore from "../store/useMapStore";
import Skeleton from "../components/ui/Skeleton";
import "./SearchScreen.css";

// ── localStorage helpers ────────────────────────────────────
const RECENT_KEY = "cyprus_search_recent";
const MAX_RECENT = 5;

function getRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveRecent(item) {
  const list = getRecent().filter((r) => r.id !== item.id);
  list.unshift(item);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
}

function clearRecent() {
  localStorage.removeItem(RECENT_KEY);
}

// ── Category grid data ──────────────────────────────────────
const CATEGORY_GRID = [
  { key: "park", label: "Парки", icon: Trees, color: "#34c759" },
  { key: "beach", label: "Пляжи", icon: Waves, color: "#0a84ff" },
  { key: "restaurant", label: "Рестораны", icon: Utensils, color: "#ff9500" },
  { key: "shop", label: "Магазины", icon: ShoppingBag, color: "#ff2d55" },
  { key: "hotel", label: "Отели", icon: Hotel, color: "#af52de" },
  { key: "attraction", label: "Достоприм.", icon: Landmark, color: "#5ac8fa" },
];

// ── Debounce hook ───────────────────────────────────────────
function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ── Format distance ─────────────────────────────────────────
function formatDistance(meters) {
  if (!meters && meters !== 0) return null;
  if (meters < 1000) return `${meters} м`;
  return `${(meters / 1000).toFixed(1)} км`;
}

export default function SearchScreen({ isOpen, onClose }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [recentItems, setRecentItems] = useState(getRecent);

  const inputRef = useRef(null);
  const debouncedQuery = useDebounce(query.trim(), 300);

  const selectPlace = useMapStore((s) => s.selectPlace);
  const bbox = useMapStore((s) => s.bbox);

  // ── Auto-focus on open ────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setResults([]);
      setSearched(false);
      setRecentItems(getRecent());
      // Small delay for animation to start before focusing
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // ── Search on debounced query ─────────────────────────────
  useEffect(() => {
    if (!debouncedQuery) {
      setResults([]);
      setSearched(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setSearched(true);

    const params = { q: debouncedQuery, limit: 20 };
    if (bbox) params.bbox = bbox;

    searchPlaces(params)
      .then((data) => {
        if (!cancelled) {
          setResults(data.results || []);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error("Search error:", err);
        if (!cancelled) {
          setResults([]);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [debouncedQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle category search ────────────────────────────────
  const searchByCategory = useCallback((cat) => {
    setQuery("");
    setLoading(true);
    setSearched(true);

    const params = { category: cat, limit: 20 };
    if (bbox) params.bbox = bbox;

    searchPlaces(params)
      .then((data) => {
        setResults(data.results || []);
        setLoading(false);
      })
      .catch(() => {
        setResults([]);
        setLoading(false);
      });
  }, [bbox]);

  // ── Handle result click ───────────────────────────────────
  const handleResultClick = useCallback(
    (item) => {
      // Save to recent
      saveRecent({
        id: item.id,
        name: item.name,
        category: item.category,
        rating: item.rating,
      });

      // FlyTo centroid
      if (item.centroid) {
        window.__mapFlyTo?.([item.centroid.lon, item.centroid.lat], 16);
      }

      // Select place → opens PlaceSheet
      selectPlace({ id: item.id, name: item.name, category: item.category });

      // Close search
      onClose?.();
    },
    [selectPlace, onClose]
  );

  // ── Handle recent click ───────────────────────────────────
  const handleRecentClick = useCallback(
    (item) => {
      // Re-search to get fresh centroid
      setQuery(item.name);
    },
    []
  );

  // ── Clear recent ──────────────────────────────────────────
  const handleClearRecent = useCallback(() => {
    clearRecent();
    setRecentItems([]);
  }, []);

  // ── Close handler ─────────────────────────────────────────
  const handleClose = useCallback(() => {
    setQuery("");
    onClose?.();
  }, [onClose]);

  const showEmpty = !query.trim() && !searched;
  const showSkeleton = loading;
  const showResults = searched && !loading && results.length > 0;
  const showNoResults = searched && !loading && results.length === 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="search-screen"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
        >
          {/* ── Header ──────────────────────────────────── */}
          <div className="search-header">
            <div className="search-header-input">
              <Search size={18} className="search-header-icon" />
              <input
                ref={inputRef}
                type="text"
                className="search-field"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск места..."
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="search"
              />
              {query && (
                <button
                  className="search-clear-btn"
                  onClick={() => setQuery("")}
                  aria-label="Очистить"
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <button className="search-cancel-btn" onClick={handleClose}>
              Отмена
            </button>
          </div>

          {/* ── Content ─────────────────────────────────── */}
          <div className="search-content">

            {/* Empty state: Recent + Categories */}
            {showEmpty && (
              <div className="search-empty-state">
                {/* Recent searches */}
                {recentItems.length > 0 && (
                  <section className="search-section">
                    <div className="search-section-header">
                      <h3>Недавнее</h3>
                      <button className="search-section-action" onClick={handleClearRecent}>
                        <Trash2 size={14} />
                        <span>Очистить</span>
                      </button>
                    </div>
                    {recentItems.map((item) => (
                      <button
                        key={item.id}
                        className="search-recent-item"
                        onClick={() => handleRecentClick(item)}
                      >
                        <Clock size={16} className="search-recent-icon" />
                        <span className="search-recent-name">{item.name}</span>
                        {item.rating && (
                          <span className="search-recent-rating">
                            <Star size={11} /> {Number(item.rating).toFixed(1)}
                          </span>
                        )}
                      </button>
                    ))}
                  </section>
                )}

                {/* Category grid */}
                <section className="search-section">
                  <h3>Категории</h3>
                  <div className="search-category-grid">
                    {CATEGORY_GRID.map(({ key, label, icon: Icon, color }) => (
                      <button
                        key={key}
                        className="search-cat-card"
                        onClick={() => searchByCategory(key)}
                      >
                        <div className="search-cat-icon" style={{ background: color }}>
                          <Icon size={20} color="#fff" />
                        </div>
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {/* Loading skeletons */}
            {showSkeleton && (
              <div className="search-skeletons">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="search-skeleton-row">
                    <Skeleton circle height={40} />
                    <div className="search-skeleton-text">
                      <Skeleton height={16} width={`${55 + Math.random() * 30}%`} borderRadius={8} />
                      <Skeleton height={12} width={`${30 + Math.random() * 20}%`} borderRadius={6} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Results list */}
            {showResults && (
              <div className="search-results">
                {results.map((item) => (
                  <button
                    key={item.id}
                    className="search-result-item"
                    onClick={() => handleResultClick(item)}
                  >
                    <div className="search-result-pin">
                      <MapPin size={18} />
                    </div>
                    <div className="search-result-info">
                      <span
                        className="search-result-name"
                        dangerouslySetInnerHTML={{
                          __html: item.highlight?.name || item.name,
                        }}
                      />
                      <div className="search-result-meta">
                        {item.category && (
                          <span className="search-result-cat">{item.category}</span>
                        )}
                        {item.rating > 0 && (
                          <span className="search-result-rating">
                            ★ {Number(item.rating).toFixed(1)}
                          </span>
                        )}
                        {item.distanceM != null && (
                          <span className="search-result-dist">
                            {formatDistance(item.distanceM)}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* No results */}
            {showNoResults && (
              <div className="search-no-results">
                <Search size={40} opacity={0.2} />
                <span className="search-no-title">Ничего не найдено</span>
                <span className="search-no-sub">
                  Попробуйте другой запрос
                </span>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
