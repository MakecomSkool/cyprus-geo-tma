#!/usr/bin/env node
/**
 * scripts/import-wikimapia.js
 *
 * Scrapes Wikimapia KML API for Cyprus and imports polygons into PostGIS.
 * Uses the same endpoint as the Python scraper: http://wikimapia.org/d?BBOX=
 *
 * Usage:
 *   node scripts/import-wikimapia.js
 *
 * The scraper tiles Cyprus into a grid and fetches each tile.
 * Checkpoints are saved so you can resume if interrupted.
 */

import pg from "pg";
import https from "node:https";
import http from "node:http";
import { XMLParser } from "fast-xml-parser";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const { Pool } = pg;

// ─── Config ──────────────────────────────────────────────────────────────────

const DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://cyprus:cyprus_dev_2026@localhost:5433/cyprus_geo";

const CHECKPOINT_FILE = "./scripts/wikimapia_checkpoint.json";

// Cyprus bounding box
const CYPRUS = { minLon: 32.20, minLat: 34.50, maxLon: 34.65, maxLat: 35.75 };

// Tile size in degrees (~15km at Cyprus latitude) — smaller = more places per tile
const TILE_SIZE = 0.15;

// Delay between requests (ms) — Wikimapia rate limits aggressively
const DELAY_MS = 2000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
};

function log(msg, color = C.reset) {
  process.stdout.write(color + msg + C.reset + "\n");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Generate grid tiles covering Cyprus */
function generateGrid() {
  const tiles = [];
  let i = 0;
  for (let lon = CYPRUS.minLon; lon < CYPRUS.maxLon; lon += TILE_SIZE) {
    for (let lat = CYPRUS.minLat; lat < CYPRUS.maxLat; lat += TILE_SIZE) {
      const minLon = Math.round(lon * 10000) / 10000;
      const minLat = Math.round(lat * 10000) / 10000;
      const maxLon = Math.round(Math.min(lon + TILE_SIZE, CYPRUS.maxLon) * 10000) / 10000;
      const maxLat = Math.round(Math.min(lat + TILE_SIZE, CYPRUS.maxLat) * 10000) / 10000;
      tiles.push({
        id: `${i++}`,
        bbox: `${minLon},${minLat},${maxLon},${maxLat}`,
      });
    }
  }
  return tiles;
}

/** Fetch Wikimapia KML for a bbox */
async function fetchWikimapia(bbox, page = 1, retries = 3) {
  const url = `http://wikimapia.org/d?BBOX=${bbox}&page=${page}&count=200`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const data = await new Promise((resolve, reject) => {
        const req = http.get(
          url,
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
              Accept: "*/*",
              Referer: "http://wikimapia.org/",
              Cookie: "verified=1",
            },
            timeout: 30000,
          },
          (res) => {
            // Handle redirect
            if (res.statusCode === 301 || res.statusCode === 302) {
              reject(new Error(`Redirect to ${res.headers.location}`));
              return;
            }
            // 218 = verification challenge
            if (res.statusCode === 218) {
              resolve({ status: 218, body: "" });
              return;
            }
            if (res.statusCode === 429) {
              resolve({ status: 429, body: "" });
              return;
            }
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () =>
              resolve({ status: res.statusCode, body: chunks.join("") })
            );
          }
        );
        req.on("error", reject);
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("timeout"));
        });
      });

      if (data.status === 429) {
        log(`   ⚠️  Rate limited — waiting 30s...`, C.yellow);
        await sleep(30000);
        continue;
      }

      if (data.status === 218) {
        log(`   ℹ️  Verification challenge — retrying`, C.dim);
        await sleep(2000);
        continue;
      }

      return data.body;
    } catch (e) {
      if (attempt < retries) {
        log(`   ⚠️  Error (attempt ${attempt}): ${e.message} — retrying`, C.yellow);
        await sleep(5000 * attempt);
      } else {
        throw e;
      }
    }
  }
  return "";
}

/** Parse KML text → array of place objects */
function parseKml(kmlText) {
  if (!kmlText || kmlText.length < 10) return [];

  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      cdataPropName: "__cdata",
      parseAttributeValue: false,
    });
    const obj = parser.parse(kmlText);
    const doc = obj?.kml?.Document || obj?.kml?.Folder || obj?.kml;
    if (!doc) return [];

    let placemarks = doc.Placemark || [];
    if (!Array.isArray(placemarks)) placemarks = [placemarks];

    const places = [];
    for (const pm of placemarks) {
      if (!pm) continue;

      // Wikimapia ID
      const pmId = pm["@_id"] || "";
      const wikimapiaId = pmId.startsWith("wm")
        ? parseInt(pmId.slice(2), 10)
        : null;
      if (!wikimapiaId) continue;

      // Name
      let name = "";
      if (pm.name) name = String(pm.name).trim();

      // Description (CDATA)
      let description = "";
      let sourceUrl = `http://wikimapia.org/#lang=en&lat=0&lon=0&z=14&m=w&id=${wikimapiaId}`;
      if (pm.description) {
        const raw = String(pm.description.__cdata || pm.description || "").trim();
        // Extract name from CDATA if element name is empty
        const textMatch = raw.match(/^([^<]+)/);
        if (textMatch && !name) {
          name = textMatch[1].trim();
        }
        // Extract URL
        const urlMatch = raw.match(/href='([^']+)'/);
        if (urlMatch) {
          sourceUrl = urlMatch[1].replace(/#ge$/, "");
        }
      }
      if (!name) name = `Wikimapia #${wikimapiaId}`;

      // Coordinates from LineString or LinearRing
      let coords = null;
      const geom =
        pm.Polygon?.outerBoundaryIs?.LinearRing?.coordinates ||
        pm.LineString?.coordinates ||
        pm.MultiGeometry?.Polygon?.outerBoundaryIs?.LinearRing?.coordinates ||
        null;

      if (geom) {
        const text = String(geom).trim();
        const points = [];
        for (const line of text.split(/\s+/)) {
          const parts = line.trim().split(",");
          if (parts.length >= 2) {
            const lon = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            if (!isNaN(lon) && !isNaN(lat)) {
              points.push(`${lon} ${lat}`);
            }
          }
        }
        if (points.length >= 4) {
          coords = `POLYGON((${points.join(", ")}))`;
        }
      }

      if (!coords) continue;

      places.push({ wikimapiaId, name, description, sourceUrl, coords });
    }
    return places;
  } catch (e) {
    return [];
  }
}

