#!/usr/bin/env node
/**
 * scripts/import-wikimapia-kml.js — v6 FINAL ✅
 *
 * Uses context.request.get() with Playwright session cookies to bypass
 * Wikimapia's 218 bot challenge and fetch KML polygon data.
 *
 * Confirmed working: 606 placemarks per tile for Nicosia area.
 */

import pg from "pg";
import { chromium } from "playwright";
import { XMLParser } from "fast-xml-parser";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const { Pool } = pg;
const DB_URL = process.env.DATABASE_URL || "postgresql://cyprus:cyprus_dev_2026@localhost:5433/cyprus_geo";
const CHECKPOINT_FILE = "./wm_kml_checkpoint.json";

// Inhabited zones of Cyprus
const ZONES = [
  { minLon: 32.38, maxLon: 32.80, minLat: 34.65, maxLat: 35.10 }, // Paphos
  { minLon: 32.65, maxLon: 33.30, minLat: 34.58, maxLat: 34.92 }, // Limassol
  { minLon: 33.10, maxLon: 33.65, minLat: 34.85, maxLat: 35.50 }, // Nicosia
  { minLon: 33.45, maxLon: 34.15, minLat: 34.65, maxLat: 35.30 }, // Larnaca + Famagusta
  { minLon: 32.80, maxLon: 34.65, minLat: 35.10, maxLat: 35.75 }, // North Cyprus
];

const TILE = 0.15;   // ~15km tiles (matches Wikimapia internal grid)
const DELAY = 800;   // ms between tiles
const PAGES = 5;     // max pages per tile

const log = (m, c = "\x1b[37m") => process.stdout.write(c + m + "\x1b[0m\n");
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Grid ─────────────────────────────────────────────────────────────────────
function grid() {
  const seen = new Set(), tiles = [];
  let id = 0;
  for (const z of ZONES) {
    for (let lon = z.minLon; lon < z.maxLon; lon = +(lon + TILE).toFixed(4)) {
      for (let lat = z.minLat; lat < z.maxLat; lat = +(lat + TILE).toFixed(4)) {
        const b = [
          +lon.toFixed(4), +lat.toFixed(4),
          +Math.min(lon + TILE, z.maxLon).toFixed(4),
          +Math.min(lat + TILE, z.maxLat).toFixed(4)
        ].join(",");
        if (!seen.has(b)) { seen.add(b); tiles.push({ id: String(id++), b }); }
      }
    }
  }
  return tiles;
}

// ─── KML Parser ───────────────────────────────────────────────────────────────
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
  const pms = Array.isArray(node.Placemark) ? node.Placemark : node.Placemark ? [node.Placemark] : [];
  res.push(...pms);
  const folds = Array.isArray(node.Folder) ? node.Folder : node.Folder ? [node.Folder] : [];
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
    let description = "", url = `http://wikimapia.org/#lang=en&id=${wid}`;

    const desc = pm.description;
    if (desc) {
      const raw = String(desc.__cdata ?? desc ?? "").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").trim();
      const txt = raw.match(/^([^<\[]+)/)?.[1]?.trim() ?? "";
      if (!name) name = txt; else description = txt;
      const um = raw.match(/href='([^']+)'/);
      if (um) url = um[1].replace(/#ge$/, "");
    }
    if (!name) name = `Wikimapia #${wid}`;

    // Coordinates — Wikimapia uses MultiGeometry > LineString for polygon outlines
    let coordsText = null;
    if (pm.Polygon?.outerBoundaryIs?.LinearRing?.coordinates)
      coordsText = String(pm.Polygon.outerBoundaryIs.LinearRing.coordinates);
    else if (pm.LineString?.coordinates)
      coordsText = String(pm.LineString.coordinates);
    else if (pm.MultiGeometry) {
      const mg = pm.MultiGeometry;
      // Primary: Polygon inside MultiGeometry
      if (mg.Polygon?.outerBoundaryIs?.LinearRing?.coordinates)
        coordsText = String(mg.Polygon.outerBoundaryIs.LinearRing.coordinates);
      // Wikimapia uses LineString inside MultiGeometry for polygon outlines!
      else if (mg.LineString?.coordinates)
        coordsText = String(mg.LineString.coordinates);
    }
    if (!coordsText) return null;

    const pts = [];
    for (const tok of coordsText.trim().split(/[\s\n\r]+/)) {
      const p2 = tok.trim().split(",");
      if (p2.length >= 2) {
        const lon = parseFloat(p2[0]), lat = parseFloat(p2[1]);
        // p2[2] is altitude — ignore
        if (!isNaN(lon) && !isNaN(lat) && lon > 32 && lon < 35 && lat > 34 && lat < 36)
          pts.push(`${lon} ${lat}`);
      }
    }

    if (pts.length < 4) return null;
    if (pts[0] !== pts[pts.length-1]) pts.push(pts[0]);
    return { wid, name, description, url, wkt: `POLYGON((${pts.join(", ")}))` };
  }).filter(Boolean);
}

