/**
 * services/backend/src/plugins/auth.js
 *
 * Fastify plugin: Telegram initData authentication.
 * Decorates `fastify.authenticate` as a reusable preHandler.
 *
 * Usage in routes:
 *   fastify.get('/api/users/me', { preHandler: fastify.authenticate }, handler)
 *
 * Sets on request:
 *   - request.userId   (UUID from DB)
 *   - request.dbUser   (full DB row)
 *   - request.tgUser   (parsed Telegram user object)
 */

import fp from "fastify-plugin";
import { validateInitData, upsertUser } from "../auth.js";

async function authPlugin(fastify) {
  // Decorate request with null defaults (Fastify requires this)
  fastify.decorateRequest("userId", null);
  fastify.decorateRequest("dbUser", null);
  fastify.decorateRequest("tgUser", null);

  // Expose authenticate as a named preHandler
  fastify.decorate("authenticate", async (request, reply) => {
    const initData =
      request.headers["x-telegram-init-data"] ||
      request.headers.authorization?.replace("tma ", "") ||
      request.query?.initData;

    const { valid, user, error } = validateInitData(initData);

    if (!valid) {
      return reply.code(401).send({ error: error || "Unauthorized" });
    }

    try {
      const dbUser = await upsertUser(user);
      request.dbUser = dbUser;
      request.userId = dbUser.id; // ← this is what routes expect
      request.tgUser = user;
    } catch (err) {
      request.log.error({ err }, "auth: failed to upsert user");
      return reply.code(500).send({ error: "Internal auth error" });
    }
  });
}

export default fp(authPlugin, { name: "auth-plugin" });
