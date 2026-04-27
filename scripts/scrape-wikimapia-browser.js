#!/usr/bin/env node
/**
 * scripts/scrape-wikimapia-browser.js
 *
 * Intercepts Wikimapia's own API calls as the page renders the map.
 * Wikimapia loads polygon data via XHR to their internal API endpoint.
 * We intercept these responses to get 100% accurate polygon data.
 *
 * Strategy:
 * 1. Open Chromium via Playwright (real browser, bypasses bot detection)
 * 2. Navigate to Wikimapia map tiles of Cyprus
 * 3. Intercept all XHR/fetch responses from api.wikimapia.org or /api/
 * 4. Parse the polygon GeoJSON/JSON from responses
 * 5. INSERT directly into PostGIS
 *
 * Usage:
 *   node scripts/scrape-wikimapia-browser.js
 */

import pg from "pg";
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const { Pool } = pg;

const DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://cyprus:cyprus_dev_2026@localhost:5433/cyprus_geo";

const CHECKPOINT_FILE = "./scripts/wm_browser_checkpoint.json";
const DATA_DIR = "./scripts/wm_raw";

// Cyprus grid: tile coordinates at zoom 14 covering the island
// Wikimapia shows polygons starting from zoom 12
// We'll scroll through bboxes at zoom 13 to get full coverage
const CYPRUS = {
  minLon: 32.20, minLat: 34.50, maxLon: 34.65, maxLat: 35.75,
};
const TILE_DEG = 0.3; // ~30km tiles at zoom 13

function generateGrid() {
  const tiles = [];
  let id = 0;
  for (let lon = CYPRUS.minLon; lon < CYPRUS.maxLon; lon += TILE_DEG) {
    for (let lat = CYPRUS.minLat; lat < CYPRUS.maxLat; lat += TILE_DEG) {
      const centerLon = lon + TILE_DEG / 2;
      const centerLat = lat + TILE_DEG / 2;
      tiles.push({ id: String(id++), centerLon, centerLat });
    }
  }
  return tiles;
}

function loadCheckpoint() {
  if (existsSync(CHECKPOINT_FILE)) {
    try { return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf8")); }
    catch { return { done: [], places: {} }; }
  }
  return { done: [], places: {} };
}
function saveCheckpoint(cp) {
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp), "utf8");
}

function log(msg, color = "\x1b[37m") {
  console.log(color + msg + "\x1b[0m");
}

// Parse polygon from Wikimapia API response formats
function extractPolygons(data) {
  const results = [];

  // Format 1: Array of places
  const items = Array.isArray(data) ? data
    : Array.isArray(data?.places) ? data.places
    : Array.isArray(data?.response) ? data.response
    : data?.features ? data.features // GeoJSON
    : [];

  for (const item of items) {
    try {
      const id = item.id || item.wikimapia_id || item.properties?.id;
      if (!id) continue;

      let name = item.title || item.name || item.properties?.title || item.properties?.name || `Wikimapia #${id}`;
      let description = item.description || item.properties?.description || "";
      let url = `http://wikimapia.org/#lang=en&id=${id}`;

      let coords = null;

      // GeoJSON Feature
      if (item.type === "Feature" && item.geometry) {
        const g = item.geometry;
        if (g.type === "Polygon" && g.coordinates?.[0]?.length >= 4) {
          const pts = g.coordinates[0].map(([lon, lat]) => `${lon} ${lat}`).join(", ");
          coords = `POLYGON((${pts}))`;
        } else if (g.type === "MultiPolygon") {
          const rings = g.coordinates.map(poly =>
            `(${poly[0].map(([lon, lat]) => `${lon} ${lat}`).join(", ")})`
          );
          coords = `MULTIPOLYGON(${rings.map(r => `(${r})`).join(", ")})`;
        }
      }

      // Wikimapia internal format: polygon as array of {x, y} or [lon, lat]
      if (!coords && item.polygon) {
        const poly = item.polygon;
        const pts = poly.map(p =>
          Array.isArray(p) ? `${p[0]} ${p[1]}` : `${p.x || p.lon} ${p.y || p.lat}`
        );
        if (pts.length >= 4) coords = `POLYGON((${pts.join(", ")}))`;
      }

      // Alternative: coords array
      if (!coords && item.coords) {
        const poly = item.coords;
        const pts = Array.isArray(poly[0])
          ? poly.map(([lon, lat]) => `${lon} ${lat}`)
          : poly.map(p => `${p.x} ${p.y}`);
        if (pts.length >= 4) coords = `POLYGON((${pts.join(", ")}))`;
      }

      if (!coords) continue;

      results.push({ id: String(id), name, description, url, coords });
    } catch {
      continue;
    }
  }
  return results;
}

