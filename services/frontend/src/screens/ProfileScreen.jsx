/**
 * src/screens/ProfileScreen.jsx
 *
 * Screen 9: User profile with stats and "Local Expert" level.
 */

import { useState, useEffect } from "react";
import { MessageCircle, Star, Heart, Award, LogOut } from "lucide-react";
import { fetchProfile } from "../lib/api";
import TabBar from "../components/map/TabBar";
import "./ProfileScreen.css";

function StatCard({ icon: Icon, value, label }) {
  return (
    <div className="profile-stat">
      <Icon size={20} className="profile-stat-icon" />
      <span className="profile-stat-value">{value}</span>
      <span className="profile-stat-label">{label}</span>
    </div>
  );
}

export default function ProfileScreen({ onTabChange }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchProfile()
      .then(setProfile)
      .catch((err) => {
        console.error("Profile load error:", err);
        // Mock data for UI preview
        setProfile({
          user: {
            firstName: "User",
            username: null,
            avatarUrl: null,
            createdAt: new Date().toISOString(),
          },
          stats: { reviewsCount: 0, messagesCount: 0, favoritesCount: 0 },
          level: { value: 1, name: "Новичок", progress: 0 },
          favorites: [],
        });
      })
      .finally(() => setLoading(false));
  }, []);

  const user = profile?.user || {};
  const stats = profile?.stats || {};
  const level = profile?.level || { value: 1, name: "Новичок", progress: 0 };
  const initial = (user.firstName || "?")[0];
  const hue = (user.firstName?.charCodeAt(0) || 0) * 37 % 360;

  const joinDate = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString("ru-RU", {
        month: "long",
        year: "numeric",
      })
    : "";

  return (
    <div className="profile-screen">
      {/* ── Header / Avatar ──────────────────────────────── */}
      <div className="profile-header">
        <div
          className="profile-avatar"
          style={{ background: `hsl(${hue}, 50%, 55%)` }}
        >
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" />
          ) : (
            <span className="profile-avatar-initial">{initial}</span>
          )}
        </div>

        <h1 className="profile-name">
          {user.firstName || "Пользователь"}
          {user.lastName ? ` ${user.lastName}` : ""}
        </h1>

        {user.username && (
          <span className="profile-username">@{user.username}</span>
        )}

        {joinDate && (
          <span className="profile-join">На TeleMap с {joinDate}</span>
        )}
      </div>

      {/* ── Level progress ───────────────────────────────── */}
      <div className="profile-level-card glass">
        <div className="profile-level-header">
          <Award size={20} className="profile-level-icon" />
          <span className="profile-level-name">{level.name}</span>
          <span className="profile-level-badge">Уровень {level.value}</span>
        </div>

        <div className="profile-level-bar-track">
          <div
            className="profile-level-bar-fill"
            style={{ width: `${(level.progress * 100).toFixed(0)}%` }}
          />
        </div>

        <span className="profile-level-hint">
          {level.value >= 5
            ? "Максимальный уровень! 🎉"
            : "Пишите отзывы и сообщения, чтобы повысить уровень"}
        </span>
      </div>

      {/* ── Stats grid ───────────────────────────────────── */}
      <div className="profile-stats-grid">
        <StatCard
          icon={Star}
          value={stats.reviewsCount || 0}
          label="Отзывы"
        />
        <StatCard
          icon={MessageCircle}
          value={stats.messagesCount || 0}
          label="Сообщения"
        />
        <StatCard
          icon={Heart}
          value={stats.favoritesCount || 0}
          label="Избранное"
        />
      </div>

      {/* ── Actions ──────────────────────────────────────── */}
      <div className="profile-actions">
        <button
          className="profile-action-row"
          onClick={() => {
            try {
              window.Telegram?.WebApp?.close?.();
            } catch {
              window.close();
            }
          }}
        >
          <LogOut size={18} />
          <span>Выйти из приложения</span>
        </button>
      </div>

      <TabBar active="profile" onChange={onTabChange} />
    </div>
  );
}
