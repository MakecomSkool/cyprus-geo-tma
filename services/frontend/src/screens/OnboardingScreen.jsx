/**
 * src/screens/OnboardingScreen.jsx
 *
 * 3-slide onboarding flow:
 *  1. "Кипр на ладони" — concept
 *  2. "Общайся прямо в местах" — chat feature
 *  3. "Разрешите геолокацию" — CTA + geo permission
 *
 * Swipeable slides with dot pagination and animated transitions.
 * Saves hasSeenOnboarding to localStorage on completion.
 */

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MapPin, MessageCircle, Navigation, ChevronRight } from "lucide-react";
import Button from "../components/ui/Button";
import "./OnboardingScreen.css";

const SLIDES = [
  {
    id: 1,
    icon: MapPin,
    color: "#0A84FF",
    emoji: "🇨🇾",
    title: "Кипр на ладони",
    description:
      "Исследуйте каждый уголок острова — парки, пляжи, рестораны и достопримечательности на интерактивной карте с живыми данными.",
    btnText: "Далее",
  },
  {
    id: 2,
    icon: MessageCircle,
    color: "#34C759",
    emoji: "💬",
    title: "Общайся прямо в местах",
    description:
      "Пишите сообщения, оставляйте отзывы и делитесь фото прямо на карте. Видьте, где сейчас идут обсуждения — в реальном времени.",
    btnText: "Далее",
  },
  {
    id: 3,
    icon: Navigation,
    color: "#FF2D55",
    emoji: "📍",
    title: "Разрешите геолокацию",
    description:
      "Чтобы показать ближайшие места и маршруты, нам нужен доступ к вашей геолокации. Вы всегда сможете это изменить.",
    btnText: "Начать",
  },
];

const slideVariants = {
  enter: (direction) => ({
    x: direction > 0 ? 300 : -300,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction) => ({
    x: direction < 0 ? 300 : -300,
    opacity: 0,
  }),
};

export default function OnboardingScreen({ onComplete }) {
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState(1);
  const [geoLoading, setGeoLoading] = useState(false);

  const slide = SLIDES[current];
  const isLast = current === SLIDES.length - 1;

  const goNext = useCallback(() => {
    if (current < SLIDES.length - 1) {
      setDirection(1);
      setCurrent((prev) => prev + 1);
    }
  }, [current]);

  const goTo = useCallback((idx) => {
    setDirection(idx > current ? 1 : -1);
    setCurrent(idx);
  }, [current]);

  const handleFinish = useCallback(() => {
    setGeoLoading(true);

    // Request geolocation
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          // Success — fly to user location later
          localStorage.setItem("hasSeenOnboarding", "true");
          localStorage.setItem(
            "userGeo",
            JSON.stringify({ lat: pos.coords.latitude, lon: pos.coords.longitude })
          );
          setGeoLoading(false);
          onComplete?.();
        },
        () => {
          // Denied or error — still complete
          localStorage.setItem("hasSeenOnboarding", "true");
          setGeoLoading(false);
          onComplete?.();
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } else {
      // No geolocation API
      localStorage.setItem("hasSeenOnboarding", "true");
      setGeoLoading(false);
      onComplete?.();
    }
  }, [onComplete]);

  const handleAction = isLast ? handleFinish : goNext;

  return (
    <div className="onboarding">
      {/* Background gradient */}
      <div
        className="onboarding-bg"
        style={{
          background: `radial-gradient(circle at 50% 30%, ${slide.color}22 0%, transparent 70%)`,
        }}
      />

      {/* Skip button */}
      {!isLast && (
        <button
          className="onboarding-skip"
          onClick={() => {
            localStorage.setItem("hasSeenOnboarding", "true");
            onComplete?.();
          }}
        >
          Пропустить
        </button>
      )}

      {/* Slide content */}
      <div className="onboarding-content">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={slide.id}
            className="onboarding-slide"
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          >
            {/* Icon circle */}
            <div className="onboarding-icon-wrap">
              <div
                className="onboarding-icon-circle"
                style={{ background: `${slide.color}18`, borderColor: `${slide.color}40` }}
              >
                <span className="onboarding-emoji">{slide.emoji}</span>
              </div>
              <div
                className="onboarding-icon-glow"
                style={{ background: slide.color }}
              />
            </div>

            <h1 className="onboarding-title">{slide.title}</h1>
            <p className="onboarding-desc">{slide.description}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom: dots + button */}
      <div className="onboarding-bottom">
        {/* Dots */}
        <div className="onboarding-dots">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              className={`onboarding-dot ${i === current ? "onboarding-dot-active" : ""}`}
              onClick={() => goTo(i)}
              style={i === current ? { background: slide.color } : undefined}
            />
          ))}
        </div>

        {/* CTA button */}
        <Button
          variant="primary"
          size="full"
          onClick={handleAction}
          isLoading={geoLoading}
          style={{ background: slide.color }}
        >
          {slide.btnText}
          {!isLast && <ChevronRight size={18} />}
        </Button>
      </div>
    </div>
  );
}
