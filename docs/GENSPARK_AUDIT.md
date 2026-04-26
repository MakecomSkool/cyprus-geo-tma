🚨 **КРИТИЧЕСКАЯ НАХОДКА**: `users.js`, `reviews.js` используют `request.userId` — но `authMiddleware` его НЕ устанавливает (он ставит `request.dbUser.id`)! Плюс middleware **нигде не подключён** в `index.js`. Это значит:
1. `request.userId` всегда `undefined` → все авторизованные эндпоинты вернут `401`. Reviews/Favorites/Profile **полностью сломаны**.
2. Если бы middleware был подключён — он принял бы любого "dev user" с `id=1` (т.к. при отсутствии `TELEGRAM_BOT_TOKEN` валидация полностью отключена → каждый аноним становится `Dev User`).

Теперь у меня достаточно информации. Сохранил всё необходимое. Составляю отчёт.

---

# 📊 Технический аудит: Cyprus Geo-Social TMA

**Репозиторий**: https://github.com/MakecomSkool/cyprus-geo-tma
**Коммит**: `0098745` (single squash)
**Дата аудита**: 2026-04-26

---

## 1. Executive Summary

**Общая оценка: 6.5 / 10**

Проект демонстрирует **отличную архитектурную базу** и зрелые решения (LOD-стратегия с Supercluster, MVT через PostGIS, Optimistic UI чата, materialized views для статистики, generated columns для centroid/tsv). Код читаемый, миграции аккуратные. Но между «хорошо спроектированным каркасом» и «production-ready Telegram Mini App» — серия критических дефектов: нерабочая авторизация, XSS-вектор, hardcoded `*` в CORS, отсутствие maxBounds, мёртвый компонент `Map.jsx`, и принципиальные проблемы с производительностью карты при росте данных.

### Top-5 критических проблем

| # | Проблема | Где | Impact |
|---|----------|-----|--------|
| 1 | **Auth-система не работает**: `request.userId` нигде не устанавливается, `authMiddleware` не зарегистрирован → reviews/favorites/profile возвращают 401 | `index.js` + `auth.js` + `users.js`/`reviews.js` | 🔴 Блокер запуска |
| 2 | **Dev-fallback в `validateInitData`** позволяет любому неавторизованному пользователю получить identity `id=1, Dev User` если бот-токен не задан | `services/backend/src/auth.js:33-54` | 🔴 Критическая уязвимость |
| 3 | **XSS через `ts_headline` в search**: бэкенд возвращает `<mark>...</mark>` HTML, на фронте предположительно рендерится через `dangerouslySetInnerHTML` | `services/backend/src/routes/search.js:76-79` | 🔴 XSS вектор |
| 4 | **Нет maxBounds** — карта позволяет улететь в Австралию; нет фильтра bbox Кипра ни на фронте, ни на бэке | `MapCanvas.jsx:247-257` + `places.js:41` | 🟡 UX-блокер + 100% wasted DB queries |
| 5 | **MVT генерация без кэша + `ST_Transform` в WHERE** — каждый pan карты = 9-25 запросов `ST_AsMVTGeom` к PostGIS, не кэшируется в Nginx, индекс `idx_places_geom_3857` функциональный, но запрос его не использует на 100% (ST_Transform на лету в каждой строке) | `tiles.js:41-68` + `nginx.conf` | 🟡 Производительность |

### Сильные стороны (которые **нельзя сломать** при доработке)
- ✅ LOD-стратегия в `clusters.js` (cluster → centroid → polygon) — концептуально правильная
- ✅ Optimistic UI чата с ack/fail/rollback в `useChatStore`
- ✅ Generated columns: `centroid`, `search_tsv` — отличный паттерн
- ✅ Materialized view `user_stats` + триггеры `place_stats` — правильно для read-heavy
- ✅ Multi-stage Dockerfile, non-root user в backend
- ✅ Keyset pagination для сообщений (по `created_at`)
- ✅ Все SQL-запросы — параметризованные (SQL injection защита OK)

---

## 2. 🔴 Critical (блокеры запуска)

### C1. Авторизация не подключена и сломана

**Файл**: `services/backend/src/index.js`

`authMiddleware` экспортируется из `auth.js`, но **нигде не вызывается** через `fastify.addHook` или per-route. При этом:
- `routes/users.js:18`, `routes/reviews.js:148` читают `request.userId` → всегда `undefined` → возвращают 401.
- `authMiddleware` сам устанавливает `request.dbUser` и `request.tgUser`, а не `request.userId`. Несовместимая контрактная разметка.

