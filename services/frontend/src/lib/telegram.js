/**
 * src/lib/telegram.js
 *
 * Telegram WebApp SDK initialization and utility functions.
 *
 * Responsibilities:
 *  - ready() + expand()
 *  - Parse start_param for deep links (place_<id>)
 *  - Read user data from initDataUnsafe
 *  - Theme color application
 *  - Haptic feedback helpers
 */

/**
 * Initialize Telegram WebApp. Call once on app mount.
 * Returns parsed deep link info if present.
 */
export function initTelegram() {
  const tg = window.Telegram?.WebApp;
  if (!tg) {
    console.log("[TMA] Not inside Telegram, running in dev mode");
    return { deepLink: null, user: null, colorScheme: "light" };
  }

  // Signal readiness to Telegram
  tg.ready();

  // Expand to full screen
  tg.expand();

  // Disable vertical swipe to close (keeps sheet drag working)
  if (tg.disableVerticalSwipes) {
    tg.disableVerticalSwipes();
  }

  // Apply theme
  const colorScheme = tg.colorScheme || "light";
  document.documentElement.setAttribute("data-theme", colorScheme);

  // Listen for theme changes
  tg.onEvent("themeChanged", () => {
    document.documentElement.setAttribute(
      "data-theme",
      tg.colorScheme || "light"
    );
  });

  // Parse deep link (start_param)
  const startParam = tg.initDataUnsafe?.start_param || "";
  let deepLink = null;

  if (startParam.startsWith("place_")) {
    deepLink = {
      type: "place",
      id: startParam.slice(6), // remove "place_" prefix
    };
  }

  // User info
  const rawUser = tg.initDataUnsafe?.user || null;
  const user = rawUser
    ? {
        id: rawUser.id,
        firstName: rawUser.first_name,
        lastName: rawUser.last_name || null,
        username: rawUser.username || null,
        languageCode: rawUser.language_code || "en",
        isPremium: rawUser.is_premium || false,
      }
    : null;

  return { deepLink, user, colorScheme };
}

/**
 * Get current Telegram user or null.
 */
export function getTelegramUser() {
  const raw = window.Telegram?.WebApp?.initDataUnsafe?.user;
  if (!raw) return null;
  return {
    id: raw.id,
    firstName: raw.first_name,
    lastName: raw.last_name || null,
    username: raw.username || null,
  };
}

/**
 * Trigger haptic feedback (if available).
 */
export function haptic(type = "impact", style = "light") {
  const hf = window.Telegram?.WebApp?.HapticFeedback;
  if (!hf) return;

  switch (type) {
    case "impact":
      hf.impactOccurred(style); // light | medium | heavy | rigid | soft
      break;
    case "notification":
      hf.notificationOccurred(style); // error | success | warning
      break;
    case "selection":
      hf.selectionChanged();
      break;
  }
}

/**
 * Show Telegram native confirm dialog.
 */
export function showConfirm(message) {
  return new Promise((resolve) => {
    const tg = window.Telegram?.WebApp;
    if (tg?.showConfirm) {
      tg.showConfirm(message, resolve);
    } else {
      resolve(window.confirm(message));
    }
  });
}

/**
 * Close the Mini App.
 */
export function closeApp() {
  window.Telegram?.WebApp?.close();
}
