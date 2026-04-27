/**
 * services/backend/src/routes/tiles.js
 *
 * Dynamic MVT (Mapbox Vector Tile) generation via PostGIS.
 * GET /api/tiles/:z/:x/:y.mvt
 *
 * Performance:
 *  - In-memory LRU cache (200 tiles, ~20MB RAM) — near-instant repeated requests
 *  - GiST spatial index makes ST_Intersects fast
 *  - Simplified geometry columns reduce tile size at low zoom
 *  - Empty tiles return 204 (saves bandwidth + avoids DB hit on cache miss too)
 */

import { pool } from "../db.js";

// ── Simple LRU tile cache ─────────────────────────────────────────────────
const CACHE_SIZE = 300;            // max tiles in memory
const CACHE_TTL  = 10 * 60 * 1000; // 10 minutes

class TileCache {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.map = new Map(); // key → { buf, ts, empty }
  }

  _evict() {
    // Remove oldest entry when full
    const oldest = this.map.keys().next().value;
    this.map.delete(oldest);
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL) {
      this.map.delete(key);
      return null;
    }
    // Move to end (LRU touch)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  set(key, buf, empty = false) {
    if (this.map.size >= this.maxSize) this._evict();
    this.map.set(key, { buf, empty, ts: Date.now() });
  }
}

const cache = new TileCache(CACHE_SIZE);

// ── Geometry column by zoom ───────────────────────────────────────────────
function pickGeomColumn(z) {
  if (z <= 11) return "geom_3857_simple_low";
  if (z <= 14) return "geom_3857_simple_mid";
  return "geom_3857";
}

// ── Handler ───────────────────────────────────────────────────────────────
async function getTile(request, reply) {
  const z = parseInt(request.params.z, 10);
  const x = parseInt(request.params.x, 10);
  const y = parseInt(request.params.y, 10);

  if (
    isNaN(z) || isNaN(x) || isNaN(y) ||
    z < 0 || z > 22 ||
    x < 0 || x >= Math.pow(2, z) ||
    y < 0 || y >= Math.pow(2, z)
  ) {
    return reply.code(400).send({ error: "Invalid tile coordinates" });
  }

  const cacheKey = `${z}/${x}/${y}`;

  // ── Cache hit ────────────────────────────────────────────────
  const cached = cache.get(cacheKey);
  if (cached) {
    if (cached.empty) return reply.code(204).send();
    return reply
      .header("Content-Type", "application/x-protobuf")
      .header("Content-Encoding", "identity")
      .header("Cache-Control", "public, max-age=600, s-maxage=3600")
      .header("X-Cache", "HIT")
      .send(cached.buf);
  }

  // ── DB query ─────────────────────────────────────────────────
  const geomCol = pickGeomColumn(z);

  const sql = `
    WITH
    bounds AS (
      SELECT ST_TileEnvelope($1, $2, $3) AS geom
    ),
    tile AS (
      SELECT
        p.wikimapia_id,
        p.name,
        COALESCE(p.category, 'wikimapia') AS category,
        LEFT(COALESCE(p.description, ''), 150) AS description,
        ST_AsMVTGeom(
          p.${geomCol},
          bounds.geom,
          4096, 64, true
        ) AS g
      FROM places p, bounds
      WHERE p.${geomCol} && bounds.geom
        AND ST_Intersects(p.${geomCol}, bounds.geom)
    )
    SELECT ST_AsMVT(tile, 'places', 4096, 'g') AS mvt
    FROM tile
    WHERE g IS NOT NULL
  `;

  try {
    const result = await pool.query(sql, [z, x, y]);
    const mvt = result.rows[0]?.mvt;

    if (!mvt || mvt.length === 0) {
      cache.set(cacheKey, null, true); // cache empty
      return reply.code(204).send();
    }

    const buf = Buffer.from(mvt);
    cache.set(cacheKey, buf, false);

    return reply
      .header("Content-Type", "application/x-protobuf")
      .header("Content-Encoding", "identity")
      .header("Cache-Control", "public, max-age=600, s-maxage=3600")
      .header("Access-Control-Allow-Origin", "*")
      .header("X-Cache", "MISS")
      .send(buf);

  } catch (err) {
    request.log.error({ err, z, x, y }, "Tile error");
    return reply.code(500).send({ error: "Tile generation failed" });
  }
}

export default async function tilesRoutes(fastify) {
  fastify.get("/api/tiles/:z/:x/:y.mvt", getTile);
}
