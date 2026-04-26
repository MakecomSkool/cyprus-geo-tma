/**
 * src/components/map/CategoryChips.jsx
 *
 * Horizontal-scrolling category filter chips.
 * Spec: 32px height, snap-x, active = filled primary.
 */

import { Trees, Utensils, ShoppingBag, Hotel, Landmark, Home, Waves, MapPin } from "lucide-react";
import useMapStore from "../../store/useMapStore";
import "./CategoryChips.css";

const CATEGORIES = [
  { key: null, label: "Все", icon: MapPin },
  { key: "park", label: "Парки", icon: Trees },
  { key: "beach", label: "Пляжи", icon: Waves },
  { key: "restaurant", label: "Еда", icon: Utensils },
  { key: "shop", label: "Магазины", icon: ShoppingBag },
  { key: "hotel", label: "Отели", icon: Hotel },
  { key: "attraction", label: "Достопр.", icon: Landmark },
  { key: "residential", label: "Жильё", icon: Home },
];

export default function CategoryChips() {
  const category = useMapStore((s) => s.category);
  const setCategory = useMapStore((s) => s.setCategory);

  return (
    <div className="chips-scroll">
      {CATEGORIES.map(({ key, label, icon: Icon }) => (
        <button
          key={key ?? "all"}
          className={`chip ${category === key ? "chip-active" : ""}`}
          onClick={() => setCategory(key)}
        >
          <Icon size={14} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
