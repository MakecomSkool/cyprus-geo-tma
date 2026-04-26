/**
 * services/backend/src/routes/search.js
 *
 * GET /api/search?q=...&category=...&bbox=...&near=lat,lon&limit=20
 *
 * Full-text search using tsvector (weighted A=name, B=description)
 * with trigram fallback for fuzzy matching.
 * Supports category filter, bbox constraint, and distance sort.
 */

import { query } from "../db.js";

/**
 * Parse bbox string "minLon,minLat,maxLon,maxLat" → array or null.
 */
function parseBbox(raw) {
  if (!raw) return null;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return null;
  return parts;
}

/**
 * Parse near string "lat,lon" → { lat, lon } or null.
 */
function parseNear(raw) {
  if (!raw) return null;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 2 || parts.some(isNaN)) return null;
  return { lat: parts[0], lon: parts[1] };
}

async function searchPlaces(request, reply) {
  const q = (request.query.q || "").trim();
  const category = request.query.category || null;
  const bbox = parseBbox(request.query.bbox);
  const near = parseNear(request.query.near);
  const limit = Math.min(Math.max(parseInt(request.query.limit || "20", 10), 1), 100);

  if (!q && !category && !bbox) {
    return reply.code(400).send({
      error: "At least one of q, category, or bbox is required",
    });
  }

  const params = [];
  const conditions = ["p.centroid IS NOT NULL"];
  const selects = [
    "p.id",
    "p.name",
    "p.category",
    "ST_Y(p.centroid) AS lat",
    "ST_X(p.centroid) AS lon",
    "COALESCE(ps.rating_avg, 0) AS rating",
  ];
  let orderBy = "p.name";

  // ── Full-text search (tsvector + trigram fallback) ──────────
  if (q) {
    params.push(q);
    const paramIdx = params.length;

    // tsvector match OR trigram similarity > 0.2
    conditions.push(`(
      p.search_tsv @@ plainto_tsquery('simple', $${paramIdx})
      OR similarity(p.name, $${paramIdx}) > 0.2
    )`);

    // Rank: tsvector rank + trigram similarity blended
    selects.push(`(
      ts_rank(p.search_tsv, plainto_tsquery('simple', $${paramIdx})) * 2
      + similarity(p.name, $${paramIdx})
    ) AS rank`);

    // Highlight: headline for name and description
    // NOTE: we strip HTML tags server-side to prevent XSS.
    // Frontend should use these as plain text (mark positions client-side).
    selects.push(`regexp_replace(
      ts_headline('simple', p.name, plainto_tsquery('simple', $${paramIdx}),
        'StartSel=«, StopSel=», MaxFragments=1'),
      '<[^>]*>', '', 'g'
    ) AS hl_name`);
    selects.push(`regexp_replace(
      ts_headline('simple', COALESCE(p.description, ''), plainto_tsquery('simple', $${paramIdx}),
        'StartSel=«, StopSel=», MaxFragments=1, MaxWords=20'),
      '<[^>]*>', '', 'g'
    ) AS hl_desc`);

    orderBy = "rank DESC";
  }

  // ── Category filter ────────────────────────────────────────
  if (category) {
    params.push(category);
    conditions.push(`p.category = $${params.length}`);
  }

  // ── Bbox constraint ────────────────────────────────────────
  if (bbox) {
    params.push(bbox[0], bbox[1], bbox[2], bbox[3]);
    const i = params.length;
    conditions.push(
      `p.centroid && ST_MakeEnvelope($${i - 3}, $${i - 2}, $${i - 1}, $${i}, 4326)`
    );
  }

  // ── Distance from point ────────────────────────────────────
  if (near) {
    params.push(near.lon, near.lat);
    const i = params.length;
    selects.push(
      `ST_Distance(p.centroid::geography, ST_SetSRID(ST_MakePoint($${i - 1}, $${i}), 4326)::geography) AS distance_m`
    );
    if (!q) {
      orderBy = "distance_m ASC";
    }
  }

  // ── Count total matches ────────────────────────────────────
  const countSql = `
    SELECT COUNT(*) AS total
    FROM places p
    LEFT JOIN place_stats ps ON ps.place_id = p.id
    WHERE ${conditions.join(" AND ")}
  `;
  const countResult = await query(countSql, params);
  const total = parseInt(countResult.rows[0].total, 10);

  // ── Fetch results ──────────────────────────────────────────
  params.push(limit);
  const sql = `
    SELECT ${selects.join(", ")}
    FROM places p
    LEFT JOIN place_stats ps ON ps.place_id = p.id
    WHERE ${conditions.join(" AND ")}
    ORDER BY ${orderBy}
    LIMIT $${params.length}
  `;

  const result = await query(sql, params);

  const results = result.rows.map((r) => {
    const item = {
      id: r.id,
      name: r.name,
      category: r.category || null,
      rating: r.rating ? parseFloat(r.rating) : null,
      centroid: { lat: parseFloat(r.lat), lon: parseFloat(r.lon) },
    };

    if (r.distance_m !== undefined) {
      item.distanceM = Math.round(parseFloat(r.distance_m));
    }

    if (r.hl_name || r.hl_desc) {
      item.highlight = {};
      if (r.hl_name) item.highlight.name = r.hl_name;
      if (r.hl_desc) item.highlight.description = r.hl_desc;
    }

    return item;
  });

  return { results, total };
}

export default async function searchRoutes(fastify) {
  fastify.get("/api/search", searchPlaces);
}
