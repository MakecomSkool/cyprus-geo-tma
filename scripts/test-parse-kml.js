#!/usr/bin/env node
// Save raw KML from Nicosia tile and inspect structure
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
  });
  const cp = await ctx.newPage();
  await cp.goto("http://wikimapia.org/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await cp.waitForTimeout(2500);
  await cp.close();

  const resp = await ctx.request.get("http://wikimapia.org/d?BBOX=33.25,35.15,33.4,35.3&page=1&count=200");
  const body = await resp.text();
  console.log("Status:", resp.status(), "Size:", body.length);

  // Save raw KML
  writeFileSync("./raw_kml_sample.xml", body, "utf8");
  console.log("Saved to raw_kml_sample.xml");

  // Check first 200 chars
  console.log("\nFirst 200:", body.substring(0, 200));
  console.log("Last 200:", body.substring(body.length - 200));

  // Try parse
  const p = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    cdataPropName: "__cdata",
    isArray: n => n === "Placemark" || n === "Folder",
  });
  try {
    const parsed = p.parse(body);
    console.log("\nTop keys:", Object.keys(parsed));
    const kml = parsed.kml;
    console.log("kml keys:", Object.keys(kml || {}));
    const doc = kml?.Document;
    if (doc) {
      console.log("Document keys:", Object.keys(doc));
      console.log("Direct Placemarks:", (doc.Placemark ?? []).length);
      const folders = Array.isArray(doc.Folder) ? doc.Folder : doc.Folder ? [doc.Folder] : [];
      console.log("Folders:", folders.length);
      for (let i = 0; i < Math.min(folders.length, 3); i++) {
        const f = folders[i];
        console.log(`  Folder[${i}] keys:`, Object.keys(f));
        console.log(`  Folder[${i}] Placemarks:`, (f.Placemark ?? []).length);
      }
    }
  } catch (e) {
    console.log("Parse error:", e.message);
  }

  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
