/**
 * src/components/BottomSheet.jsx — Draggable bottom sheet with chat UI.
 *
 * - Opens when a place is selected
 * - Drag to dismiss via Framer Motion
 * - Header: place name
 * - Messages feed with keyset pagination
 * - Chat input for sending messages
 */

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import useMapStore from "../store/useMapStore";
import useChatStore from "../store/useChatStore";

export default function BottomSheet() {
  const selectedPlace = useMapStore((s) => s.selectedPlace);
  const clearSelection = useMapStore((s) => s.clearSelection);

  const { messages, loading, hasMore, joinRoom, leaveRoom, sendMessage, loadMore } =
    useChatStore();

  const [input, setInput] = useState("");
  const listRef = useRef(null);

  // Join/leave room when selection changes
  useEffect(() => {
    if (selectedPlace) {
      joinRoom(selectedPlace.id);
    }
    return () => {
      if (selectedPlace) leaveRoom();
    };
  }, [selectedPlace?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = () => {
    if (!input.trim()) return;
    sendMessage(input);
    setInput("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClose = () => {
    clearSelection();
  };

  // Get current user's telegram_id for "mine" styling
  const myTelegramId = (() => {
    try {
      const user = JSON.parse(
        new URLSearchParams(window.Telegram?.WebApp?.initData || "").get("user") || "{}"
      );
      return user.id;
    } catch {
      return 1; // dev user
    }
  })();

  return (
    <AnimatePresence>
      {selectedPlace && (
        <>
          {/* Overlay */}
          <motion.div
            className="sheet-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleClose}
          />

          {/* Panel */}
          <motion.div
            className="sheet-panel"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 350 }}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={0.1}
            onDragEnd={(_, info) => {
              if (info.offset.y > 100 || info.velocity.y > 500) {
                handleClose();
              }
            }}
          >
            {/* Handle */}
            <div className="sheet-handle" />

            {/* Header */}
            <div className="sheet-header">
              <h2>{selectedPlace.name || "Unknown place"}</h2>
              {selectedPlace.description && (
                <p>{selectedPlace.description.slice(0, 100)}</p>
              )}
            </div>

            {/* Messages */}
            <div className="messages-list" ref={listRef}>
              {messages.length === 0 && !loading && (
                <div className="empty-state">
                  <span className="icon">💬</span>
                  <span>No messages yet</span>
                  <span style={{ fontSize: 13 }}>Be the first to say something!</span>
                </div>
              )}

              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`message-bubble ${
                    msg.user?.telegram_id === myTelegramId ? "mine" : "other"
                  }`}
                >
                  {msg.user?.telegram_id !== myTelegramId && (
                    <div className="message-author">
                      {msg.user?.first_name || msg.user?.username || "User"}
                    </div>
                  )}
                  <div>{msg.body}</div>
                  <div className="message-meta">
                    {new Date(msg.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              ))}

              {loading && <div className="spinner" />}

              {hasMore && !loading && (
                <button
                  onClick={loadMore}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--tg-link)",
                    padding: "8px",
                    cursor: "pointer",
                    fontSize: 14,
                    alignSelf: "center",
                  }}
                >
                  Load older messages
                </button>
              )}
            </div>

            {/* Input */}
            <div className="chat-input-bar">
              <input
                type="text"
                placeholder="Message..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                maxLength={2000}
              />
              <button onClick={handleSend} disabled={!input.trim()}>
                ↑
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
