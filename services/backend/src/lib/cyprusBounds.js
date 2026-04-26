/**
 * services/backend/src/lib/cyprusBounds.js
 *
 * Geographic bounds for Cyprus (including Northern Cyprus).
 * ~3km buffer around the island for swipe-bounce tolerance.
 */

export const CYPRUS_BBOX = {
  minLon: 32.20,
  minLat: 34.50,
  maxLon: 34.65,
  maxLat: 35.75,
};

/**
 * Returns true if the given bbox at least partially overlaps Cyprus.
 * Used to reject obvious out-of-region requests.
 */
export function bboxIntersectsCyprus(minLon, minLat, maxLon, maxLat) {
  return !(
    maxLon < CYPRUS_BBOX.minLon ||
    minLon > CYPRUS_BBOX.maxLon ||
    maxLat < CYPRUS_BBOX.minLat ||
    minLat > CYPRUS_BBOX.maxLat
  );
}

/**
 * Clamp an arbitrary bbox to Cyprus bounds.
 */
export function clampBbox(minLon, minLat, maxLon, maxLat) {
  return [
    Math.max(minLon, CYPRUS_BBOX.minLon),
    Math.max(minLat, CYPRUS_BBOX.minLat),
    Math.min(maxLon, CYPRUS_BBOX.maxLon),
    Math.min(maxLat, CYPRUS_BBOX.maxLat),
  ];
}