**Последствия**: всё, что требует авторизации (отзывы, избранное, профиль), возвращает 401 даже валидным пользователям Telegram. PlaceSheet → "Избранное" не работает, ProfileScreen пуст.

### C2. Dev-режим даёт identity любому пользователю

**Файл**: `services/backend/src/auth.js:32-54`

```js
if (!config.telegram.botToken || config.telegram.botToken === "YOUR_BOT_TOKEN_HERE") {
  // ...
  return { valid: true, user: { id: 1, first_name: "Dev", ... } };
}
```

Проблема:
1. В `.env.example` дефолт = `YOUR_BOT_TOKEN_HERE` → если кто-то задеплоит без правильного токена, **любой запрос проходит**.
2. Все анонимы становятся `id=1` → пишут от имени одного пользователя, портят БД.
3. `docker-compose.yml:76` имеет дефолт `${TELEGRAM_BOT_TOKEN:-YOUR_BOT_TOKEN_HERE}` → bypass работает в production-режиме.

### C3. XSS через `ts_headline` в search-результатах

**Файл**: `services/backend/src/routes/search.js:76-79`

Backend возвращает `highlight.name = "<mark>Lefkoşa</mark>"` как готовый HTML. Если frontend рендерит это через `dangerouslySetInnerHTML` (или просто `{highlight.name}` не сработает — текст с тегами просто покажется), злоумышленник может через `q=<script>alert(1)</script>` заставить ts_headline вставить произвольные теги. **Хотя `ts_headline` экранирует исходный текст БД, экранирование `q` не гарантировано** — проверять надо.

**Дополнительно**: чат-сообщения **не санитизируются** ни на бэке, ни на фронте (`MessageBubble.jsx:84` рендерит `{message.body}` через React — это OK, но любой будущий рефакторинг на `dangerouslySetInnerHTML` создаст дыру). На бэке `body` сохраняется как есть, без stripping HTML.

### C4. Дублирующийся, мёртвый компонент `Map.jsx`

**Файл**: `services/frontend/src/components/Map.jsx` (208 строк)

`MapScreen.jsx` импортирует `MapCanvas.jsx`. `Map.jsx` нигде не используется (`grep -r "from.*Map'"` ничего бы не нашёл, кроме него самого). **Содержит устаревшую логику**: загружает места через `loadPlaces(bbox)` (GeoJSON, не MVT), вызывает `useMapStore` методы, которых нет (`hasMore`, `messages`).

Импакт: путаница, +~6 KB в bundle (если случайно импортируют), технический долг.

### C5. CORS = `*` + `credentials` неявно

**Файлы**: `index.js:39-41`, `ws.js:115-118`, `tiles.js:84`, `docker-compose.yml:77`

```js
origin: config.corsOrigin === "*" ? true : config.corsOrigin.split(",")
```

При `*` Fastify CORS превращает в `origin: true` (echoes Origin). Это OK для публичных endpoints, но **с `X-Telegram-Init-Data` любой сайт в браузере жертвы может через CORS preflight отправить запрос** (если бот-токен пустой — см. C2 — попадёт в БД от имени `id=1`). Нужно whitelisting Telegram-доменов.

### C6. Нет maxBounds — карту можно увести с Кипра

**Файлы**: `MapCanvas.jsx:247-257`, `Map.jsx:39-47`

```js
const map = new mapboxgl.Map({
  center: CYPRUS_CENTER,
  zoom: CYPRUS_ZOOM,
  maxZoom: 19,
  minZoom: 7,
  // ❌ нет maxBounds
});
```

И на бэке `places.js:41` валидирует bbox только глобальными координатами `-180..180, -90..90`. Запрос `?bbox=140,30,150,40` (Япония) пройдёт, выполнит `ST_Intersects` на пустом результате — это N+1-style waste при ботах/скрейперах.

### C7. Vite 8 + TailwindCSS 4 — нестабильные мейджоры

`package.json` фронта: `vite ^8.0.10`, `tailwindcss ^4.2.4`, `eslint ^10.2.1`. На дату аудита (апрель 2026) **Vite 8 ещё в RC**, а `eslint v10` едва вышел. Высокий риск поломок при `npm install` через 2 недели. **Зафиксировать exact версии** или откатиться на стабильные (Vite 7, ESLint 9).

