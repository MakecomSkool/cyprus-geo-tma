# Open Questions

## Phase 1 — Data Ingestion

### Q1: Wikimapia JSON API is non-functional (RESOLVED)
**Status**: Resolved
**Severity**: Was BLOCKER, now resolved via alternative approach
**Description**: The official Wikimapia JSON API (`http://api.wikimapia.org/`) with the free `example` key returns empty arrays (`[]`) for all queries as of April 2026. This affects both the `place.getbyarea` endpoint and all other API functions.
**Resolution**: Switched to the internal KML endpoint (`http://wikimapia.org/d?BBOX=`) which is used by the Wikimapia web map. This endpoint requires cookie-based verification (setting `verified=1` cookie after receiving status 218) but works reliably and returns rich polygon data in KML format.

### Q2: KML endpoint place cap (~800 per tile)
**Status**: Open (non-blocking)
**Severity**: LOW
**Description**: The KML endpoint returns a maximum of ~800 places per request regardless of bbox size. For very dense urban areas (central Nicosia, Limassol), some places may be missed.
**Mitigation**: Using 0.1° grid tiles keeps most tiles under the cap. For higher coverage, a second pass with 0.05° tiles over dense areas could be implemented.

### Q3: Photo URLs not available via KML
**Status**: Open (non-blocking)
**Severity**: LOW
**Description**: The KML endpoint does not include photo URLs. The `photos` array in the GeoJSON is empty for all features. Photos could be enriched by fetching individual place pages from `wikimapia.org/{id}/`.
**Impact**: Phase 2+ may want to add a photo enrichment step.

### Q4: Wikimapia data freshness
**Status**: Open (informational)
**Severity**: LOW
**Description**: Wikimapia is largely dormant since ~2020. The data is historical and may not reflect current ground conditions (demolished buildings, new construction, renamed places). Consider cross-referencing with OpenStreetMap data in future phases.

## Phase 4 — Frontend TMA

### Q5: Mapbox GL JS access token required
**Status**: Open (blocking for map display)
**Severity**: 🟡 MEDIUM
**Description**: The frontend uses Mapbox GL JS which requires a valid access token. The current `.env` has a placeholder token (`pk.eyJ1...placeholder`). A real token must be obtained from https://account.mapbox.com/access-tokens/ (free tier: 50k map loads/month). Set `VITE_MAPBOX_TOKEN` in `services/frontend/.env`.
**Impact**: Without a valid token, the map renders blank (no tiles). All other functionality (API calls, Socket.IO, bottom sheet) works independently.
**Alternative**: Replace Mapbox GL JS with MapLibre GL JS (open-source fork) + free tile providers (OpenFreeMap, Stadia Maps) to avoid token dependency entirely.
