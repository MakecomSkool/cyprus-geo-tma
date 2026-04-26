/**
 * src/components/chat/ChatInput.jsx
 *
 * Auto-growing textarea (1–5 lines) with send button.
 * Emits typing events on keystroke (debounced).
 */

import { useRef, useState, useCallback, useEffect } from "react";
import { Send } from "lucide-react";
import "./ChatInput.css";

const MAX_ROWS = 5;
const LINE_HEIGHT = 22; // px

export default function ChatInput({ onSend, onTyping, disabled = false }) {
  const [text, setText] = useState("");
  const textareaRef = useRef(null);
  const typingTimerRef = useRef(null);

  // Auto-grow textarea
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxH = LINE_HEIGHT * MAX_ROWS + 16; // padding
    el.style.height = Math.min(el.scrollHeight, maxH) + "px";
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [text, adjustHeight]);

  // Typing indicator with debounce
  const emitTyping = useCallback(
    (isTyping) => {
      onTyping?.(isTyping);
    },
    [onTyping]
  );

  const handleChange = useCallback(
    (e) => {
      const val = e.target.value;
      if (val.length > 2000) return;
      setText(val);

      // Emit typing start
      emitTyping(true);

      // Clear previous timer and set new stop-typing timer
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        emitTyping(false);
      }, 2000);
    },
    [emitTyping]
  );

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;

    onSend?.(trimmed);
    setText("");
    emitTyping(false);
    clearTimeout(typingTimerRef.current);

    // Reset height
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    });
  }, [text, onSend, emitTyping]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const canSend = text.trim().length > 0 && !disabled;

  return (
    <div className="chat-input-wrap">
      <textarea
        ref={textareaRef}
        className="chat-textarea"
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Сообщение..."
        rows={1}
        maxLength={2000}
        disabled={disabled}
        enterKeyHint="send"
      />
      <button
        className={`chat-send-btn ${canSend ? "chat-send-active" : ""}`}
        onClick={handleSend}
        disabled={!canSend}
        aria-label="Отправить"
      >
        <Send size={18} />
      </button>
    </div>
  );
}