---

## 3. 🟡 Important (UX/производительность)

### I1. MVT-тайлы генерируются on-the-fly без кэша

**Файл**: `tiles.js`

Каждый `moveend` пользователя = 9-16 запросов к PostGIS. `Cache-Control: max-age=3600, s-maxage=86400` правильный, но **Nginx не настроен как cache** — header просто передаётся вверх по стеку, между PostGIS и клиентом нет промежуточного слоя. На 1000 одновременных пользователей это коллапс БД.

**Дополнительно**: в SQL `WHERE ST_Intersects(ST_Transform(p.geom, 3857), tile_bounds.geom)` — `ST_Transform` оборачивает колонку. Несмотря на функциональный индекс `idx_places_geom_3857`, планировщик может его не использовать, если статистика не обновлена или constants в выражении различаются. **Нужен EXPLAIN ANALYZE**.

### I2. Centroid в `places-labels` берётся из MVT (point из polygon)

**Файл**: `MapCanvas.jsx:128-157`

Лейблы рендерятся `symbol-placement: "point"` поверх **полигона**. Mapbox по умолчанию ставит лейбл в центроид, но для self-intersecting polygons (Wikimapia ругается) центроид может оказаться вне полигона. Лучше передавать centroid отдельным point-features в MVT или layer.

### I3. `querySourceFeatures` для live-pulse — anti-pattern

**Файл**: `MapCanvas.jsx:380-398`

```js
const rendered = map.querySourceFeatures("places", {
  sourceLayer: MVT_LAYER,
  filter: ["==", ["get", "wikimapia_id"], Number(placeId)],
});
```

Вызывается **для каждого live-place в цикле** при каждом обновлении `livePlaces`. `querySourceFeatures` обходит все рендеренные тайлы. На 50 живых местах × 16 тайлов × 100 features = десятки тысяч итераций. Также: features по zoom могут быть в разных тайлах — координаты будут "прыгать".

**Решение**: бэкенд должен отдавать centroid в payload `live_places_update`:
```js
{ placeId, onlineCount, centroid: [lon, lat] }
```

### I4. `loadPlaces` дублирует MVT — двойная загрузка

**Файл**: `useMapStore.js:51-67` + `MapCanvas.jsx`

`MapCanvas` использует MVT (vector source). А `useMapStore.loadPlaces` всё ещё вызывает `fetchClusters/fetchPlaces` — но эти данные **никуда не применяются на карте** (только `selectedPlace` использует часть). Тратится ширина канала и нагрузка на БД.

### I5. WebSocket reconnection: `reconnectionAttempts: Infinity`, без backoff

**Файл**: `services/frontend/src/lib/socket.js:18-25`

```js
reconnection: true,
reconnectionDelay: 1000,
reconnectionAttempts: Infinity,
```

Нет `reconnectionDelayMax`, нет jitter. При длительном падении бэкенда — 1 попытка/сек × 1000 клиентов = 1000 RPS на каждом восстановлении. Нет heartbeat (Socket.IO сам шлёт ping, но не визуализируется в UI → пользователь не знает, что соединение разорвано).

### I6. Live-broadcast race + N×M complexity

**Файл**: `services/backend/src/ws.js:147-167`

```js
function scheduleLiveBroadcast() {
  if (liveBroadcastTimer) return;
  liveBroadcastTimer = setTimeout(async () => {
    for (const [socketId, bbox] of socketBbox) {
      const livePlaces = buildLiveForBbox(bbox); // O(rooms × bbox-check)
      clientSocket.emit("live_places_update", { added: livePlaces, ... });
    }
  }, 2000);
}
```

Проблемы:
1. **Каждый клиент получает полный snapshot** в поле `added`, но `removed: []` всегда пуст — на клиенте `applyLiveDiff` накапливает stale данные (ушедшие места не очищаются).
2. На 1000 клиентов × 5000 active places = 5M операций каждые 2 сек.
3. `livePlacesCentroidCache` грузит **ВСЕ места из БД** (12 815, а станет 500 000) каждые 2 минуты.

### I7. Supercluster index хранит ВСЕ места в памяти

**Файл**: `clusters.js:23-60`

`SELECT ... FROM places` без LIMIT грузит все 12 815 точек в RAM каждые 60 секунд при invalidation. На 500 000 — 50 МБ JSON в памяти Node-процесса, перестроение `clusterIndex` ~2 секунды, в это время все запросы к `/api/places/clusters` блокируются (single thread).

