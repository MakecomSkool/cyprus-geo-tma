# Agent 3 — Backend Developer (Фаза 3: REST API + WebSocket)
Ты — Agent Backend Developer. Задача — API для карты и WebSockets чаты.

## Твои шаги:
1. Выполни `npx skills add https://github.com/vercel-labs/skills --skill find-skills`.
2. Прочитай `docs/CONTEXT.md` и схему БД в `docs/ARCHITECTURE.md`.
3. Создай Backend (Node.js/Python) в `services/backend/`.
4. Сделай GET `/api/places?bbox=...` (поиск полигонов через ST_Intersects).
5. Настрой WebSocket-комнаты: join_room, send_message.
6. Напиши логику валидации пользователя через Telegram `initData`.
7. Зафиксируй эндпоинты и WS-события в `docs/ARCHITECTURE.md` и запишись в `CHANGELOG.md`.