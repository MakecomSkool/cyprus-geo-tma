#!/usr/bin/env node
/**
 * scripts/import-wikimapia-precise.js — v7 PRECISE
 *
 * Uses small tiles (0.03° ≈ 3km) instead of 0.15° to get
 * high-resolution polygon coordinates from Wikimapia.
 *
 * Small tile = Wikimapia returns more points per polygon = precise shapes.
 * The BBOX size is the key factor in coordinate precision.
 */

import pg from "pg";
import { chromium } from "playwright";
import { XMLParser } from "fast-xml-parser";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const { Pool } = pg;
const DB_URL = process.env.DATABASE_URL || "postgresql://cyprus:cyprus_dev_2026@localhost:5433/cyprus_geo";
const CHECKPOINT_FILE = "./wm_precise_checkpoint.json";

// All of Cyprus in small tiles
const CYPRUS = { minLon: 32.20, maxLon: 34.65, minLat: 34.50, maxLat: 35.75 };

// SMALL tile = more precise coordinates from Wikimapia
// 0.03° ≈ 3.3km — matches Wikimapia zoom 14-15 detail level
const TILE  = 0.03;
const DELAY = 600;   // ms between requests
const PAGES = 3;     // pages per tile (max 200 per page)

const log   = (m, c = "\x1b[37m") => process.stdout.write(c + m + "\x1b[0m\n");
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Build grid over all Cyprus ──────────────────────────────────────────────
function grid() {
  const tiles = [];
  let id = 0;
  for (let lon = CYPRUS.minLon; lon < CYPRUS.maxLon; lon = +(lon + TILE).toFixed(5)) {
    for (let lat = CYPRUS.minLat; lat < CYPRUS.maxLat; lat = +(lat + TILE).toFixed(5)) {
      const minLon = +lon.toFixed(5);
      const minLat = +lat.toFixed(5);
      const maxLon = +Math.min(lon + TILE, CYPRUS.maxLon).toFixed(5);
      const maxLat = +Math.min(lat + TILE, CYPRUS.maxLat).toFixed(5);
      tiles.push({ id: String(id++), b: `${minLon},${minLat},${maxLon},${maxLat}` });
    }
  }
  return tiles;
}

// ─── KML Parser ──────────────────────────────────────────────────────────────
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "__cdata",
  isArray: n => n === "Placemark" || n === "Folder",
  parseAttributeValue: false,
  trimValues: true,
});

function allPlacemarks(node) {
  if (!node) return [];
  const res = [];
  const pms = Array.isArray(node.Placemark) ? node.Placemark
    : node.Placemark ? [node.Placemark] : [];
  res.push(...pms);
  const folds = Array.isArray(node.Folder) ? node.Folder
    : node.Folder ? [node.Folder] : [];
  for (const f of folds) res.push(...allPlacemarks(f));
  return res;
}

