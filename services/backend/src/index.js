/**
 * services/backend/src/index.js
 * Entry point — assembles Fastify server, REST routes, Socket.IO, and graceful shutdown.
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { createServer } from "node:http";

import { config } from "./config.js";
import { pool } from "./db.js";
import authPlugin from "./plugins/auth.js";
import placesRoutes from "./routes/places.js";
import clustersRoutes from "./routes/clusters.js";
import placeDetailsRoutes from "./routes/placeDetails.js";
import searchRoutes from "./routes/search.js";
import reviewsRoutes from "./routes/reviews.js";
import tilesRoutes from "./routes/tiles.js";
import usersRoutes from "./routes/users.js";
import wmProxyRoutes from "./routes/wmProxy.js";
import geojsonRoutes from "./routes/geojson.js";
import { setupSocketIO } from "./ws.js";

// ── Create Fastify with pino logger ────────────────────────────
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { colorize: true, ignore: "pid,hostname" } }
        : undefined,
  },
  serverFactory: (handler) => {
    const server = createServer((req, res) => {
      handler(req, res);
    });
    return server;
  },
});

// ── CORS — whitelist Telegram in production ────────────────────
const corsOrigin = process.env.NODE_ENV === "production"
  ? ["https://web.telegram.org", "https://t.me"]
  : true; // allow all in dev

await fastify.register(cors, {
  origin: corsOrigin,
});

// ── Rate limiting ──────────────────────────────────────────────
await fastify.register(rateLimit, {
  global: true,
  max: 200,
  timeWindow: "1 minute",
  keyGenerator: (req) => req.userId || req.ip,
});

// ── Auth plugin (provides fastify.authenticate preHandler) ─────
await fastify.register(authPlugin);

// ── Healthcheck ────────────────────────────────────────────────
fastify.get("/healthz", async () => {
  try {
    const result = await pool.query("SELECT 1 AS ok");
    return {
      status: "ok",
      db: result.rows[0]?.ok === 1 ? "connected" : "error",
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return { status: "degraded", db: "disconnected", error: err.message };
  }
});

// ── REST routes ────────────────────────────────────────────────
await fastify.register(placesRoutes);
await fastify.register(clustersRoutes);
await fastify.register(placeDetailsRoutes);
await fastify.register(searchRoutes);
await fastify.register(reviewsRoutes);
await fastify.register(tilesRoutes);
await fastify.register(usersRoutes);
await fastify.register(wmProxyRoutes);
await fastify.register(geojsonRoutes);

// ── Socket.IO (attached to the raw HTTP server) ────────────────
const io = setupSocketIO(fastify.server, fastify);

// ── Graceful shutdown ──────────────────────────────────────────
const shutdown = async (signal) => {
  fastify.log.info({ signal }, "Shutting down...");
  io.close();
  await fastify.close();
  await pool.end();
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ── Start ──────────────────────────────────────────────────────
try {
  await fastify.listen({ port: config.port, host: config.host });
  fastify.log.info(
    `Backend ready: http://${config.host}:${config.port}`
  );
  fastify.log.info(
    `Socket.IO path: ws://${config.host}:${config.port}/ws/`
  );
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
