/**
 * src/components/ui/Button.jsx
 *
 * Primary action button — 3 variants: primary, secondary, ghost.
 * Supports loading state with spinner, disabled, and press animation.
 *
 * Touch target: min 50px height (Apple HIG compliant).
 */

import { Loader2 } from "lucide-react";
import "./Button.css";

export default function Button({
  children,
  variant = "primary",
  size = "default",
  disabled = false,
  isLoading = false,
  onClick,
  className = "",
  type = "button",
  ...rest
}) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} btn-${size} ${className}`}
      disabled={disabled || isLoading}
      onClick={onClick}
      {...rest}
    >
      {isLoading ? (
        <Loader2 className="btn-spinner" size={18} />
      ) : (
        children
      )}
    </button>
  );
}
