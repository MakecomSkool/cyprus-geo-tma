/**
 * src/components/map/TabBar.jsx
 *
 * Bottom tab bar — translucent glass, 3 tabs.
 * Spec: 49px + safe-area-inset-bottom.
 */

import { Map, Heart, User } from "lucide-react";
import "./TabBar.css";

const TABS = [
  { key: "map", label: "Карта", icon: Map },
  { key: "favorites", label: "Избранное", icon: Heart },
  { key: "profile", label: "Профиль", icon: User },
];

export default function TabBar({ active = "map", onChange }) {
  return (
    <nav className="tab-bar glass-strong">
      {TABS.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          className={`tab-item ${active === key ? "tab-active" : ""}`}
          onClick={() => onChange?.(key)}
        >
          <Icon size={22} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
