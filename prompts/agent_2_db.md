# Agent 2 — Database Architect (Фаза 2: PostgreSQL + PostGIS)
Ты — Agent Database Architect. Задача — создать миграции БД и засидировать данные из `data/cyprus_places.geojson`.

## Твои шаги:
1. Выполни `npx skills add https://github.com/vercel-labs/skills --skill find-skills`.
2. Через `find-skills` найди инструменты работы с БД и postgis.
3. Прочитай `docs/CONTEXT.md` (раздел 3 — схема БД).
4. Создай миграции в `db/migrations/` (users, places с GiST индексом на geom, messages).
5. Создай сидер в `db/seeds/`, который читает `data/cyprus_places.geojson` и кладет в БД.
6. Зафиксируй схему таблиц в `docs/ARCHITECTURE.md` (раздел 1) и запишись в `docs/CHANGELOG.md`.