/**
 * src/lib/api.js — REST API client for the backend.
 * Reads VITE_API_URL from env (or uses relative path via Vite proxy).
 */

const API_BASE = import.meta.env.VITE_API_URL || "";

function getInitData() {
  try {
    return window.Telegram?.WebApp?.initData || "";
  } catch {
    return "";
  }
}

async function request(path, options = {}) {
  const initData = getInitData();
  const headers = { ...options.headers };
  if (initData) {
    headers["X-Telegram-Init-Data"] = initData;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch places/clusters for a bounding box + zoom level.
 * Uses the new LOD endpoint.
 */
export async function fetchClusters(bbox, zoom, { category, q } = {}) {
  const params = new URLSearchParams({
    bbox: bbox.join(","),
    zoom: String(zoom),
  });
  if (category) params.set("category", category);
  if (q) params.set("q", q);
  return request(`/api/places/clusters?${params}`);
}

/**
 * Fetch places in a bounding box (legacy, still used for full polygons).
 */
export async function fetchPlaces(bbox) {
  return request(`/api/places?bbox=${bbox.join(",")}`);
}

/**
 * Fetch full details for a single place.
 */
export async function fetchPlaceDetails(placeId) {
  return request(`/api/places/${placeId}`);
}

/**
 * Fetch messages for a place with keyset pagination.
 */
export async function fetchMessages(placeId, { cursor, limit = 50 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return request(`/api/places/${placeId}/messages?${params}`);
}

/**
 * Search places by text, category, bbox, and/or proximity.
 */
export async function searchPlaces({ q, category, bbox, near, limit = 20 } = {}) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (category) params.set("category", category);
  if (bbox) params.set("bbox", bbox.join(","));
  if (near) params.set("near", `${near.lat},${near.lon}`);
  params.set("limit", String(limit));
  return request(`/api/search?${params}`);
}

/**
 * Fetch reviews for a place with pagination and stats.
 */
export async function fetchReviews(placeId, { cursor, limit = 20, sort = "recent" } = {}) {
  const params = new URLSearchParams({ limit: String(limit), sort });
  if (cursor) params.set("cursor", cursor);
  return request(`/api/places/${placeId}/reviews?${params}`);
}

/**
 * Submit a review (creates or updates via UPSERT).
 */
export async function submitReview(placeId, { rating, body }) {
  return request(`/api/places/${placeId}/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating, body }),
  });
}

/**
 * Fetch current user profile, stats, favorites.
 */
export async function fetchProfile() {
  return request("/api/users/me");
}

/**
 * Add place to favorites.
 */
export async function addFavorite(placeId, listType = "loved") {
  return request("/api/favorites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ placeId, listType }),
  });
}

/**
 * Remove place from favorites.
 */
export async function removeFavorite(placeId) {
  return request(`/api/favorites/${placeId}`, { method: "DELETE" });
}


