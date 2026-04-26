/**
 * src/components/place/PhotoCarousel.jsx
 *
 * Horizontal photo carousel with snap-x and dot indicators.
 * Spec: 200px height, scroll-snap, dots below.
 */

import { useRef, useState, useCallback, useEffect } from "react";
import "./PhotoCarousel.css";

export default function PhotoCarousel({ photos = [] }) {
  const scrollRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.offsetWidth);
    setActiveIndex(idx);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  if (!photos.length) {
    return (
      <div className="photo-carousel-empty">
        <span className="photo-carousel-empty-icon">📷</span>
        <span>Нет фотографий</span>
      </div>
    );
  }

  return (
    <div className="photo-carousel-wrap">
      <div className="photo-carousel" ref={scrollRef}>
        {photos.map((url, i) => (
          <div key={i} className="photo-carousel-slide">
            <img
              src={url}
              alt={`Photo ${i + 1}`}
              loading={i === 0 ? "eager" : "lazy"}
              draggable={false}
            />
          </div>
        ))}
      </div>

      {photos.length > 1 && (
        <div className="photo-carousel-dots">
          {photos.map((_, i) => (
            <span
              key={i}
              className={`photo-dot ${i === activeIndex ? "photo-dot-active" : ""}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
