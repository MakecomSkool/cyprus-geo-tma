/**
 * src/components/chat/TypingIndicator.jsx
 *
 * Shows "Name is typing... ●●●" with bouncing dot animation.
 */

import "./TypingIndicator.css";

export default function TypingIndicator({ users = {} }) {
  const names = Object.values(users);
  if (names.length === 0) return null;

  const label =
    names.length === 1
      ? `${names[0]} печатает`
      : names.length === 2
        ? `${names[0]} и ${names[1]} печатают`
        : `${names[0]} и ещё ${names.length - 1} печатают`;

  return (
    <div className="typing-indicator">
      <span className="typing-text">{label}</span>
      <span className="typing-dots">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </span>
    </div>
  );
}
