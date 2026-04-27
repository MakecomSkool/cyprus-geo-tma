#!/usr/bin/env node
/**
 * scripts/warmup-tiles.js
 * 
 * Pre-generates all Cyprus MVT tiles at zoom 8-12 and stores them in the cache.
 * Run this once after server starts to make the map instant.
 */

// Cyprus tile ranges:
// z8: x=150-152, y=99-102
// z9: x=301-305, y=199-204  
// z10: x=603-611, y=399-409
// z11: x=1206-1222, y=798-818
// z12: x=2413-2445, y=1597-1637

const TILE_RANGES = [
  { z: 9,  xMin: 301, xMax: 305, yMin: 199, yMax: 204 },
  { z: 10, xMin: 603, xMax: 611, yMin: 399, yMax: 409 },
  { z: 11, xMin: 1206, xMax: 1222, yMin: 798, yMax: 818 },
];

const BASE = "http://localhost:3000";

async function warmup() {
  let total = 0, ok = 0, slow = 0;
  
  for (const range of TILE_RANGES) {
    for (let x = range.xMin; x <= range.xMax; x++) {
      for (let y = range.yMin; y <= range.yMax; y++) {
        total++;
        const t0 = Date.now();
        try {
          const r = await fetch(`${BASE}/api/tiles/${range.z}/${x}/${y}.mvt`);
          const ms = Date.now() - t0;
          if (ms > 1000) slow++;
          if (r.status === 200 || r.status === 204) ok++;
          process.stdout.write(`\r z${range.z} ${x}/${y}: ${r.status} ${ms}ms | ${ok}/${total} done  `);
        } catch (e) {
          process.stdout.write(`\r ERROR ${range.z}/${x}/${y}: ${e.message}  `);
        }
        await new Promise(r => setTimeout(r, 50)); // don't hammer too fast
      }
    }
  }
  
  console.log(`\n\nDone! ${ok}/${total} tiles cached. ${slow} were slow (>1s).`);
}

warmup().catch(console.error);