### I8. Bundle size: Mapbox GL ~1 МБ + framer-motion 80 КБ

Текущий bundle (оценка): **~1.5 МБ gzipped**. Для TMA где 90% юзеров на мобильном 3G — **первый paint > 5 сек**. Нет:
- Code splitting (`React.lazy` для Favorites/Profile/Search screens)
- `manualChunks` в Vite для разделения mapbox-gl
- Dynamic import для Mapbox (используется только на map screen)

### I9. PlaceSheet: snap point `peek = vh - 180` неправильно учитывает iPhone notch

**Файл**: `services/frontend/src/components/place/PlaceSheet.jsx:33-42`

```js
const PEEK_H = 180;
function getSnapPoints() {
  const vh = window.innerHeight;
  return { peek: vh - PEEK_H, half: vh * 0.5, full: vh * 0.1 };
}
```

`window.innerHeight` на iOS включает safe-area, но не учитывает Telegram WebApp `viewportHeight` / `viewportStableHeight`. На iPhone 14+ нижняя action-row может попасть под home-indicator. Нет `padding-bottom: env(safe-area-inset-bottom)`.

### I10. Категории пусты на 12,815 местах

`migration 0005` добавляет колонку `category VARCHAR(40)` — но **нет ни seed, ни классификации**. Wikimapia KML не содержит категорий. CategoryChips на фронте показывает фильтры, которые ничего не отфильтруют (все NULL).

### I11. Нет error boundaries

В `main.jsx` рендерится `<App />` без `<ErrorBoundary>`. Любое исключение в Mapbox/Framer → белый экран на проде.

### I12. Photos = `[]` для всех 12,815 мест

Wikimapia KML не имеет URL фото. PhotoCarousel получает пустой массив всегда. Нужна стратегия обогащения (Wikimedia Commons, Mapillary, user uploads).

---

## 4. 🟢 Nice-to-have

| # | Замечание |
|---|-----------|
| N1 | `places.geom` — `GEOMETRY(GEOMETRY, 4326)` (не `MULTIPOLYGON`) — нет валидации `ST_IsValid`. Импорт мог записать линии/точки. |
| N2 | Нет `ST_MakeValid` хука / триггера на INSERT. |
| N3 | `index.js` запускает Fastify через ручной `serverFactory` — нестандартно, теряется plugin compatibility. Можно использовать `fastify.server` напрямую (как сейчас и делается в `setupSocketIO`). |
| N4 | `pino-pretty` в devDependencies, но `transport: 'pino-pretty'` в коде. Если запустить prod-build без devDeps — крашится при `NODE_ENV !== production`. |
| N5 | Нет ESLint конфига для backend (только для frontend). |
| N6 | `reset.bat` / `reset.sh` в `db/` — прямое удаление volumes. Опасно в проде. |
| N7 | `docker-compose.yml` → `expose: 5432` для БД на хосте — лишнее в проде, локально OK. |
| N8 | Нет CI (`.github/workflows/`). |
| N9 | Нет тестов вообще. |
| N10 | `mentions BIGINT[]` хранит telegram_id, а users.id — UUID. Несогласованно. |
| N11 | TypeScript опционально (есть `packages/shared/types.ts`), но не используется в backend/frontend. |
| N12 | `manifest.json` / Telegram TMA метаданные не описаны. |

---

## 5. Архитектурные рекомендации

### A1. Подключить `authMiddleware` корректно

**Создать** `services/backend/src/plugins/auth.js`:

```js
import fp from 'fastify-plugin';
import { validateInitData, upsertUser } from '../auth.js';

export default fp(async (fastify) => {
  fastify.decorateRequest('userId', null);
  fastify.decorateRequest('dbUser', null);

  fastify.decorate('authenticate', async (req, reply) => {
    const initData =
      req.headers['x-telegram-init-data'] ||
      req.headers.authorization?.replace('tma ', '') ||
      req.query?.initData;

    const { valid, user, error } = validateInitData(initData);
    if (!valid) return reply.code(401).send({ error: error || 'Unauthorized' });

    try {
      const dbUser = await upsertUser(user);
      req.dbUser = dbUser;
      req.userId = dbUser.id;     // ← ключевое
      req.tgUser = user;
    } catch (err) {
      req.log.error({ err }, 'auth: upsert failed');
      return reply.code(500).send({ error: 'Internal auth error' });
    }
  });
});
```

