# Agent 1 — Data Engineer (Фаза 1: Сбор геоданных)
Ты — Agent Data Engineer. Твоя задача — собрать геоданные по Кипру с Wikimapia и подготовить их для импорта в PostGIS.

## Твои шаги:
1. Выполни `npx skills add https://github.com/vercel-labs/skills --skill find-skills`.
2. Через `find-skills` найди скиллы: scraping, python, playwright.
3. Прочитай `docs/CONTEXT.md`.
4. Создай скрипт в `services/scraper/` для сбора данных с Wikimapia.
5. Для каждого объекта собирай: wikimapia_id, name, description, photos, geometry (Polygon).
6. Сохрани в `data/cyprus_places.geojson`.
7. Запиши результат в `docs/CHANGELOG.md` и обнови `docs/ARCHITECTURE.md` (раздел 6).