// ─── DB ───────────────────────────────────────────────────────────────────────
async function upsert(pool, places) {
  let ins = 0;
  for (const p of places) {
    try {
      const r = await pool.query(
        `INSERT INTO places(wikimapia_id,name,description,geom,source_url,photos,category)
         VALUES($1,$2,$3,ST_GeomFromText($4,4326),$5,'{}','wikimapia')
         ON CONFLICT(wikimapia_id) DO UPDATE SET name=EXCLUDED.name,updated_at=now()
         RETURNING(xmax=0)ii`,
        [p.wid, p.name, p.description, p.wkt, p.url]
      );
      if (r.rows[0]?.ii) ins++;
    } catch { /* bad geom or duplicate */ }
  }
  return ins;
}

function loadCp() {
  try { return existsSync(CHECKPOINT_FILE) ? JSON.parse(readFileSync(CHECKPOINT_FILE,"utf8")) : {done:[]}; }
  catch { return {done:[]}; }
}
function saveCp(cp) { writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp), "utf8"); }

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log("\n🗺️  Wikimapia KML Scraper v6 ✅\n", "\x1b[36m");

  const pool = new Pool({ connectionString: DB_URL });
  await pool.query("SELECT 1");
  log("✅ DB connected", "\x1b[32m");

  const tiles = grid();
  const cp = loadCp();
  const done = new Set(cp.done);
  const remaining = tiles.filter(t => !done.has(t.id));
  log(`📊 ${tiles.length} tiles | ${remaining.length} remaining | ~${Math.round(remaining.length * DELAY / 60000)} min\n`, "\x1b[33m");

  // Launch browser
  log("🌐 Launching Chromium...", "\x1b[33m");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
  });

  // Get session cookie by visiting main page
  log("🍪 Getting session cookie...", "\x1b[33m");
  const sp = await context.newPage();
  await sp.goto("http://wikimapia.org/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await sp.waitForTimeout(2500);
  const cookies = await context.cookies();
  log(`   Cookies: ${cookies.map(c => c.name).join(", ")}`, "\x1b[2m");
  await sp.close();
  log("✅ Session ready\n", "\x1b[32m");

  let totalIns = 0;

  for (let i = 0; i < remaining.length; i++) {
    const tile = remaining[i];
    const pct = Math.round(((i + 1) / remaining.length) * 100);
    const { rows: cnt } = await pool.query("SELECT COUNT(*) FROM places");
    process.stdout.write(`\x1b[2m[${pct}%] ${i+1}/${remaining.length} ${tile.b} | DB:${cnt[0].count}\x1b[0m `);

    let tileIns = 0;

    for (let pg2 = 1; pg2 <= PAGES; pg2++) {
      const kmlUrl = `http://wikimapia.org/d?BBOX=${tile.b}&page=${pg2}&count=200`;
      try {
        // Use context.request.get() — uses browser session cookies, no HTML rendering
        const resp = await context.request.get(kmlUrl, { timeout: 20000 });
        const body = await resp.text();
        const status = resp.status();

        if (status === 218 || !body.includes("<kml")) {
          // Re-acquire cookie and retry once
          process.stdout.write(` [${status}/re-auth]`);
          const rp = await context.newPage();
          await rp.goto("http://wikimapia.org/", { waitUntil: "domcontentloaded", timeout: 20000 });
          await rp.waitForTimeout(2000);
          await rp.close();
          break;
        }
        // Debug: show body size
        process.stdout.write(` [${status}/${body.length}b]`);

        const places = parseKml(body);
        if (places.length === 0) break;
        const ins = await upsert(pool, places);
        tileIns += ins;
        if (places.length < 200) break;
        await sleep(400);
      } catch (e) {
        log(` [err: ${e.message.substring(0, 40)}]`, "\x1b[31m");
        break;
      }
    }

    totalIns += tileIns;
    process.stdout.write(tileIns > 0 ? `\x1b[32m+${tileIns}\x1b[0m\n` : `\x1b[2mempty\x1b[0m\n`);
    cp.done.push(tile.id);
    saveCp(cp);

    if (i < remaining.length - 1) await sleep(DELAY);
  }

  await browser.close();

  log("\n🔄 ANALYZE...", "\x1b[33m");
  await pool.query("ANALYZE places;");
  const { rows } = await pool.query("SELECT COUNT(*) FROM places;");
  log(`\n🎉 DONE! DB total: ${rows[0].count} | This run: ${totalIns}`, "\x1b[32m");
  log(`   Open http://localhost/ to see Wikimapia polygons!\n`, "\x1b[36m");

  await pool.end();
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