async function insertPlaces(pool, places, checkpoint) {
  let inserted = 0;
  for (const p of places) {
    if (checkpoint.places[p.id]) continue; // already inserted
    try {
      await pool.query(
        `INSERT INTO places (wikimapia_id, name, description, geom, source_url, photos, category)
         VALUES ($1, $2, $3, ST_GeomFromText($4, 4326), $5, '{}', 'wikimapia')
         ON CONFLICT (wikimapia_id) DO UPDATE
           SET name = EXCLUDED.name, updated_at = now()`,
        [parseInt(p.id), p.name, p.description, p.coords, p.url]
      );
      checkpoint.places[p.id] = true;
      inserted++;
    } catch {
      // invalid geometry or duplicate — skip
    }
  }
  return inserted;
}

async function main() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  log("\n🌍 Wikimapia Browser Scraper (Playwright)", "\x1b[36m");
  log("══════════════════════════════════════════════", "\x1b[36m");

  const pool = new Pool({ connectionString: DB_URL });
  await pool.query("SELECT 1");
  log("✅ Database connected", "\x1b[32m");

  const checkpoint = loadCheckpoint();
  const doneSet = new Set(checkpoint.done);
  const tiles = generateGrid();
  const remaining = tiles.filter(t => !doneSet.has(t.id));

  log(`📊 ${tiles.length} tiles total, ${remaining.length} remaining`, "\x1b[33m");
  log(`🔢 Already collected: ${Object.keys(checkpoint.places).length} places`, "\x1b[32m");

  // Launch real Chromium browser
  log("\n🌐 Launching Chromium...", "\x1b[33m");
  const browser = await chromium.launch({
    headless: true, // set false to watch it
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();

  // Intercept all network responses to find Wikimapia API data
  const collectedForTile = [];

  page.on("response", async (response) => {
    const url = response.url();
    // Only intercept Wikimapia API calls
    if (
      (url.includes("wikimapia.org") || url.includes("api.wikimapia.org")) &&
      (url.includes("/api/") || url.includes("function=box") || url.includes("function=place") || url.includes("?data[0]"))
    ) {
      try {
        const contentType = response.headers()["content-type"] || "";
        if (!contentType.includes("json") && !contentType.includes("javascript")) return;

        const text = await response.text();
        if (!text || text.length < 10) return;

        // Try to parse JSON
        let data;
        // Handle JSONP: wm_places({...}) or similar
        const jsonpMatch = text.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(([\s\S]+)\)\s*;?\s*$/);
        if (jsonpMatch) {
          data = JSON.parse(jsonpMatch[1]);
        } else {
          data = JSON.parse(text);
        }

        const places = extractPolygons(data);
        if (places.length > 0) {
          collectedForTile.push(...places);
          log(`   📦 Intercepted ${places.length} places from: ${url.substring(0, 80)}`, "\x1b[32m");
        }
      } catch {
        // Not JSON or parse error — skip
      }
    }
  });

  let totalInserted = 0;

  for (let i = 0; i < remaining.length; i++) {
    const tile = remaining[i];
    const pct = Math.round(((i + 1) / remaining.length) * 100);

    log(`\n[${pct}%] Tile ${i + 1}/${remaining.length} center: ${tile.centerLat.toFixed(4)}, ${tile.centerLon.toFixed(4)}`, "\x1b[36m");

    collectedForTile.length = 0; // clear

    // Navigate to Wikimapia at this location (zoom 14 = individual buildings visible)
    const wmUrl = `http://wikimapia.org/#lang=en&lat=${tile.centerLat}&lon=${tile.centerLon}&z=14&m=w`;
    try {
      await page.goto(wmUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      // Wait for map to load and API calls to complete
      await page.waitForTimeout(5000);

      // Also try scrolling to trigger more tiles
      // Pan slightly to trigger adjacent tile loads
      await page.mouse.move(640, 450);
      await page.waitForTimeout(1000);

      // Insert whatever we collected
      if (collectedForTile.length > 0) {
        const inserted = await insertPlaces(pool, collectedForTile, checkpoint);
        totalInserted += inserted;
        log(`   ✅ Inserted ${inserted} new places (total: ${totalInserted})`, "\x1b[32m");
      } else {
        log(`   ⚠️  No API responses intercepted`, "\x1b[33m");
      }

      checkpoint.done.push(tile.id);
      saveCheckpoint(checkpoint);
    } catch (e) {
      log(`   ❌ Error: ${e.message}`, "\x1b[31m");
    }

    // Small delay between tiles
    await page.waitForTimeout(2000);
  }

  await browser.close();
  await pool.query("ANALYZE places;");

  const { rows } = await pool.query("SELECT COUNT(*) FROM places;");
  log(`\n🎉 Complete! Total in DB: ${rows[0].count}`, "\x1b[32m");
  await pool.end();
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