// ─── DB Insert ────────────────────────────────────────────────────────────────

async function insertPlaces(pool, places) {
  let inserted = 0;
  let skipped = 0;

  for (const p of places) {
    try {
      const res = await pool.query(
        `INSERT INTO places
           (wikimapia_id, name, description, geom, source_url, photos, category)
         VALUES
           ($1, $2, $3, ST_GeomFromText($4, 4326), $5, '{}', 'wikimapia')
         ON CONFLICT (wikimapia_id) DO UPDATE
           SET name = EXCLUDED.name,
               description = EXCLUDED.description,
               updated_at = now()`,
        [p.wikimapiaId, p.name, p.description, p.coords, p.sourceUrl]
      );
      if (res.rowCount > 0) inserted++;
      else skipped++;
    } catch (e) {
      skipped++; // invalid geometry etc.
    }
  }
  return { inserted, skipped };
}

// ─── Checkpoint ───────────────────────────────────────────────────────────────

function loadCheckpoint() {
  if (existsSync(CHECKPOINT_FILE)) {
    try {
      return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf8"));
    } catch {
      return { done: [], total: 0 };
    }
  }
  return { done: [], total: 0 };
}

function saveCheckpoint(state) {
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(state), "utf8");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log("\n🗺️  Wikimapia → Cyprus DB Importer", C.cyan);
  log("══════════════════════════════════════════", C.cyan);

  // Check fast-xml-parser is available
  try {
    await import("fast-xml-parser");
  } catch {
    log("Installing fast-xml-parser...", C.yellow);
    const { execSync } = await import("node:child_process");
    execSync("npm install fast-xml-parser", { cwd: "./scripts", stdio: "inherit" });
  }

  const pool = new Pool({ connectionString: DB_URL });
  try {
    await pool.query("SELECT 1");
    log("✅ Database connected", C.green);
  } catch (e) {
    log(`❌ DB error: ${e.message}`, C.red);
    process.exit(1);
  }

  const tiles = generateGrid();
  const checkpoint = loadCheckpoint();
  const doneSet = new Set(checkpoint.done);
  const remaining = tiles.filter((t) => !doneSet.has(t.id));

  log(
    `📊 Grid: ${tiles.length} tiles total, ${remaining.length} remaining, ${doneSet.size} done`,
    C.dim
  );

  const estMin = Math.round((remaining.length * DELAY_MS) / 60000);
  log(`⏱️  Estimated time: ~${estMin} min (${DELAY_MS / 1000}s/tile)`, C.dim);
  log(``, C.reset);

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalPlaces = 0;

  for (let i = 0; i < remaining.length; i++) {
    const tile = remaining[i];
    const pct = Math.round(((i + 1) / remaining.length) * 100);

    process.stdout.write(
      `${C.dim}[${pct}%] Tile ${i + 1}/${remaining.length} bbox=${tile.bbox}...${C.reset}`
    );

    try {
      const kml = await fetchWikimapia(tile.bbox);
      const places = parseKml(kml);

      if (places.length > 0) {
        const { inserted, skipped } = await insertPlaces(pool, places);
        totalInserted += inserted;
        totalSkipped += skipped;
        totalPlaces += places.length;
        process.stdout.write(
          ` ${C.green}+${inserted}${C.reset} (total: ${totalInserted})\n`
        );
      } else {
        process.stdout.write(` ${C.dim}empty${C.reset}\n`);
      }

      checkpoint.done.push(tile.id);
      saveCheckpoint(checkpoint);
    } catch (e) {
      process.stdout.write(` ${C.red}ERROR: ${e.message}${C.reset}\n`);
    }

    if (i < remaining.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  // Final stats
  log("\n🔄 Running ANALYZE...", C.yellow);
  await pool.query("ANALYZE places;");

  const { rows } = await pool.query("SELECT COUNT(*) FROM places;");
  log(`\n🎉 Import complete!`, C.green);
  log(`   Inserted this run : ${totalInserted}`, C.green);
  log(`   Total in DB       : ${rows[0].count}`, C.cyan);
  log(`\n   Open http://localhost/ to see Wikimapia polygons!`, C.cyan);

  await pool.end();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
