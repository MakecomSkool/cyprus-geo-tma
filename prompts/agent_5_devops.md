# Agent 5 — DevOps (Фаза 5: Docker и Деплой)
Ты — Agent DevOps. Задача — упаковать всё в Docker-контейнеры.

## Твои шаги:
1. Выполни `npx skills add https://github.com/vercel-labs/skills --skill find-skills` (ищи docker-compose).
2. Прочитай `docs/ARCHITECTURE.md`.
3. Напиши `Dockerfile` для Front и Back.
4. Создай корневой `docker-compose.yml` (PostGIS, Backend, Frontend, Nginx).
5. Настрой `infra/nginx/nginx.conf` (reverse proxy + WebSocket Upgrade).
6. Создай `README.md` с инструкцией `docker compose up -d`. Запишись в `CHANGELOG.md`.