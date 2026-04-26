/**
 * src/components/place/ReviewForm.jsx
 *
 * Review creation form: 5-star selector + textarea + submit button.
 * Fires onSubmit({ rating, body }).
 */

import { useState, useCallback } from "react";
import Button from "../ui/Button";
import "./ReviewForm.css";

export default function ReviewForm({ onSubmit, onCancel, isLoading = false }) {
  const [rating, setRating] = useState(0);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [body, setBody] = useState("");

  const handleSubmit = useCallback(() => {
    if (rating < 1 || rating > 5) return;
    onSubmit?.({ rating, body: body.trim() });
  }, [rating, body, onSubmit]);

  const displayRating = hoveredStar || rating;

  const ratingLabels = ["", "Ужасно", "Плохо", "Нормально", "Хорошо", "Отлично"];

  return (
    <div className="review-form">
      <h3 className="review-form-title">Оставить отзыв</h3>

      {/* Star picker */}
      <div className="review-form-stars-wrap">
        <div className="review-form-stars">
          {[1, 2, 3, 4, 5].map((i) => (
            <button
              key={i}
              className={`review-star-btn ${i <= displayRating ? "review-star-active" : ""}`}
              onClick={() => setRating(i)}
              onMouseEnter={() => setHoveredStar(i)}
              onMouseLeave={() => setHoveredStar(0)}
              onTouchStart={() => setRating(i)}
              aria-label={`${i} звезда`}
            >
              ★
            </button>
          ))}
        </div>
        {displayRating > 0 && (
          <span className="review-form-rating-label">
            {ratingLabels[displayRating]}
          </span>
        )}
      </div>

      {/* Text */}
      <textarea
        className="review-form-textarea"
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, 2000))}
        placeholder="Расскажите о своём впечатлении..."
        rows={3}
        maxLength={2000}
      />

      <div className="review-form-footer">
        <span className="review-form-count">{body.length}/2000</span>
        <div className="review-form-actions">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              Отмена
            </Button>
          )}
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={rating === 0}
            isLoading={isLoading}
          >
            Отправить
          </Button>
        </div>
      </div>
    </div>
  );
}