function parseKml(body) {
  if (!body || !body.includes("<kml")) return [];
  let doc;
  try {
    const p = xmlParser.parse(body);
    doc = p?.kml?.Document ?? p?.kml?.Folder ?? p?.kml;
    if (!doc) return [];
  } catch { return []; }

  return allPlacemarks(doc).map(pm => {
    if (!pm) return null;
    const rawId = pm["@_id"] ?? "";
    const wid = rawId.startsWith("wm") ? parseInt(rawId.slice(2), 10) : null;
    if (!wid || isNaN(wid)) return null;

    let name = String(pm.name ?? "").trim();
    let description = "", url = `http://wikimapia.org/place/${wid}`;

    const desc = pm.description;
    if (desc) {
      const raw = String(desc.__cdata ?? desc ?? "")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
      const txt = raw.match(/^([^<\[]+)/)?.[1]?.trim() ?? "";
      if (!name) name = txt; else description = txt;
      const um = raw.match(/href='([^']+)'/);
      if (um) url = um[1].replace(/#ge$/, "");
    }
    if (!name) name = `Wikimapia #${wid}`;

    // Extract polygon coordinates from MultiGeometry > LineString
    let coordsText = null;
    if (pm.Polygon?.outerBoundaryIs?.LinearRing?.coordinates)
      coordsText = String(pm.Polygon.outerBoundaryIs.LinearRing.coordinates);
    else if (pm.LineString?.coordinates)
      coordsText = String(pm.LineString.coordinates);
    else if (pm.MultiGeometry) {
      const mg = pm.MultiGeometry;
      if (mg.Polygon?.outerBoundaryIs?.LinearRing?.coordinates)
        coordsText = String(mg.Polygon.outerBoundaryIs.LinearRing.coordinates);
      else if (mg.LineString?.coordinates)
        coordsText = String(mg.LineString.coordinates);
    }
    if (!coordsText) return null;

    // Parse lon,lat,alt triplets — ignore altitude
    const pts = [];
    for (const tok of coordsText.trim().split(/[\s\n\r]+/)) {
      const parts = tok.trim().split(",");
      if (parts.length >= 2) {
        const lon = parseFloat(parts[0]), lat = parseFloat(parts[1]);
        if (!isNaN(lon) && !isNaN(lat) && lon > 32 && lon < 35 && lat > 34 && lat < 36)
          pts.push(`${lon} ${lat}`);
      }
    }

    if (pts.length < 3) return null;
    // Close the ring if not already closed
    if (pts[0] !== pts[pts.length - 1]) pts.push(pts[0]);
    if (pts.length < 4) return null;

    return { wid, name, description, url, wkt: `POLYGON((${pts.join(", ")}))` };
  }).filter(Boolean);
}

// ─── DB Upsert ───────────────────────────────────────────────────────────────
async function upsert(pool, places) {
  let ins = 0, upd = 0;
  for (const p of places) {
    try {
      const r = await pool.query(
        `INSERT INTO places(wikimapia_id, name, description, geom, source_url, photos, category)
         VALUES($1, $2, $3, ST_GeomFromText($4, 4326), $5, '{}', 'wikimapia')
         ON CONFLICT(wikimapia_id) DO UPDATE SET
           name = EXCLUDED.name,
           geom = EXCLUDED.geom,
           updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [p.wid, p.name, p.description, p.wkt, p.url]
      );
      if (r.rows[0]?.inserted) ins++; else upd++;
    } catch { /* invalid geometry or other error */ }
  }
  return { ins, upd };
}

// ─── Checkpoint ───────────────────────────────────────────────────────────────
function loadCp() {
  try { return existsSync(CHECKPOINT_FILE) ? JSON.parse(readFileSync(CHECKPOINT_FILE, "utf8")) : { done: [] }; }
  catch { return { done: [] }; }
}
function saveCp(cp) { writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp), "utf8"); }

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log("\n🗺️  Wikimapia PRECISE Scraper v7\n", "\x1b[36m");
  log(`   Tile size: ${TILE}° ≈ ${Math.round(TILE * 111)}km (precise polygon coordinates)\n`, "\x1b[2m");

  const pool = new Pool({ connectionString: DB_URL });
  await pool.query("SELECT 1");
  log("✅ DB connected\n", "\x1b[32m");

  const tiles     = grid();
  const cp        = loadCp();
  const done      = new Set(cp.done);
  const remaining = tiles.filter(t => !done.has(t.id));
  const estMin    = Math.round(remaining.length * DELAY / 60000);

  log(`📊 Total tiles: ${tiles.length}`, "\x1b[33m");
  log(`   Remaining:   ${remaining.length}`, "\x1b[33m");
  log(`   Estimated:   ~${estMin} minutes\n`, "\x1b[33m");

  // Launch browser + get session cookies
  log("🌐 Launching Chromium...", "\x1b[33m");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
  });

  log("🍪 Getting session cookie...", "\x1b[33m");
  const sp = await context.newPage();
  await sp.goto("http://wikimapia.org/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await sp.waitForTimeout(2500);
  await sp.close();
  log("✅ Session ready\n", "\x1b[32m");

  let totalIns = 0, totalUpd = 0, reAuthCount = 0;

  for (let i = 0; i < remaining.length; i++) {
    const tile = remaining[i];
    const pct  = Math.round(((i + 1) / remaining.length) * 100);
    const { rows: cnt } = await pool.query("SELECT COUNT(*) FROM places");

    process.stdout.write(`\x1b[2m[${pct}%] ${i+1}/${remaining.length} ${tile.b} | DB:${cnt[0].count}\x1b[0m `);

    let tileIns = 0, tileUpd = 0;

    for (let pg2 = 1; pg2 <= PAGES; pg2++) {
      // Small BBOX = Wikimapia returns precise polygon coordinates
      const kmlUrl = `http://wikimapia.org/d?BBOX=${tile.b}&page=${pg2}&count=200`;
      try {
        const resp   = await context.request.get(kmlUrl, { timeout: 25000 });
        const body   = await resp.text();
        const status = resp.status();

        if (status === 218 || !body.includes("<kml")) {
          // Re-authenticate
          process.stdout.write(` [re-auth]`);
          reAuthCount++;
          const rp = await context.newPage();
          await rp.goto("http://wikimapia.org/", { waitUntil: "domcontentloaded", timeout: 20000 });
          await rp.waitForTimeout(2000);
          await rp.close();
          break;
        }

        process.stdout.write(` [${status}/${body.length}b]`);

        const places = parseKml(body);
        if (places.length === 0) break;

        const { ins, upd } = await upsert(pool, places);
        tileIns += ins;
        tileUpd += upd;

        if (places.length < 200) break; // last page
        await sleep(400);
      } catch (e) {
        process.stdout.write(` [err: ${e.message.slice(0, 40)}]`);
        break;
      }
    }

    totalIns += tileIns;
    totalUpd += tileUpd;

    const summary = tileIns > 0 || tileUpd > 0
      ? `\x1b[32m+${tileIns} upd${tileUpd}\x1b[0m`
      : `\x1b[2mempty\x1b[0m`;
    process.stdout.write(summary + "\n");

    cp.done.push(tile.id);
    saveCp(cp);

    if (i < remaining.length - 1) await sleep(DELAY);
  }

  await browser.close();

  log("\n🔄 Analyzing & re-categorizing...", "\x1b[33m");
  await pool.query("ANALYZE places;");

  const { rows } = await pool.query("SELECT COUNT(*) FROM places;");
  log(`\n🎉 DONE!`, "\x1b[32m");
  log(`   DB total:  ${rows[0].count} places`, "\x1b[32m");
  log(`   Inserted:  ${totalIns}`, "\x1b[32m");
  log(`   Updated:   ${totalUpd} (geometry improved)`, "\x1b[32m");
  log(`   Re-auths:  ${reAuthCount}`, "\x1b[33m");

  await pool.end();
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
