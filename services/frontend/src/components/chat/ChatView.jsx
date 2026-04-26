/**
 * src/components/chat/ChatView.jsx
 *
 * Full chat view for a place: message list + typing indicator + input.
 * Integrates with useChatStore for messages, optimistic UI, and typing.
 *
 * Features:
 *  - Auto-scroll to bottom on mount and new messages
 *  - Keyset pagination (scroll to top → loadMore)
 *  - Typing indicator from other users
 *  - Optimistic message rendering
 *  - Empty state
 */

import { useEffect, useRef, useCallback, useMemo } from "react";
import { MessageCircle } from "lucide-react";
import useChatStore from "../../store/useChatStore";
import { getSocket } from "../../lib/socket";
import MessageBubble from "./MessageBubble";
import ChatInput from "./ChatInput";
import TypingIndicator from "./TypingIndicator";
import Skeleton from "../ui/Skeleton";
import "./ChatView.css";

/** Get current user's ID from Telegram WebApp initData */
function getMyUserId() {
  try {
    const user = JSON.parse(
      new URLSearchParams(window.Telegram?.WebApp?.initData || "").get("user") || "{}"
    );
    return user.id ? String(user.id) : null;
  } catch {
    return null;
  }
}

export default function ChatView({ placeId }) {
  const messages = useChatStore((s) => s.messagesByPlace[placeId] || []);
  const isLoading = useChatStore((s) => s.loadingMap[placeId] || false);
  const cursor = useChatStore((s) => s.cursors[placeId]);
  const typingUsers = useChatStore((s) => s.typingUsers[placeId] || {});

  const joinRoom = useChatStore((s) => s.joinRoom);
  const leaveRoom = useChatStore((s) => s.leaveRoom);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const loadMore = useChatStore((s) => s.loadMore);

  const listRef = useRef(null);
  const bottomRef = useRef(null);
  const prevLengthRef = useRef(0);
  const myId = useMemo(getMyUserId, []);

  // ── Join room on mount ────────────────────────────────────
  useEffect(() => {
    if (placeId) {
      joinRoom(placeId);
    }
    return () => {
      if (placeId) leaveRoom();
    };
  }, [placeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-scroll to bottom on new messages ─────────────────
  useEffect(() => {
    if (messages.length > prevLengthRef.current) {
      // New message added → scroll to bottom
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    }
    prevLengthRef.current = messages.length;
  }, [messages.length]);

  // ── Scroll to bottom on initial load ──────────────────────
  useEffect(() => {
    if (!isLoading && messages.length > 0) {
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: "instant" });
      });
    }
  }, [isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Infinite scroll: load older messages ──────────────────
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    // When scrolled near top (reversed list = actual top)
    if (el.scrollTop < 60 && cursor && !isLoading) {
      loadMore(placeId);
    }
  }, [cursor, isLoading, placeId, loadMore]);

  // ── Send message ──────────────────────────────────────────
  const handleSend = useCallback(
    (body) => {
      sendMessage(placeId, body);
    },
    [placeId, sendMessage]
  );

  // ── Typing event ──────────────────────────────────────────
  const handleTyping = useCallback(
    (isTyping) => {
      const socket = getSocket();
      socket.emit("typing", { placeId, isTyping });
    },
    [placeId]
  );

  // ── Determine if message is own ───────────────────────────
  const isOwnMessage = useCallback(
    (msg) => {
      // Optimistic messages are always own
      if (msg.status === "sending" || msg.status === "failed") return true;
      // Match by telegram ID or user.id
      if (myId && msg.user?.id) {
        return String(msg.user.id) === myId || msg.userId === myId;
      }
      return false;
    },
    [myId]
  );

  // ── Should show author (group consecutive messages) ───────
  const shouldShowAuthor = useCallback(
    (msg, idx) => {
      if (isOwnMessage(msg)) return false;
      // Show if first message or different author from previous
      const prev = messages[idx + 1]; // reversed order
      if (!prev) return true;
      return prev.user?.id !== msg.user?.id;
    },
    [messages, isOwnMessage]
  );

  // ── Reversed messages for display (newest at bottom) ──────
  const displayMessages = useMemo(
    () => [...messages].reverse(),
    [messages]
  );

  return (
    <div className="chat-view">
      {/* Messages list */}
      <div className="chat-messages" ref={listRef} onScroll={handleScroll}>
        {/* Load more spinner at top */}
        {isLoading && messages.length > 0 && (
          <div className="chat-load-more">
            <div className="spinner" />
          </div>
        )}

        {/* Initial loading */}
        {isLoading && messages.length === 0 && (
          <div className="chat-skeletons">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className={`msg-row ${i % 3 === 0 ? "msg-row-own" : "msg-row-other"}`}>
                <Skeleton
                  height={40 + Math.random() * 30}
                  width={`${45 + Math.random() * 25}%`}
                  borderRadius={18}
                />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && messages.length === 0 && (
          <div className="chat-empty">
            <MessageCircle size={40} opacity={0.25} />
            <span className="chat-empty-title">Тишина...</span>
            <span className="chat-empty-sub">Напиши первым 👋</span>
          </div>
        )}

        {/* Message bubbles */}
        {displayMessages.map((msg, idx) => (
          <MessageBubble
            key={msg.id || msg.optimisticId}
            message={msg}
            isOwn={isOwnMessage(msg)}
            showAuthor={shouldShowAuthor(msg, messages.length - 1 - idx)}
            placeId={placeId}
          />
        ))}

        {/* Typing indicator */}
        <TypingIndicator users={typingUsers} />

        {/* Scroll anchor */}
        <div ref={bottomRef} className="chat-bottom-anchor" />
      </div>

      {/* Input bar */}
      <ChatInput onSend={handleSend} onTyping={handleTyping} />
    </div>
  );
}
