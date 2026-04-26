/**
 * src/components/ui/SearchInput.jsx
 *
 * Search pill — glassmorphism input with search icon.
 * Matches the "Search pill" spec: 44px height, r-xl, blur 24px.
 */

import { Search, X } from "lucide-react";
import "./SearchInput.css";

export default function SearchInput({
  value = "",
  onChange,
  onFocus,
  onBlur,
  onClear,
  placeholder = "Поиск места...",
  className = "",
  autoFocus = false,
}) {
  return (
    <div className={`search-input-wrap ${className}`}>
      <Search className="search-input-icon" size={18} />
      <input
        type="text"
        className="search-input"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        autoFocus={autoFocus}
        enterKeyHint="search"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      {value && (
        <button
          type="button"
          className="search-input-clear"
          onClick={() => {
            onChange?.("");
            onClear?.();
          }}
          aria-label="Clear search"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
