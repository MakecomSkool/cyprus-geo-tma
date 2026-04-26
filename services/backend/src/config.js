/**
 * services/backend/src/config.js
 * Loads configuration from root .env and exports typed config object.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..", "..");

// Load .env from project root
loadEnv({ path: resolve(ROOT, ".env") });

export const config = {
  port: parseInt(process.env.BACKEND_PORT || "3000", 10),
  host: process.env.BACKEND_HOST || "0.0.0.0",
  corsOrigin: process.env.CORS_ORIGIN || "*",

  db: {
    connectionString: process.env.DATABASE_URL,
    host: process.env.POSTGRES_HOST || "localhost",
    port: parseInt(process.env.POSTGRES_PORT || "5432", 10),
    user: process.env.POSTGRES_USER || "cyprus",
    password: process.env.POSTGRES_PASSWORD || "cyprus_dev_2026",
    database: process.env.POSTGRES_DB || "cyprus_geo",
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
  },
};
