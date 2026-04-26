/**
 * src/components/ui/Skeleton.jsx
 *
 * Shimmer skeleton loader — accepts width/height/borderRadius.
 * Gradient sweep animation (1.5s loop) like Facebook/Instagram.
 */

import "./Skeleton.css";

export default function Skeleton({
  width = "100%",
  height = 16,
  borderRadius = 8,
  className = "",
  circle = false,
  style = {},
}) {
  const size = circle ? (typeof height === "number" ? height : 40) : undefined;

  return (
    <div
      className={`skeleton ${className}`}
      style={{
        width: circle ? size : width,
        height: circle ? size : height,
        borderRadius: circle ? "50%" : borderRadius,
        ...style,
      }}
    />
  );
}

/**
 * Pre-made skeleton layouts for common use cases.
 */
export function SkeletonText({ lines = 3, gap = 8 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          height={14}
          width={i === lines - 1 ? "60%" : "100%"}
          borderRadius={7}
        />
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}>
      <Skeleton height={200} borderRadius={12} />
      <Skeleton height={20} width="70%" borderRadius={10} />
      <Skeleton height={14} width="40%" borderRadius={7} />
      <SkeletonText lines={2} />
    </div>
  );
}
