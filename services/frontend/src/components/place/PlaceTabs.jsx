/**
 * src/components/place/PlaceTabs.jsx
 *
 * iOS-style segmented control for place content tabs.
 * Tabs: Чат (with count), Отзывы, Инфо.
 */

import { motion } from "framer-motion";
import "./PlaceTabs.css";

const TABS = [
  { key: "chat", label: "Чат" },
  { key: "reviews", label: "Отзывы" },
  { key: "info", label: "Инфо" },
];

export default function PlaceTabs({ active = "chat", onChange, chatCount = 0 }) {
  return (
    <div className="place-tabs">
      {TABS.map(({ key, label }) => (
        <button
          key={key}
          className={`place-tab ${active === key ? "place-tab-active" : ""}`}
          onClick={() => onChange?.(key)}
        >
          {label}
          {key === "chat" && chatCount > 0 && (
            <span className="place-tab-badge">{chatCount}</span>
          )}
          {active === key && (
            <motion.div
              className="place-tab-indicator"
              layoutId="tab-indicator"
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
            />
          )}
        </button>
      ))}
    </div>
  );
}
