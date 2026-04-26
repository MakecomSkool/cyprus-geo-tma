/**
 * src/components/ui/IconButton.jsx
 *
 * Circular icon button — min 44x44 touch target (Apple HIG).
 * Uses scale(0.92) press animation for tactile feedback.
 */

import "./IconButton.css";

export default function IconButton({
  children,
  onClick,
  size = 44,
  label,
  className = "",
  disabled = false,
  variant = "default",
  ...rest
}) {
  return (
    <button
      type="button"
      className={`icon-btn icon-btn-${variant} ${className}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{ width: size, height: size }}
      {...rest}
    >
      {children}
    </button>
  );
}