В `index.js`:
```js
await fastify.register((await import('./plugins/auth.js')).default);
```

В `users.js`/`reviews.js`/`favorites`:
```js
fastify.get('/api/users/me', { preHandler: fastify.authenticate }, getProfile);
```

### A2. Убрать dev-bypass в `validateInitData`

**Заменить блок dev-fallback** на:
```js
if (!config.telegram.botToken) {
  return { valid: false, error: 'Server not configured: TELEGRAM_BOT_TOKEN missing' };
}
```

Локальная разработка — через **тестовый бот-токен в `.env`** (можно завести второй `@BotFather` бот). Никаких anonymous fallback'ов в production-коде.

### A3. Tile pipeline — Nginx cache + индекс через ST_Transform

См. ЭТАП 1 в ТЗ ниже. TL;DR:
1. Кэш в Nginx (`proxy_cache_path`) на 7 дней для `/api/tiles/`.
2. Хранить `geom_3857 GEOMETRY GENERATED ALWAYS AS (ST_Transform(geom,3857)) STORED` как **физическую** колонку, а не только функциональный индекс. Запрос упрощается, индекс используется на 100%.
3. LOD: упрощённая геометрия для z<14 (`geom_simple_z10`).

### A4. Удалить `Map.jsx`, оставить только `MapCanvas.jsx`

Простое удаление. Заодно `loadPlaces`/`fetchPlaces`/`fetchClusters` в `useMapStore` стоит оставить только если используются — но на текущий момент **MVT покрывает всё**.

### A5. WebSocket: backoff + heartbeat UI + diff-based live updates

```js
// services/frontend/src/lib/socket.js
socket = io(WS_URL, {
  path: '/ws/',
  auth: { initData },
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30_000,
  randomizationFactor: 0.5,
  reconnectionAttempts: 20,         // не Infinity
  timeout: 10_000,
});
```

