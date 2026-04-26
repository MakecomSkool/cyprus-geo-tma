/**
 * src/components/place/ReviewCard.jsx
 *
 * Single review card: avatar, name, star rating, text, date.
 */

import "./ReviewCard.css";

function StarRating({ rating, size = 14 }) {
  return (
    <div className="star-rating" aria-label={`${rating} из 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`star ${i <= rating ? "star-filled" : "star-empty"}`}
          style={{ fontSize: size }}
        >
          ★
        </span>
      ))}
    </div>
  );
}

function timeAgo(iso) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "только что";
    if (mins < 60) return `${mins} мин назад`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} ч назад`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days} д назад`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} мес назад`;
    return `${Math.floor(months / 12)} г назад`;
  } catch {
    return "";
  }
}

export { StarRating };

export default function ReviewCard({ review }) {
  const { user, rating, body, createdAt } = review;
  const initial = (user?.firstName || "?")[0];
  const hue = (user?.firstName?.charCodeAt(0) || 0) * 37 % 360;

  return (
    <div className="review-card">
      <div className="review-card-header">
        <div
          className="review-avatar"
          style={{ background: `hsl(${hue}, 50%, 55%)` }}
        >
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="" />
          ) : (
            initial
          )}
        </div>

        <div className="review-author-info">
          <span className="review-author-name">
            {user?.firstName || user?.username || "Пользователь"}
          </span>
          <span className="review-date">{timeAgo(createdAt)}</span>
        </div>

        <StarRating rating={rating} />
      </div>

      {body && <p className="review-body">{body}</p>}
    </div>
  );
}
