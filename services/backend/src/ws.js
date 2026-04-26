/**
 * services/backend/src/ws.js
 * Socket.IO server — real-time messaging, room presence, and live-places feed.
 *
 * In-memory state:
 *   roomPresence: Map<placeId, Set<socketId>>   — who's in each room
 *   socketRooms:  Map<socketId, Set<placeId>>    — reverse index for cleanup
 *   socketBbox:   Map<socketId, [w,s,e,n]>       — viewport for live_places
 */

import { Server as SocketIOServer } from "socket.io";
import { validateInitData, upsertUser } from "./auth.js";
import { query } from "./db.js";
import { config } from "./config.js";

// ── In-memory presence tracking ───────────────────────────────
const roomPresence = new Map();   // placeId → Set<socketId>
const socketRooms  = new Map();   // socketId → Set<placeId>
const socketBbox   = new Map();   // socketId → [minLon,minLat,maxLon,maxLat]

/** Get online count for a place */
function getOnlineCount(placeId) {
  return roomPresence.get(placeId)?.size || 0;
}

/** Add socket to a room's presence */
function addPresence(placeId, socketId) {
  if (!roomPresence.has(placeId)) roomPresence.set(placeId, new Set());
  roomPresence.get(placeId).add(socketId);

  if (!socketRooms.has(socketId)) socketRooms.set(socketId, new Set());
  socketRooms.get(socketId).add(placeId);
}

/** Remove socket from a room's presence, return new count */
function removePresence(placeId, socketId) {
  const sockets = roomPresence.get(placeId);
  if (sockets) {
    sockets.delete(socketId);
    if (sockets.size === 0) roomPresence.delete(placeId);
  }
  socketRooms.get(socketId)?.delete(placeId);
  return getOnlineCount(placeId);
}

/** Remove socket from ALL rooms (on disconnect) */
function removeAllPresence(socketId) {
  const rooms = socketRooms.get(socketId);
  const affected = [];
  if (rooms) {
    for (const placeId of rooms) {
      const count = removePresence(placeId, socketId);
      affected.push({ placeId, count });
    }
  }
  socketRooms.delete(socketId);
  socketBbox.delete(socketId);
  return affected;
}

// ── Live-places: which places have active users ───────────────
// Returns all live places with their centroids (for bbox matching)
let livePlacesCentroidCache = new Map(); // placeId → [lon, lat]
let centroidCacheTime = 0;

async function ensureCentroidCache() {
  if (Date.now() - centroidCacheTime < 120_000 && livePlacesCentroidCache.size > 0) return;
  const res = await query(`
    SELECT id, ST_X(centroid) AS lon, ST_Y(centroid) AS lat
    FROM places WHERE centroid IS NOT NULL
  `);
  livePlacesCentroidCache = new Map();
  for (const r of res.rows) {
    livePlacesCentroidCache.set(r.id, [parseFloat(r.lon), parseFloat(r.lat)]);
  }
  centroidCacheTime = Date.now();
}

function pointInBbox(lon, lat, bbox) {
  return lon >= bbox[0] && lat >= bbox[1] && lon <= bbox[2] && lat <= bbox[3];
}

/**
 * Build live_places_update for a specific client's bbox.
 */
function buildLiveForBbox(bbox) {
  const result = [];
  for (const [placeId, sockets] of roomPresence) {
    if (sockets.size === 0) continue;
    const coords = livePlacesCentroidCache.get(placeId);
    if (!coords) continue;
    if (pointInBbox(coords[0], coords[1], bbox)) {
      result.push({ placeId, onlineCount: sockets.size });
    }
  }
  return result;
}

// ── Parse mentions from message body ──────────────────────────
function parseMentions(body) {
  const re = /@([a-zA-Z0-9_]{5,32})/g;
  const mentions = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    mentions.push(m[1]);
  }
  return mentions;
}

/**
 * Attach Socket.IO to a raw Node HTTP server.
 */
