/**
 * src/components/chat/MessageBubble.jsx
 *
 * Single chat message bubble with reaction support.
 * - Own messages: right-aligned, primary bg, white text
 * - Others: left-aligned, secondary bg, author name in link color
 * - Optimistic (sending): opacity 0.6
 * - Reactions: emoji pills below bubble, long-press to add
 */

import { useState, useCallback } from "react";
import useChatStore from "../../store/useChatStore";
import "./MessageBubble.css";

const EMOJI_OPTIONS = ["👍", "❤️", "😂", "🔥", "😮", "👎"];

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function MessageBubble({ message, isOwn, showAuthor = true, placeId }) {
  const [showPicker, setShowPicker] = useState(false);
  const toggleReaction = useChatStore((s) => s.toggleReaction);

  const statusClass = message.status === "sending"
    ? "bubble-sending"
    : message.status === "failed"
      ? "bubble-failed"
      : "";

  const reactions = message.reactions || {};
  const hasReactions = Object.keys(reactions).length > 0;

  const handleReact = useCallback((emoji) => {
    toggleReaction(placeId, message.id, emoji);
    setShowPicker(false);
  }, [placeId, message.id, toggleReaction]);

  const handleLongPress = useCallback(() => {
    if (message.status === "sending") return;
    setShowPicker((v) => !v);
  }, [message.status]);

  // Close picker on outside tap
  const handleBubbleClick = useCallback(() => {
    if (showPicker) setShowPicker(false);
  }, [showPicker]);

  return (
    <div className={`msg-row ${isOwn ? "msg-row-own" : "msg-row-other"}`}>
      {/* Avatar for others */}
      {!isOwn && showAuthor && (
        <div
          className="msg-avatar"
          style={{
            background: `hsl(${(message.user?.firstName?.charCodeAt(0) || 0) * 37 % 360}, 55%, 55%)`,
          }}
        >
          {(message.user?.firstName || "?")[0]}
        </div>
      )}
      {!isOwn && !showAuthor && <div className="msg-avatar-spacer" />}

      <div className="msg-bubble-wrap">
        <div
          className={`msg-bubble ${isOwn ? "msg-own" : "msg-other"} ${statusClass}`}
          onDoubleClick={handleLongPress}
          onContextMenu={(e) => { e.preventDefault(); handleLongPress(); }}
          onClick={handleBubbleClick}
        >
          {!isOwn && showAuthor && (
            <div className="msg-author">
              {message.user?.firstName || message.user?.username || "User"}
            </div>
          )}

          <div className="msg-body">{message.body}</div>

          <div className="msg-meta">
            <span className="msg-time">{formatTime(message.createdAt || message.created_at)}</span>
            {message.status === "failed" && (
              <span className="msg-failed-icon" title="Не отправлено">⚠️</span>
            )}
          </div>
        </div>

        {/* Reaction pills */}
        {hasReactions && (
          <div className={`msg-reactions ${isOwn ? "msg-reactions-own" : ""}`}>
            {Object.entries(reactions).map(([emoji, count]) => (
              <button
                key={emoji}
                className="msg-reaction-pill"
                onClick={() => handleReact(emoji)}
              >
                <span className="msg-reaction-emoji">{emoji}</span>
                <span className="msg-reaction-count">{count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Emoji picker */}
        {showPicker && (
          <div className={`msg-emoji-picker ${isOwn ? "msg-emoji-picker-own" : ""}`}>
            {EMOJI_OPTIONS.map((emoji) => (
              <button
                key={emoji}
                className="msg-emoji-btn"
                onClick={() => handleReact(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
