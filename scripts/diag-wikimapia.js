#!/usr/bin/env node
import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
  });

  // Get cookie
  const cookiePage = await context.newPage();
  await cookiePage.goto("http://wikimapia.org/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await cookiePage.waitForTimeout(3000);
  const cookies = await context.cookies();
  console.log("Cookies:", JSON.stringify(cookies.map(c => `${c.name}=${c.value}`)));
  await cookiePage.close();

  // Fetch KML for Nicosia directly
  const page = await context.newPage();
  const url = "http://wikimapia.org/d?BBOX=33.3,35.1,33.4,35.2&page=1&count=200";
  console.log("\nFetching:", url);

  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  console.log("Response status:", response?.status());
  console.log("Response headers:", JSON.stringify(response?.headers()));

  // Get raw text from <pre> or body
  const bodyText = await page.evaluate(() => document.body?.innerText || document.documentElement?.innerText || "");
  console.log("\nBody text (first 600):", bodyText.substring(0, 600));

  // Also try page.content()
  const html = await page.content();
  console.log("\npage.content() (first 600):", html.substring(0, 600));

  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