export function setupSocketIO(httpServer, fastify) {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: config.corsOrigin === "*" ? true : config.corsOrigin.split(","),
      methods: ["GET", "POST"],
    },
    path: "/ws/",
  });

  // ── Authentication middleware ──────────────────────────────
  io.use(async (socket, next) => {
    const initData =
      socket.handshake.auth?.initData ||
      socket.handshake.headers["x-telegram-init-data"] ||
      socket.handshake.query?.initData;

    const { valid, user, error } = validateInitData(initData);

    if (!valid) {
      return next(new Error(error || "Unauthorized"));
    }

    try {
      socket.dbUser = await upsertUser(user);
      socket.tgUser = user;
      next();
    } catch (err) {
      fastify.log.error({ err }, "WS auth: failed to upsert user");
      next(new Error("Internal auth error"));
    }
  });

  // ── Live-places broadcast throttle (every 2s) ─────────────
  let liveBroadcastTimer = null;

  function scheduleLiveBroadcast() {
    if (liveBroadcastTimer) return; // already scheduled
    liveBroadcastTimer = setTimeout(async () => {
      liveBroadcastTimer = null;
      await ensureCentroidCache();

      for (const [socketId, bbox] of socketBbox) {
        const clientSocket = io.sockets.sockets.get(socketId);
        if (!clientSocket) { socketBbox.delete(socketId); continue; }

        const livePlaces = buildLiveForBbox(bbox);
        clientSocket.emit("live_places_update", {
          added: livePlaces,
          changed: [],
          removed: [],
          ts: Date.now(),
        });
      }
    }, 2000);
  }

  // ── Connection handler ────────────────────────────────────
  io.on("connection", (socket) => {
    fastify.log.info(
      { socketId: socket.id, userId: socket.dbUser?.id },
      "WS connected"
    );

    // ── join_room ───────────────────────────────────────────
    socket.on("join_room", ({ placeId }, ack) => {
      const pid = placeId;
      if (!pid) {
        if (ack) ack({ ok: false, error: "Missing placeId" });
        return;
      }

      const room = `place:${pid}`;
      socket.join(room);
      addPresence(pid, socket.id);

      const onlineCount = getOnlineCount(pid);

      // Broadcast updated presence to everyone in the room
      io.to(room).emit("room_presence", { placeId: pid, onlineCount });

      // Trigger live-places update for all subscribers
      scheduleLiveBroadcast();

      fastify.log.info({ socketId: socket.id, room, onlineCount }, "Joined room");
      if (ack) ack({ ok: true, onlineCount });
    });

    // ── leave_room ──────────────────────────────────────────
    socket.on("leave_room", ({ placeId }) => {
      const pid = placeId;
      if (!pid) return;

      const room = `place:${pid}`;
      socket.leave(room);
      const onlineCount = removePresence(pid, socket.id);

      io.to(room).emit("room_presence", { placeId: pid, onlineCount });
      scheduleLiveBroadcast();

      fastify.log.info({ socketId: socket.id, room, onlineCount }, "Left room");
    });

    // ── send_message ────────────────────────────────────────
    socket.on("send_message", async ({ placeId, body, replyToId, optimisticId }, ack) => {
      if (!placeId || !body?.trim()) {
        if (ack) ack({ ok: false, error: "Missing placeId or body" });
        return;
      }

      const trimmedBody = body.trim().slice(0, 2000);
      const mentionUsernames = parseMentions(trimmedBody);

      // Resolve mention usernames → telegram_ids
      let mentionIds = [];
      if (mentionUsernames.length > 0) {
        try {
          const mentionResult = await query(
            `SELECT telegram_id FROM users WHERE username = ANY($1)`,
            [mentionUsernames]
          );
          mentionIds = mentionResult.rows.map((r) => r.telegram_id);
        } catch { /* ignore mention resolution failures */ }
      }

      try {
        const result = await query(
          `INSERT INTO messages (place_id, user_id, body, reply_to_id, mentions)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, body, reply_to_id, mentions, created_at`,
          [placeId, socket.dbUser.id, trimmedBody, replyToId || null, mentionIds]
        );

        const msg = result.rows[0];

        const payload = {
          id: msg.id,
          placeId,
          userId: socket.dbUser.id,
          user: {
            id: socket.dbUser.id,
            username: socket.dbUser.username,
            firstName: socket.dbUser.first_name,
            avatarUrl: socket.dbUser.avatar_url || null,
          },
          body: msg.body,
          replyToId: msg.reply_to_id || null,
          mentions: msg.mentions || [],
          createdAt: msg.created_at,
        };

        // Broadcast to everyone in the room (including sender)
        io.to(`place:${placeId}`).emit("new_message", payload);

        // ACK to sender with optimisticId mapping
        if (ack) ack({ ok: true, message: payload });

        // Trigger live update
        scheduleLiveBroadcast();

        fastify.log.info(
          { messageId: msg.id, placeId, userId: socket.dbUser.id },
          "Message sent"
        );
      } catch (err) {
        fastify.log.error({ err, placeId }, "Failed to insert message");
        if (ack) ack({ ok: false, error: "Failed to send message" });
      }
    });

    // ── typing ──────────────────────────────────────────────
    socket.on("typing", ({ placeId, isTyping }) => {
      if (!placeId) return;
      socket.to(`place:${placeId}`).emit("typing", {
        placeId,
        user: {
          id: socket.dbUser.id,
          firstName: socket.dbUser.first_name,
        },
        isTyping,
      });
    });

    // ── toggle_reaction ─────────────────────────────────────
    const VALID_EMOJIS = ["👍", "❤️", "😂", "🔥", "😮", "👎"];

    socket.on("toggle_reaction", async ({ messageId, emoji, placeId }, ack) => {
      if (!messageId || !emoji || !VALID_EMOJIS.includes(emoji)) {
        if (ack) ack({ ok: false, error: "Invalid messageId or emoji" });
        return;
      }

      try {
        // Check if user already has this reaction
        const existing = await query(
          `SELECT id, emoji FROM message_reactions
           WHERE user_id = $1 AND message_id = $2`,
          [socket.dbUser.id, messageId]
        );

        if (existing.rows.length > 0 && existing.rows[0].emoji === emoji) {
          // Same emoji → remove (toggle off)
          await query(
            "DELETE FROM message_reactions WHERE id = $1",
            [existing.rows[0].id]
          );
        } else {
          // Different emoji or no reaction → upsert
          await query(
            `INSERT INTO message_reactions (user_id, message_id, emoji)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, message_id) DO UPDATE SET
               emoji = EXCLUDED.emoji,
               created_at = NOW()`,
            [socket.dbUser.id, messageId, emoji]
          );
        }

        // Read updated reactions from messages.reactions (trigger already synced it)
        const updated = await query(
          "SELECT reactions FROM messages WHERE id = $1",
          [messageId]
        );

        const reactions = updated.rows[0]?.reactions || {};

        // Broadcast to room
        const room = placeId ? `place:${placeId}` : null;
        if (room) {
          io.to(room).emit("message_reactions_update", {
            messageId,
            reactions,
          });
        }

        if (ack) ack({ ok: true, reactions });
      } catch (err) {
        fastify.log.error({ err, messageId, emoji }, "Reaction toggle error");
        if (ack) ack({ ok: false, error: "Failed to toggle reaction" });
      }
    });

    // ── subscribe_live ──────────────────────────────────────
    socket.on("subscribe_live", ({ bbox }) => {
      if (!bbox || bbox.length !== 4) return;
      socketBbox.set(socket.id, bbox);
      // Send initial snapshot immediately
      ensureCentroidCache().then(() => {
        const livePlaces = buildLiveForBbox(bbox);
        socket.emit("live_places_update", {
          added: livePlaces,
          changed: [],
          removed: [],
          ts: Date.now(),
        });
      });
    });

    // ── unsubscribe_live ────────────────────────────────────
    socket.on("unsubscribe_live", () => {
      socketBbox.delete(socket.id);
    });

    // ── disconnect ──────────────────────────────────────────
    socket.on("disconnect", (reason) => {
      const affected = removeAllPresence(socket.id);

      // Broadcast updated presence for each room the user was in
      for (const { placeId, count } of affected) {
        io.to(`place:${placeId}`).emit("room_presence", {
          placeId,
          onlineCount: count,
        });
      }

      scheduleLiveBroadcast();

      fastify.log.info(
        { socketId: socket.id, reason, roomsLeft: affected.length },
        "WS disconnected"
      );
    });
  });

  return io;
}
