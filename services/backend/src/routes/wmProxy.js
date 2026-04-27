/**
 * services/backend/src/routes/wmProxy.js
 *
 * Proxy Wikimapia raster tiles through our server.
 * Wikimapia CDN blocks direct browser requests (hotlink/CORS protection).
 * Server-side fetch with proper Referer header bypasses this.
 *
 * GET /api/wm-tiles/:z/:x/:y  → proxies https://i.wikimapia.org/?x=&y=&zoom=&type=1
 */

const WM_TILE_URL = (x, y, z) =>
  `https://i.wikimapia.org/?x=${x}&y=${y}&zoom=${z}&type=1&lng=1`;

async function getTile(request, reply) {
  const z = parseInt(request.params.z, 10);
  const x = parseInt(request.params.x, 10);
  const y = parseInt(request.params.y, 10);

  if (isNaN(z) || isNaN(x) || isNaN(y) || z < 0 || z > 19) {
    return reply.code(400).send("Bad tile coords");
  }

  const url = WM_TILE_URL(x, y, z);

  try {
    const resp = await fetch(url, {
      headers: {
        "Referer":    "https://wikimapia.org/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        "Accept":     "image/png,image/*,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) {
      // Return empty 1x1 transparent PNG on 404/error
      const emptyPng = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        "base64"
      );
      return reply
        .header("Content-Type", "image/png")
        .header("Cache-Control", "public, max-age=600")
        .send(emptyPng);
    }

    const buf = Buffer.from(await resp.arrayBuffer());
    return reply
      .header("Content-Type", resp.headers.get("content-type") || "image/png")
      .header("Cache-Control", "public, max-age=86400, s-maxage=604800")
      .header("Access-Control-Allow-Origin", "*")
      .send(buf);

  } catch (err) {
    request.log.warn({ err, url }, "WM tile proxy error");
    // Return transparent tile on error
    const emptyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64"
    );
    return reply
      .header("Content-Type", "image/png")
      .header("Cache-Control", "public, max-age=60")
      .send(emptyPng);
  }
}

export default async function wmProxyRoutes(fastify) {
  fastify.get("/api/wm-tiles/:z/:x/:y", getTile);
}