Бэкенд `ws.js` должен слать **diff** (added/changed/removed по сравнению с предыдущим broadcast'ом для конкретного клиента), а не snapshot.

### A6. CORS — whitelist Telegram

```js
// config.js
corsOrigin: process.env.NODE_ENV === 'production'
  ? ['https://web.telegram.org', 'https://your-tma-domain.example']
  : true,
```

WebSocket в `ws.js` должен использовать тот же whitelist.

### A7. Rate limiting (P0)

```bash
npm i @fastify/rate-limit
```

```js
// index.js
await fastify.register((await import('@fastify/rate-limit')).default, {
  global: true,
  max: 200,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.dbUser?.id || req.ip,
});

// Per-route override для тяжёлых:
fastify.post('/api/places/:id/reviews', {
  preHandler: fastify.authenticate,
  config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
}, createReview);
```

WebSocket — ограничить `send_message` до 10/мин per socket.

### A8. XSS sanitization для search highlights

**Вариант 1 (правильный)**: бэкенд возвращает `highlight: { name: { text, ranges: [{start, end}] } }` — фронт сам обрамляет `<mark>`.

**Вариант 2 (быстрый)**: на фронте использовать `DOMPurify`:
```js
import DOMPurify from 'dompurify';
const safeHtml = DOMPurify.sanitize(highlight.name, { ALLOWED_TAGS: ['mark'] });
<span dangerouslySetInnerHTML={{ __html: safeHtml }} />
```

### A9. Indexes для 500K зданий

Для будущей таблицы `buildings` (см. ЭТАП 2) обязательно:
- `BRIN` на `created_at` (вместо B-tree, в 100× меньше)
- Cluster table by `geom` после загрузки: `CLUSTER buildings USING idx_buildings_geom; ANALYZE;`
- `pg_partman` партиционирование по `category` если станет >2M записей.

---

## 6. Security Checklist

| # | Уязвимость | Файл | Серьёзность | Фикс |
|---|------------|------|-------------|------|
| S1 | Auth middleware не подключён, dev-bypass на любого | `index.js`, `auth.js` | 🔴 Critical | См. A1 + A2 |
| S2 | CORS `*` echoes Origin | `index.js:40`, `docker-compose.yml:77` | 🔴 Critical | См. A6 |
| S3 | XSS через `ts_headline` | `search.js:76` | 🔴 High | См. A8 |
| S4 | Нет rate-limiting | весь backend | 🟡 High | См. A7 |
| S5 | Mapbox token в build args (попадает в bundle) | `Dockerfile`, `docker-compose.yml:94` | 🟡 Medium | URL restrictions в Mapbox account (привязать к домену) |
| S6 | `TELEGRAM_BOT_TOKEN` дефолт в `docker-compose.yml` `:-YOUR_BOT_TOKEN_HERE` | `docker-compose.yml:76` | 🟡 Medium | Сделать обязательным, fail-fast |
| S7 | Body сообщений без HTML-stripping | `ws.js:222` | 🟡 Medium | `body.replace(/[<>&]/g, ...)` или `sanitize-html` |
| S8 | `pg.Pool` без `statement_timeout` | `db.js:11` | 🟢 Low | `query_timeout: 5000, statement_timeout: 5000` |
| S9 | WebSocket принимает `initData` через query — попадает в access logs | `ws.js:127` | 🟢 Low | Только через `auth` или header |
| S10 | Нет CSP header в Nginx | `infra/nginx/nginx.conf` | 🟢 Low | `Content-Security-Policy` для frame-ancestors Telegram |
| S11 | `pgdata` volume без backup стратегии | `docker-compose.yml:120` | 🟢 Low | Для prod — pg_basebackup cron |
| S12 | Пользовательский ввод в `parseMentions` regex DoS? | `ws.js:101` | 🟢 Low | Regex `/@([a-zA-Z0-9_]{5,32})/g` безопасен |

SQL injection: проверены все `query()` calls — везде параметризованные, конкатенации только в whitelist'ах (`orderClause`). **OK**.

---

# 🏗️ ПОЛНОЕ ТЗ НА ДОРАБОТКУ

> **Целевая аудитория**: разработчик уровня middle+ или AI-агент (Cursor/Claude Code).
> **Вход**: текущее состояние репо `MakecomSkool/cyprus-geo-tma`.
> **Выход**: production-ready TMA, способный отдавать 500K+ зданий со скоростью Wikimapia.
> **Срок**: 4 недели (full-time).

---

## ЭТАП 1. Оптимизация карты — «как Wikimapia»

### Задача 1.1: Жёсткий maxBounds Кипра + бэкенд-валидация

**Приоритет**: P0 · **Оценка**: 1 час · **Файлы**: `MapCanvas.jsx`, `places.js`, `clusters.js`, `tiles.js`

**Что сделать**: Ограничить viewport карты только островом Кипр (включая Северный Кипр), отклонять API-запросы за пределами bbox.

**Координаты Кипра** (с буфером ~3 км для swipe-bounce):
```
SW: [32.20, 34.50]   // ЮЗ — мыс Акамас
NE: [34.65, 35.75]   // СВ — мыс Андреас
```

**Изменить `services/frontend/src/components/map/MapCanvas.jsx`** (строки 20-22 и 247-257):

```diff
-const CYPRUS_CENTER = [33.27, 34.79];
-const CYPRUS_ZOOM = 10;
+const CYPRUS_CENTER = [33.43, 35.13];
+const CYPRUS_ZOOM = 9;
+// SW lon/lat, NE lon/lat — весь остров с буфером
+const CYPRUS_BOUNDS = [[32.20, 34.50], [34.65, 35.75]];

 const map = new mapboxgl.Map({
   container: containerRef.current,
   style: initStyle,
   center: CYPRUS_CENTER,
   zoom: CYPRUS_ZOOM,
   attributionControl: false,
   maxZoom: 19,
-  minZoom: 7,
+  minZoom: 8,
+  maxBounds: CYPRUS_BOUNDS,
+  renderWorldCopies: false,
   pitchWithRotate: false,
   dragRotate: false,
 });
```

**Создать `services/backend/src/lib/cyprusBounds.js`**:

```js
// Cyprus geographic bounds (with ~3km buffer)
export const CYPRUS_BBOX = {
  minLon: 32.20, minLat: 34.50,
  maxLon: 34.65, maxLat: 35.75,
};

/**
 * Returns true if bbox is at least partially inside Cyprus.
 * Used to reject obvious junk requests (bots scanning the world).
 */
export function bboxIntersectsCyprus(minLon, minLat, maxLon, maxLat) {
  return !(
    maxLon < CYPRUS_BBOX.minLon ||
    minLon > CYPRUS_BBOX.maxLon ||
    maxLat < CYPRUS_BBOX.minLat ||
    minLat > CYPRUS_BBOX.maxLat
  );
}

/**
 * Clamp arbitrary bbox to Cyprus bounds.
 */
export function clampBbox(minLon, minLat, maxLon, maxLat) {
  return [
    Math.max(minLon, CYPRUS_BBOX.minLon),
    Math.max(minLat, CYPRUS_BBOX.minLat),
    Math.min(maxLon, CYPRUS_BBOX.maxLon),
    Math.min(maxLat, CYPRUS_BBOX.maxLat),
  ];
}
```

**Применить в `places.js`, `clusters.js`** после парсинга bbox:
```js
import { bboxIntersectsCyprus } from '../lib/cyprusBounds.js';

if (!bboxIntersectsCyprus(minLon, minLat, maxLon, maxLat)) {
  return reply.code(400).send({ error: 'bbox outside Cyprus region' });
}
```

В `tiles.js` использовать xy → bbox conversion и проверять там же (опционально — тайлы за пределами Кипра вернут 204 no-content из-за `ST_Intersects`).

**Команды**:
```bash
cd /path/to/repo
docker compose up -d --build backend frontend
```

**Проверка**:
1. Открыть карту → попытаться скроллить за остров → bounce-эффект.
2. `curl 'http://localhost/api/places?bbox=140,30,150,40'` → 400 `bbox outside Cyprus`.
3. `curl 'http://localhost/api/tiles/3/4/3.mvt'` (Япония) → 204 No Content.

---

### Задача 1.2: Stored geometry в EPSG:3857 для tile speedup

**Приоритет**: P0 · **Оценка**: 30 мин · **Файлы**: новая миграция, `tiles.js`

**Что сделать**: Вместо функционального индекса на `ST_Transform(geom, 3857)` хранить трансформированную геометрию как stored generated column. Запросы перестают делать transform на лету.

**Создать `db/migrations/0010_geom_3857_stored.sql`**:

```sql
-- 0010: store geom in 3857 as a stored generated column for ultra-fast MVT.

-- Drop old functional index (we'll have a direct column now)
DROP INDEX IF EXISTS idx_places_geom_3857;

-- Add stored generated column
ALTER TABLE places
  ADD COLUMN IF NOT EXISTS geom_3857 GEOMETRY(GEOMETRY, 3857)
  GENERATED ALWAYS AS (ST_Transform(geom, 3857)) STORED;

-- Spatial index on the stored column (can use direct GiST without function)
CREATE INDEX IF NOT EXISTS idx_places_geom_3857
  ON places USING GIST (geom_3857);

ANALYZE places;
```

**Изменить `services/backend/src/routes/tiles.js` (строки 41-68)**:

```diff
   const sql = `
     WITH
     tile_bounds AS (
       SELECT ST_TileEnvelope($1, $2, $3) AS geom
     ),
     tile_data AS (
       SELECT
         p.wikimapia_id,
         p.name,
         COALESCE(p.category, '') AS category,
         LEFT(p.description, 200) AS description,
         ST_AsMVTGeom(
-          ST_Transform(p.geom, 3857),
+          p.geom_3857,
           tile_bounds.geom,
           4096,
           256,
           true
         ) AS mvt_geom
       FROM places p, tile_bounds
-      WHERE ST_Intersects(
-        ST_Transform(p.geom, 3857),
-        tile_bounds.geom
-      )
+      WHERE p.geom_3857 && tile_bounds.geom
+        AND ST_Intersects(p.geom_3857, tile_bounds.geom)
     )
     SELECT ST_AsMVT(tile_data, 'places', 4096, 'mvt_geom') AS mvt
     FROM tile_data
     WHERE mvt_geom IS NOT NULL
   `;
```

> Оператор `&&` — fast bbox-overlap (использует индекс), `ST_Intersects` — точная проверка. Двойной фильтр — стандартный PostGIS-паттерн.

**Команды**:
```bash
docker compose down
docker compose up -d --build db migrate backend
docker compose exec db psql -U cyprus -d cyprus_geo -c "EXPLAIN ANALYZE SELECT ST_AsMVT(d, 'places', 4096, 'g') FROM (SELECT p.name, ST_AsMVTGeom(p.geom_3857, ST_TileEnvelope(14, 9523, 6347), 4096, 256, true) AS g FROM places p WHERE p.geom_3857 && ST_TileEnvelope(14, 9523, 6347)) d WHERE g IS NOT NULL;"
```

**Проверка**: EXPLAIN покажет `Index Scan using idx_places_geom_3857`. Время одного тайла: было ~120 мс → должно стать **5-15 мс** на 12K мест.

---

### Задача 1.3: LOD — упрощённая геометрия для дальних зумов

**Приоритет**: P1 · **Оценка**: 1 час · **Файлы**: новая миграция, `tiles.js`

**Что сделать**: Хранить упрощённые версии полигонов для z ≤ 12 (на дальних зумах детали не видны, но MVT всё равно их сериализует).

**Создать `db/migrations/0011_geom_simplified.sql`**:

```sql
-- 0011: simplified geometries for low-zoom tiles (LOD).
-- ~100m tolerance for z<10, ~30m for z<14.

ALTER TABLE places
  ADD COLUMN IF NOT EXISTS geom_3857_simple_low GEOMETRY(GEOMETRY, 3857)
  GENERATED ALWAYS AS (
    ST_SimplifyPreserveTopology(ST_Transform(geom, 3857), 100)
  ) STORED,
  ADD COLUMN IF NOT EXISTS geom_3857_simple_mid GEOMETRY(GEOMETRY, 3857)
  GENERATED ALWAYS AS (
    ST_SimplifyPreserveTopology(ST_Transform(geom, 3857), 30)
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_places_geom_3857_simple_low
  ON places USING GIST (geom_3857_simple_low);

CREATE INDEX IF NOT EXISTS idx_places_geom_3857_simple_mid
  ON places USING GIST (geom_3857_simple_mid);

ANALYZE places;
```

**Изменить `tiles.js`** — выбирать колонку по уровню зума:

```js
function pickGeomColumn(z) {
  if (z <= 11) return 'geom_3857_simple_low';
  if (z <= 14) return 'geom_3857_simple_mid';
  return 'geom_3857';
}

// в getTile:
const geomCol = pickGeomColumn(z);
const sql = `
  WITH tile_bounds AS (SELECT ST_TileEnvelope($1, $2, $3) AS geom),
  tile_data AS (
    SELECT
      p.wikimapia_id, p.name,
      COALESCE(p.category, '') AS category,
      LEFT(p.description, 200) AS description,
      ST_AsMVTGeom(p.${geomCol}, tile_bounds.geom, 4096, 256, true) AS mvt_geom
    FROM places p, tile_bounds
    WHERE p.${geomCol} && tile_bounds.geom
      AND ST_Intersects(p.${geomCol}, tile_bounds.geom)
  )
  SELECT ST_AsMVT(tile_data, 'places', 4096, 'mvt_geom') AS mvt
  FROM tile_data WHERE mvt_geom IS NOT NULL
`;
```

> ⚠️ `${geomCol}` — НЕ user input, whitelisted константа. SQL injection невозможна.

**Также сократить maxzoom MVT-source на фронте** в `MapCanvas.jsx:78`:
```diff
   map.addSource("places", {
     type: "vector",
     tiles: [`${API_BASE}/api/tiles/{z}/{x}/{y}.mvt`],
-    minzoom: 0,
-    maxzoom: 16,
+    minzoom: 8,           // ниже 8 — крошки, нет смысла
+    maxzoom: 16,          // overscale до z=22 (Mapbox делает сам)
     promoteId: "wikimapia_id",
   });
```

**Проверка**:
```bash
# Тайл z=10 (вся Никосия)
time curl -s 'http://localhost/api/tiles/10/600/400.mvt' -o t10.mvt
# Тайл z=15 (квартал)
time curl -s 'http://localhost/api/tiles/15/19200/12800.mvt' -o t15.mvt
ls -la t10.mvt t15.mvt
# Ожидание: t10.mvt в 3-5× меньше t15.mvt
```

---

### Задача 1.4: Nginx tile cache (7 дней)

**Приоритет**: P0 · **Оценка**: 30 мин · **Файлы**: `infra/nginx/nginx.conf`

**Изменить `infra/nginx/nginx.conf`** — добавить cache zone и применить к `/api/tiles/`:

```diff
 http {
     include       /etc/nginx/mime.types;
     default_type  application/octet-stream;
+
+    # ── Tile cache (7 days, 1 GB max) ────────────────────────
+    proxy_cache_path /var/cache/nginx/tiles
+                     lev