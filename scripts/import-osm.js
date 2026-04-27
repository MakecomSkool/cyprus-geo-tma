#!/usr/bin/env node
/**
 * scripts/import-osm.js
 *
 * Downloads Cyprus OSM data via Overpass API and imports into the
 * places table (PostGIS). Covers buildings, land-use zones, parks,
 * leisure areas, amenities, shops, tourism objects.
 *
 * Usage:
 *   node --env-file=.env scripts/import-osm.js
 *
 * Produces a Wikimapia-like coverage of the island with polygons.
 */

import pg from "pg";
import https from "node:https";
import http from "node:http";
import { createWriteStream, existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

const { Pool } = pg;

// ─── Config ──────────────────────────────────────────────────────────────────

const DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://cyprus:cyprus_dev_2026@localhost:5433/cyprus_geo";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const CACHE_FILE = "./scripts/osm_cache.json";

// Category mapping from OSM tags → our category/subcategory
const CATEGORY_MAP = [
  // Buildings
  { match: { building: "*" }, category: "building", subcategory: (t) => t.building || "yes" },
  // Land use
  { match: { landuse: "residential" }, category: "landuse", subcategory: "residential" },
  { match: { landuse: "commercial" }, category: "landuse", subcategory: "commercial" },
  { match: { landuse: "industrial" }, category: "landuse", subcategory: "industrial" },
  { match: { landuse: "retail" }, category: "landuse", subcategory: "retail" },
  { match: { landuse: "farmland" }, category: "landuse", subcategory: "farmland" },
  { match: { landuse: "forest" }, category: "landuse", subcategory: "forest" },
  { match: { landuse: "meadow" }, category: "landuse", subcategory: "meadow" },
  { match: { landuse: "vineyard" }, category: "landuse", subcategory: "vineyard" },
  // Natural
  { match: { natural: "wood" }, category: "natural", subcategory: "forest" },
  { match: { natural: "beach" }, category: "natural", subcategory: "beach" },
  { match: { natural: "water" }, category: "natural", subcategory: "water" },
  { match: { natural: "grassland" }, category: "natural", subcategory: "grassland" },
  { match: { natural: "scrub" }, category: "natural", subcategory: "scrub" },
  // Parks & leisure
  { match: { leisure: "park" }, category: "park", subcategory: "park" },
  { match: { leisure: "garden" }, category: "park", subcategory: "garden" },
  { match: { leisure: "playground" }, category: "leisure", subcategory: "playground" },
  { match: { leisure: "sports_centre" }, category: "leisure", subcategory: "sports" },
  { match: { leisure: "swimming_pool" }, category: "leisure", subcategory: "pool" },
  { match: { leisure: "pitch" }, category: "leisure", subcategory: "pitch" },
  { match: { leisure: "marina" }, category: "leisure", subcategory: "marina" },
  { match: { leisure: "golf_course" }, category: "leisure", subcategory: "golf" },
  // Amenities
  { match: { amenity: "school" }, category: "education", subcategory: "school" },
  { match: { amenity: "university" }, category: "education", subcategory: "university" },
  { match: { amenity: "hospital" }, category: "health", subcategory: "hospital" },
  { match: { amenity: "clinic" }, category: "health", subcategory: "clinic" },
  { match: { amenity: "pharmacy" }, category: "health", subcategory: "pharmacy" },
  { match: { amenity: "restaurant" }, category: "food", subcategory: "restaurant" },
  { match: { amenity: "cafe" }, category: "food", subcategory: "cafe" },
  { match: { amenity: "bar" }, category: "food", subcategory: "bar" },
  { match: { amenity: "fast_food" }, category: "food", subcategory: "fast_food" },
  { match: { amenity: "bank" }, category: "finance", subcategory: "bank" },
  { match: { amenity: "fuel" }, category: "transport", subcategory: "fuel" },
  { match: { amenity: "parking" }, category: "transport", subcategory: "parking" },
  { match: { amenity: "place_of_worship" }, category: "religion", subcategory: "worship" },
  { match: { amenity: "cinema" }, category: "leisure", subcategory: "cinema" },
  { match: { amenity: "theatre" }, category: "leisure", subcategory: "theatre" },
  { match: { amenity: "library" }, category: "education", subcategory: "library" },
  // Tourism
  { match: { tourism: "hotel" }, category: "tourism", subcategory: "hotel" },
  { match: { tourism: "attraction" }, category: "tourism", subcategory: "attraction" },
  { match: { tourism: "museum" }, category: "tourism", subcategory: "museum" },
  { match: { tourism: "viewpoint" }, category: "tourism", subcategory: "viewpoint" },
  { match: { tourism: "information" }, category: "tourism", subcategory: "info" },
  // Shop
  { match: { shop: "*" }, category: "shop", subcategory: (t) => t.shop || "retail" },
  // Historic
  { match: { historic: "*" }, category: "historic", subcategory: (t) => t.historic || "site" },
  // Boundaries / admin
  { match: { boundary: "administrative" }, category: "boundary", subcategory: (t) => `admin_${t.admin_level || "x"}` },
  // Military
  { match: { military: "*" }, category: "military", subcategory: (t) => t.military || "area" },
];

// ─── Overpass Queries ─────────────────────────────────────────────────────────

// We run multiple queries to avoid Overpass timeout. Cyprus bbox: 32.2,34.5,34.7,35.8
const CYPRUS_BBOX = "34.5,32.2,35.8,34.7"; // lat_min,lon_min,lat_max,lon_max (Overpass format)

const QUERIES = [
  {
    name: "buildings",
    query: `
[out:json][timeout:120];
(
  way["building"](${CYPRUS_BBOX});
  relation["building"]["type"="multipolygon"](${CYPRUS_BBOX});
);
out geom;`,
  },
  {
    name: "landuse_parks_leisure",
    query: `
[out:json][timeout:120];
(
  way["landuse"](${CYPRUS_BBOX});
  way["leisure"~"park|garden|playground|sports_centre|swimming_pool|pitch|marina|golf_course"](${CYPRUS_BBOX});
  way["natural"~"wood|beach|water|grassland|scrub"](${CYPRUS_BBOX});
  relation["landuse"]["type"="multipolygon"](${CYPRUS_BBOX});
);
out geom;`,
  },
  {
    name: "amenities_tourism",
    query: `
[out:json][timeout:120];
(
  way["amenity"](${CYPRUS_BBOX});
  way["tourism"](${CYPRUS_BBOX});
  way["shop"](${CYPRUS_BBOX});
  way["historic"](${CYPRUS_BBOX});
);
out geom;`,
  },
  {
    name: "admin_boundaries",
    query: `
[out:json][timeout:120];
(
  relation["boundary"="administrative"]["admin_level"~"^[4-8]$"](${CYPRUS_BBOX});
);
out geom;`,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg, color = "\x1b[37m") {
  console.log(`${color}${msg}\x1b[0m`);
}

async function overpassFetch(query) {
  return new Promise((resolve, reject) => {
    const body = `data=${encodeURIComponent(query)}`;
    const opts = {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        "User-Agent": "CyprusGeoTMA/1.0",
      },
    };
    const req = https.request(OVERPASS_URL, opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${chunks.join("")}`));
        } else {
          try {
            resolve(JSON.parse(chunks.join("")));
          } catch (e) {
            reject(new Error("JSON parse error: " + e.message));
          }
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/** Categorise an OSM element by its tags */
function categorise(tags) {
  for (const rule of CATEGORY_MAP) {
    const [key, val] = Object.entries(rule.match)[0];
    if (tags[key] && (val === "*" || tags[key] === val)) {
      return {
        category: rule.category,
        subcategory:
          typeof rule.subcategory === "function"
            ? rule.subcategory(tags)
            : rule.subcategory,
      };
    }
  }
  return { category: null, subcategory: null };
}

/** Convert OSM element geometry → WKT polygon/multipolygon */
function osmToWkt(element) {
  try {
    if (element.type === "way" && element.geometry?.length >= 4) {
      const coords = element.geometry
        .map((n) => `${n.lon} ${n.lat}`)
        .join(", ");
      return `POLYGON((${coords}))`;
    }
    if (element.type === "relation" && element.members) {
      // Build outer ring(s) from outer members
      const outer = element.members
        .filter((m) => m.role === "outer" && m.geometry?.length >= 4)
        .map((m) => {
          const coords = m.geometry.map((n) => `${n.lon} ${n.lat}`).join(", ");
          return `(${coords})`;
        });
      if (outer.length === 0) return null;
      return outer.length === 1
        ? `POLYGON(${outer[0]})`
        : `MULTIPOLYGON(${outer.map((r) => `(${r})`).join(", ")})`;
    }
    return null;
  } catch {
    return null;
  }
}

/** Build a human-readable name from OSM tags */
function buildName(tags, osmId) {
  return (
    tags["name:en"] ||
    tags.name ||
    tags["name:el"] ||
    tags["name:ru"] ||
    tags.ref ||
    `OSM:${osmId}`
  );
}

/** Build description from OSM tags */
function buildDescription(tags) {
  const parts = [];
  if (tags.description) parts.push(tags.description);
  if (tags.opening_hours) parts.push(`Hours: ${tags.opening_hours}`);
  if (tags.phone) parts.push(`Phone: ${tags.phone}`);
  if (tags.website) parts.push(`Web: ${tags.website}`);
  if (tags.addr_street || tags["addr:street"]) {
    const street = tags["addr:street"] || tags.addr_street;
    const num = tags["addr:housenumber"] || "";
    parts.push(`Address: ${street}${num ? " " + num : ""}`);
  }
  return parts.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log("\n🗺️  Cyprus OSM Importer", "\x1b[36m");
  log("══════════════════════════════════════════", "\x1b[36m");

  const pool = new Pool({ connectionString: DB_URL });

  // Test connection
  try {
    await pool.query("SELECT 1");
    log("✅ Database connected", "\x1b[32m");
  } catch (e) {
    log(`❌ DB error: ${e.message}`, "\x1b[31m");
    process.exit(1);
  }

  let totalInserted = 0;
  let totalSkipped = 0;

  for (const { name, query } of QUERIES) {
    log(`\n📡 Fetching: ${name}...`, "\x1b[33m");

    let data;
    try {
      data = await overpassFetch(query);
      log(`   Got ${data.elements?.length ?? 0} elements`, "\x1b[32m");
    } catch (e) {
      log(`   ⚠️  Overpass error: ${e.message} — skipping`, "\x1b[31m");
      continue;
    }

    const elements = data.elements || [];
    let batchInserted = 0;
    let batchSkipped = 0;

    for (const el of elements) {
      const tags = el.tags || {};
      if (!tags.name && !tags["name:en"] && Object.keys(tags).length < 2) {
        batchSkipped++;
        continue; // skip featureless elements
      }

      const wkt = osmToWkt(el);
      if (!wkt) {
        batchSkipped++;
        continue;
      }

      const osmId = el.type === "way" ? el.id : el.id * -1; // negative for relations
      const osmSourceUrl = `https://www.openstreetmap.org/${el.type}/${Math.abs(osmId)}`;
      const nameVal = buildName(tags, Math.abs(osmId));
      const description = buildDescription(tags);
      const { category, subcategory } = categorise(tags);

      try {
        await pool.query(
          `INSERT INTO places
             (name, description, geom, category, subcategory, source_url, photos)
           VALUES
             ($1, $2, ST_GeomFromText($3, 4326), $4, $5, $6, '{}')
           ON CONFLICT DO NOTHING`,
          [nameVal, description, wkt, category, subcategory, osmSourceUrl]
        );
        batchInserted++;
      } catch (e) {
        // likely invalid geometry – skip silently
        batchSkipped++;
      }
    }

    totalInserted += batchInserted;
    totalSkipped += batchSkipped;
    log(
      `   ✅ ${batchInserted} inserted, ${batchSkipped} skipped`,
      "\x1b[32m"
    );
  }

  // Update stats
  log("\n🔄 Running ANALYZE on places table...", "\x1b[33m");
  await pool.query("ANALYZE places;");

  const { rows } = await pool.query("SELECT COUNT(*) FROM places;");
  const total = rows[0].count;

  log(
    `\n🎉 Import complete!`,
    "\x1b[32m"
  );
  log(`   Total inserted this run : ${totalInserted}`, "\x1b[32m");
  log(`   Total skipped           : ${totalSkipped}`, "\x1b[33m");
  log(`   Total in DB             : ${total}`, "\x1b[36m");
  log(
    `\n   Refresh the map at http://localhost/ to see all polygons!`,
    "\x1b[36m"
  );

  await pool.end();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
