/**
 * src/store/useChatStore.js — Zustand store for chat state.
 *
 * Features:
 *   - Per-room message lists (messagesByPlace)
 *   - Optimistic UI: sendMessage → instant local add → ack/fail from server
 *   - Typing indicators
 *   - Online counter per room
 *   - Keyset pagination (loadMore)
 */

import { create } from "zustand";
import { fetchMessages } from "../lib/api.js";
import { getSocket, onSocketEvent } from "../lib/socket.js";

/** Generate a local UUID for optimistic messages */
function localId() {
  return crypto.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const useChatStore = create((set, get) => ({
  // ── State ──────────────────────────────────────────────

  /** Messages per room: { [placeId]: Message[] } */
  messagesByPlace: {},

  /** Keyset cursors: { [placeId]: string | null } */
  cursors: {},

  /** Loading flags: { [placeId]: boolean } */
  loadingMap: {},

  /** Joined rooms set */
  joinedRooms: {},

  /** Typing users: { [placeId]: { [userId]: firstName } } */
  typingUsers: {},

  /** Online count: { [placeId]: number } */
  onlineCounts: {},

  /** Currently open room */
  currentRoom: null,

  // ── Actions ────────────────────────────────────────────

  /**
   * Join a place chat room: emit WS join, fetch initial messages.
   */
  joinRoom: async (placeId) => {
    const { currentRoom } = get();
    if (currentRoom && currentRoom !== placeId) {
      get().leaveRoom();
    }

    set((s) => ({
      currentRoom: placeId,
      loadingMap: { ...s.loadingMap, [placeId]: true },
      joinedRooms: { ...s.joinedRooms, [placeId]: true },
    }));

    // WS join with ACK
    const socket = getSocket();
    socket.emit("join_room", { placeId }, (res) => {
      if (res?.ok) {
        set((s) => ({
          onlineCounts: { ...s.onlineCounts, [placeId]: res.onlineCount },
        }));
      }
    });

    // Fetch initial messages
    try {
      const data = await fetchMessages(placeId);
      set((s) => ({
        messagesByPlace: { ...s.messagesByPlace, [placeId]: data.messages || [] },
        cursors: { ...s.cursors, [placeId]: data.nextCursor || data.next_cursor || null },
        loadingMap: { ...s.loadingMap, [placeId]: false },
      }));
    } catch (err) {
      console.error("Failed to load messages:", err);
      set((s) => ({
        loadingMap: { ...s.loadingMap, [placeId]: false },
      }));
    }
  },

  /**
   * Load older messages (keyset pagination).
   */
  loadMore: async (placeId) => {
    const pid = placeId || get().currentRoom;
    if (!pid) return;

    const cursor = get().cursors[pid];
    if (!cursor || get().loadingMap[pid]) return;

    set((s) => ({ loadingMap: { ...s.loadingMap, [pid]: true } }));

    try {
      const data = await fetchMessages(pid, { cursor });
      set((s) => ({
        messagesByPlace: {
          ...s.messagesByPlace,
          [pid]: [...(s.messagesByPlace[pid] || []), ...(data.messages || [])],
        },
        cursors: { ...s.cursors, [pid]: data.nextCursor || data.next_cursor || null },
        loadingMap: { ...s.loadingMap, [pid]: false },
      }));
    } catch (err) {
      console.error("Failed to load more:", err);
      set((s) => ({ loadingMap: { ...s.loadingMap, [pid]: false } }));
    }
  },

  /**
   * Send a message with Optimistic UI.
   * Message appears instantly with status='sending',
   * then updates to 'sent' on ACK or 'failed' on error.
   */
  sendMessage: (placeId, body, replyToId) => {
    const pid = placeId || get().currentRoom;
    if (!pid || !body?.trim()) return;

    const optimisticId = localId();
    const trimmed = body.trim();

    // Optimistic message — added to the top of the list immediately
    const optimisticMsg = {
      id: optimisticId,
      optimisticId,
      placeId: pid,
      body: trimmed,
      replyToId: replyToId || null,
      mentions: [],
      createdAt: new Date().toISOString(),
      status: "sending",
      user: {
        id: "me", // will be replaced on ACK
        username: window.Telegram?.WebApp?.initDataUnsafe?.user?.username || null,
        firstName: window.Telegram?.WebApp?.initDataUnsafe?.user?.first_name || "You",
        avatarUrl: null,
      },
    };

    set((s) => ({
      messagesByPlace: {
        ...s.messagesByPlace,
        [pid]: [optimisticMsg, ...(s.messagesByPlace[pid] || [])],
      },
    }));

    // Emit via WS
    const socket = getSocket();
    socket.emit(
      "send_message",
      { placeId: pid, body: trimmed, replyToId: replyToId || undefined, optimisticId },
      (res) => {
        if (res?.ok) {
          get().ackMessage(optimisticId, res.message);
        } else {
          get().failMessage(optimisticId);
        }
      }
    );
  },

  /**
   * ACK: replace optimistic message with server-confirmed version.
   */
  ackMessage: (optimisticId, serverMsg) => {
    set((s) => {
      const pid = serverMsg.placeId;
      const messages = (s.messagesByPlace[pid] || []).map((m) =>
        m.optimisticId === optimisticId
          ? { ...serverMsg, status: "sent", optimisticId: undefined }
          : m
      );
      return { messagesByPlace: { ...s.messagesByPlace, [pid]: messages } };
    });
  },

  /**
   * Mark optimistic message as failed.
   */
  failMessage: (optimisticId) => {
    set((s) => {
      const updated = {};
      for (const [pid, msgs] of Object.entries(s.messagesByPlace)) {
        updated[pid] = msgs.map((m) =>
          m.optimisticId === optimisticId ? { ...m, status: "failed" } : m
        );
      }
      return { messagesByPlace: updated };
    });
  },

  /**
   * Receive a message from another user (via WS broadcast).
   * Skips if it's our own optimistic message (already handled by ACK).
   */
  receiveMessage: (msg) => {
    set((s) => {
      const pid = msg.placeId;
      const existing = s.messagesByPlace[pid] || [];

      // Skip if we already have this message (ACK'd optimistic)
      if (existing.some((m) => m.id === msg.id)) return s;

      return {
        messagesByPlace: {
          ...s.messagesByPlace,
          [pid]: [msg, ...existing],
        },
      };
    });
  },

  /**
   * Update typing indicator state.
   */
  setTyping: (placeId, userId, firstName, isTyping) => {
    set((s) => {
      const current = { ...(s.typingUsers[placeId] || {}) };
      if (isTyping) {
        current[userId] = firstName;
      } else {
        delete current[userId];
      }
      return { typingUsers: { ...s.typingUsers, [placeId]: current } };
    });
  },

  /**
   * Toggle a reaction on a message (optimistic + WS emit).
   */
  toggleReaction: (placeId, messageId, emoji) => {
    const socket = getSocket();
    socket.emit("toggle_reaction", { messageId, emoji, placeId });
  },

  /**
   * Update reactions for a message (from WS broadcast).
   */
  updateReactions: (messageId, reactions) => {
    set((s) => {
      const updated = {};
      for (const [pid, msgs] of Object.entries(s.messagesByPlace)) {
        updated[pid] = msgs.map((m) =>
          m.id === messageId ? { ...m, reactions } : m
        );
      }
      return { messagesByPlace: updated };
    });
  },

  /**
   * Leave the current room.
   */
  leaveRoom: () => {
    const { currentRoom } = get();
    if (currentRoom) {
      const socket = getSocket();
      socket.emit("leave_room", { placeId: currentRoom });
    }
    set((s) => ({
      currentRoom: null,
      joinedRooms: { ...s.joinedRooms, [s.currentRoom]: false },
    }));
  },
}));

// ── Auto-subscribe to WS events ────────────────────────────

onSocketEvent("new_message", (msg) => {
  useChatStore.getState().receiveMessage(msg);
});

onSocketEvent("message_ack", ({ optimisticId, message }) => {
  useChatStore.getState().ackMessage(optimisticId, message);
});

onSocketEvent("message_failed", ({ optimisticId }) => {
  useChatStore.getState().failMessage(optimisticId);
});

onSocketEvent("room_presence", ({ placeId, onlineCount }) => {
  useChatStore.setState((s) => ({
    onlineCounts: { ...s.onlineCounts, [placeId]: onlineCount },
  }));
});

onSocketEvent("typing", ({ placeId, user, isTyping }) => {
  useChatStore.getState().setTyping(placeId, user.id, user.firstName, isTyping);

  // Auto-clear typing after 5s
  if (isTyping) {
    setTimeout(() => {
      useChatStore.getState().setTyping(placeId, user.id, user.firstName, false);
    }, 5000);
  }
});

onSocketEvent("message_reactions_update", ({ messageId, reactions }) => {
  useChatStore.getState().updateReactions(messageId, reactions);
});

export default useChatStore;

