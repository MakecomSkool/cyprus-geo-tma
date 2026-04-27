#!/usr/bin/env node
/**
 * scripts/debug-wikimapia-network.js
 *
 * Debug script: opens Wikimapia in real Chromium and logs ALL network requests
 * to understand what API endpoints Wikimapia uses for polygon data.
 */

import { chromium } from "playwright";

async function main() {
  console.log("🔍 Launching Chromium to sniff Wikimapia network...\n");

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();

  // Log ALL requests
  page.on("request", (req) => {
    const url = req.url();
    if (!url.includes("google") && !url.includes("facebook") && !url.includes("twitter")) {
      console.log(`REQ [${req.method()}] ${url.substring(0, 120)}`);
    }
  });

  // Log ALL responses with status
  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("wikimapia") || url.includes("wmapi") || url.includes("polygon")) {
      const ct = res.headers()["content-type"] || "";
      const size = res.headers()["content-length"] || "?";
      console.log(`RES [${res.status()}] ${ct.substring(0, 30)} size=${size} ${url.substring(0, 120)}`);

      // Try to get response body for interesting endpoints
      if (ct.includes("json") || ct.includes("javascript") || ct.includes("text")) {
        try {
          const body = await res.text();
          if (body.length > 20 && body.length < 50000) {
            console.log(`  BODY (first 300): ${body.substring(0, 300)}\n`);
          }
        } catch {}
      }
    }
  });

  // Navigate to Nicosia on Wikimapia (same location user showed us)
  const url = "http://wikimapia.org/#lang=en&lat=35.1650&lon=33.3174&z=13&m=w";
  console.log(`📍 Navigating to: ${url}\n`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  console.log("⏳ Waiting 8s for all data to load...\n");
  await page.waitForTimeout(8000);

  // Also try the API URL format that wikimapia often uses
  console.log("\n📡 Trying direct API call...");
  const apiPage = await context.newPage();
  
  // Known Wikimapia API patterns
  const apiUrls = [
    "http://wikimapia.org/api/?function=box&bbox=33.2,35.1,33.5,35.3&key=example&format=json",
    "http://wikimapia.org/d?BBOX=33.2,35.1,33.5,35.3&page=1&count=50",
    "http://wikimapia.org/api/json?function=box&bbox=33.2,35.1,33.5,35.3",
  ];
  
  for (const apiUrl of apiUrls) {
    console.log(`\nTrying: ${apiUrl}`);
    try {
      const resp = await apiPage.request.get(apiUrl, { timeout: 10000 });
      const body = await resp.text();
      console.log(`Status: ${resp.status()}`);
      console.log(`Body (first 400): ${body.substring(0, 400)}`);
    } catch (e) {
      console.log(`Error: ${e.message}`);
    }
  }

  await browser.close();
  console.log("\n✅ Done");
}

main().catch(e => { console.error(e); process.exit(1); });
