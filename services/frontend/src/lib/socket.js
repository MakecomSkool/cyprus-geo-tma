/**
 * src/lib/socket.js — Socket.IO client singleton.
 * Connects to the backend with Telegram initData auth.
 * Exposes event subscription helpers for stores.
 */

import { io } from "socket.io-client";

const WS_URL = import.meta.env.VITE_WS_URL || window.location.origin;

let socket = null;

export function getSocket() {
  if (socket) return socket;

  const initData = window.Telegram?.WebApp?.initData || "";

  socket = io(WS_URL, {
    path: "/ws/",
    auth: { initData },
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30_000,
    randomizationFactor: 0.5,
    reconnectionAttempts: 20,
    timeout: 10_000,
  });

  socket.on("connect", () => {
    console.log("[WS] Connected:", socket.id);
  });

  socket.on("disconnect", (reason) => {
    console.log("[WS] Disconnected:", reason);
  });

  socket.on("connect_error", (err) => {
    console.error("[WS] Connect error:", err.message);
  });

  socket.on("error", (err) => {
    console.error("[WS] Server error:", err);
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

/**
 * Subscribe to a server event. Returns unsubscribe function.
 */
export function onSocketEvent(event, handler) {
  const s = getSocket();
  s.on(event, handler);
  return () => s.off(event, handler);
}
