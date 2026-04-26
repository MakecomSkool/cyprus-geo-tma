/**
 * src/components/place/ReviewsTab.jsx
 *
 * Full reviews tab content:
 *  1. Rating summary (big average + distribution bars)
 *  2. "Write review" CTA → ReviewForm
 *  3. List of ReviewCards with pagination
 */

import { useState, useEffect, useCallback } from "react";
import { Star, ChevronDown } from "lucide-react";
import { fetchReviews, submitReview } from "../../lib/api";
import ReviewCard, { StarRating } from "./ReviewCard";
import ReviewForm from "./ReviewForm";
import Skeleton from "../ui/Skeleton";
import Button from "../ui/Button";
import "./ReviewsTab.css";

export default function ReviewsTab({ placeId }) {
  const [reviews, setReviews] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ── Load reviews ──────────────────────────────────────────
  useEffect(() => {
    if (!placeId) return;
    setLoading(true);

    fetchReviews(placeId)
      .then((data) => {
        setReviews(data.reviews || []);
        setStats(data.stats || null);
        setCursor(data.nextCursor || null);
        setHasMore(!!data.nextCursor);
      })
      .catch((err) => console.error("Reviews load error:", err))
      .finally(() => setLoading(false));
  }, [placeId]);

  // ── Load more ─────────────────────────────────────────────
  const handleLoadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);

    try {
      const data = await fetchReviews(placeId, { cursor });
      setReviews((prev) => [...prev, ...(data.reviews || [])]);
      setCursor(data.nextCursor || null);
      setHasMore(!!data.nextCursor);
    } catch (err) {
      console.error("Load more reviews error:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [placeId, cursor, loadingMore]);

  // ── Submit review ─────────────────────────────────────────
  const handleSubmit = useCallback(
    async ({ rating, body }) => {
      setSubmitting(true);
      try {
        const data = await submitReview(placeId, { rating, body });
        // Prepend new review
        setReviews((prev) => {
          // Remove existing review by same user if UPSERT
          const filtered = prev.filter((r) => r.id !== data.review.id);
          return [data.review, ...filtered];
        });
        // Update stats
        if (data.stats) setStats(data.stats);
        setShowForm(false);

        // Re-fetch stats after trigger fires
        setTimeout(async () => {
          try {
            const fresh = await fetchReviews(placeId, { limit: 1 });
            if (fresh.stats) setStats(fresh.stats);
          } catch { /* ignore */ }
        }, 500);
      } catch (err) {
        console.error("Submit review error:", err);
      } finally {
        setSubmitting(false);
      }
    },
    [placeId]
  );

  // ── Rating distribution bars ──────────────────────────────
  const dist = stats?.ratingDistribution || {};
  const maxCount = Math.max(...Object.values(dist), 1);

  return (
    <div className="reviews-tab">
      {/* ── Rating Summary ──────────────────────────────── */}
      {loading ? (
        <div className="reviews-summary">
          <Skeleton height={60} width={80} borderRadius={12} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            {[5, 4, 3, 2, 1].map((i) => (
              <Skeleton key={i} height={10} borderRadius={5} />
            ))}
          </div>
        </div>
      ) : stats && stats.reviewsCount > 0 ? (
        <div className="reviews-summary">
          <div className="reviews-summary-big">
            <span className="reviews-big-number">
              {stats.ratingAvg?.toFixed(1) || "0.0"}
            </span>
            <StarRating rating={Math.round(stats.ratingAvg || 0)} size={16} />
            <span className="reviews-total">{stats.reviewsCount} отзыв{stats.reviewsCount === 1 ? "" : "ов"}</span>
          </div>

          <div className="reviews-bars">
            {[5, 4, 3, 2, 1].map((n) => (
              <div key={n} className="reviews-bar-row">
                <span className="reviews-bar-label">{n}</span>
                <div className="reviews-bar-track">
                  <div
                    className="reviews-bar-fill"
                    style={{ width: `${((dist[n] || 0) / maxCount) * 100}%` }}
                  />
                </div>
                <span className="reviews-bar-count">{dist[n] || 0}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── Write review CTA ────────────────────────────── */}
      {!showForm && (
        <Button
          variant="secondary"
          size="full"
          onClick={() => setShowForm(true)}
          style={{ marginBottom: "var(--s-4)" }}
        >
          <Star size={16} /> Оставить отзыв
        </Button>
      )}

      {/* ── Review form ─────────────────────────────────── */}
      {showForm && (
        <ReviewForm
          onSubmit={handleSubmit}
          onCancel={() => setShowForm(false)}
          isLoading={submitting}
        />
      )}

      {/* ── Reviews list ────────────────────────────────── */}
      {loading ? (
        <div className="reviews-skeletons">
          {[1, 2, 3].map((i) => (
            <div key={i} className="review-skeleton">
              <Skeleton circle height={36} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                <Skeleton height={14} width="40%" borderRadius={7} />
                <Skeleton height={12} width="60%" borderRadius={6} />
              </div>
            </div>
          ))}
        </div>
      ) : reviews.length === 0 && !showForm ? (
        <div className="reviews-empty">
          <Star size={36} opacity={0.2} />
          <span>Ещё нет отзывов</span>
          <span className="reviews-empty-sub">Будьте первым!</span>
        </div>
      ) : (
        <div className="reviews-list">
          {reviews.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}

          {hasMore && (
            <Button
              variant="ghost"
              size="full"
              onClick={handleLoadMore}
              isLoading={loadingMore}
              style={{ marginTop: "var(--s-2)" }}
            >
              <ChevronDown size={16} /> Ещё отзывы
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
