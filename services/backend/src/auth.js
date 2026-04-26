/**
 * services/backend/src/auth.js
 * Telegram Web App initData validation (HMAC-SHA256).
 *
 * Spec: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Steps:
 * 1. Parse initData as URLSearchParams.
 * 2. Extract `hash` and sort remaining key=value pairs alphabetically.
 * 3. Compute secret_key = HMAC-SHA256("WebAppData", bot_token).
 * 4. Compute data_check = HMAC-SHA256(secret_key, sorted data_check_string).
 * 5. Compare data_check hex with the provided hash.
 * 6. Verify auth_date is within allowed window (default: 1 hour).
 */

import { createHmac } from "node:crypto";
import { config } from "./config.js";
import { query } from "./db.js";

const AUTH_DATE_MAX_AGE_S = 3600; // 1 hour

/**
 * Validate Telegram initData string.
 * @param {string} initData  Raw initData from Telegram WebApp
 * @returns {{ valid: boolean, user?: object, error?: string }}
 */
export function validateInitData(initData) {
  if (!initData) {
    return { valid: false, error: "Missing initData" };
  }

  // In development mode with no bot token, skip validation
  if (!config.telegram.botToken || config.telegram.botToken === "YOUR_BOT_TOKEN_HERE") {
    // Try to parse user from initData anyway (dev convenience)
    try {
      const params = new URLSearchParams(initData);
      const userStr = params.get("user");
      if (userStr) {
        return { valid: true, user: JSON.parse(userStr) };
      }
    } catch { /* ignore */ }
    // Return a dev user if nothing parseable
    return {
      valid: true,
      user: {
        id: 1,
        first_name: "Dev",
        last_name: "User",
        username: "dev_user",
        language_code: "en",
        is_premium: false,
      },
    };
  }

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) {
      return { valid: false, error: "Missing hash in initData" };
    }

    // Check auth_date freshness
    const authDate = parseInt(params.get("auth_date") || "0", 10);
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > AUTH_DATE_MAX_AGE_S) {
      return { valid: false, error: "initData expired (auth_date too old)" };
    }

    // Build data-check-string: sorted key=value pairs, excluding hash
    params.delete("hash");
    const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

    // HMAC chain: secret = HMAC-SHA256("WebAppData", bot_token)
    const secretKey = createHmac("sha256", "WebAppData")
      .update(config.telegram.botToken)
      .digest();

    // data_check = HMAC-SHA256(secret, data_check_string)
    const checkHash = createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (checkHash !== hash) {
      return { valid: false, error: "Invalid initData signature" };
    }

    // Parse user object
    const userStr = params.get("user");
    const user = userStr ? JSON.parse(userStr) : null;

    return { valid: true, user };
  } catch (err) {
    return { valid: false, error: `initData parse error: ${err.message}` };
  }
}

/**
 * Upsert a Telegram user into the `users` table.
 * @param {object} tgUser  Parsed Telegram user object from initData
 * @returns {Promise<object>}  The DB user row
 */
export async function upsertUser(tgUser) {
  const result = await query(
    `INSERT INTO users (telegram_id, username, first_name, last_name, language_code, is_premium)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (telegram_id) DO UPDATE SET
       username      = EXCLUDED.username,
       first_name    = EXCLUDED.first_name,
       last_name     = EXCLUDED.last_name,
       language_code = EXCLUDED.language_code,
       is_premium    = EXCLUDED.is_premium,
       updated_at    = NOW()
     RETURNING id, telegram_id, username, first_name, last_name, language_code, is_premium`,
    [
      tgUser.id,
      tgUser.username || null,
      tgUser.first_name || null,
      tgUser.last_name || null,
      tgUser.language_code || null,
      tgUser.is_premium || false,
    ]
  );
  return result.rows[0];
}

/**
 * Fastify preHandler hook: validate initData and attach user to request.
 */
export async function authMiddleware(request, reply) {
  // initData can be in Authorization header or query param
  const initData =
    request.headers["x-telegram-init-data"] ||
    request.headers.authorization?.replace("tma ", "") ||
    request.query?.initData;

  const { valid, user, error } = validateInitData(initData);

  if (!valid) {
    return reply.code(401).send({ error: error || "Unauthorized" });
  }

  // Upsert user into DB and attach to request
  try {
    request.dbUser = await upsertUser(user);
    request.tgUser = user;
  } catch (err) {
    request.log.error({ err }, "Failed to upsert user");
    return reply.code(500).send({ error: "Internal server error" });
  }
}
