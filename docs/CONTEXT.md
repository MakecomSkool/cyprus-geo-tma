# Cyprus Geo-Social TMA — Project Context

## Overview

A Telegram Mini App (TMA) providing an interactive map of Cyprus with places, landmarks, parks, buildings, and community annotations. Data is sourced from Wikimapia and stored in PostGIS for efficient spatial queries.

## Target Platform

Telegram Mini App (WebApp) accessible inside the Telegram messenger.

## Geography

Island of Cyprus:
- **Bounding box**: lon 32.2..34.7, lat 34.5..35.8
- **CRS**: WGS84 / EPSG:4326
- Covers both Republic of Cyprus and Northern Cyprus (TRNC)

## Multi-Agent Architecture

The project uses a multi-agent development workflow:

| Agent | Role | Scope |
|-------|------|-------|
| Agent 1 | Data Engineer | `services/scraper/`, `data/` |
| Agent 2 | DB Engineer | `db/` |
| Agent 3 | Backend Developer | `services/backend/` |
| Agent 4 | Frontend Developer | `services/frontend/` |
| Agent 5 | DevOps | `infra/`, CI/CD |

## Current Status

- **Phase 1**: Data Ingestion — COMPLETED (12,815 places scraped from Wikimapia)
- **Phase 2**: Database Setup — COMPLETED (PostgreSQL 15 + PostGIS 3.6.2, 12,815 places seeded)
- **Phase 3**: Backend API — COMPLETED (Fastify 5 + Socket.IO 4, 3 REST endpoints, WS rooms)
- **Phase 4**: Frontend TMA — COMPLETED (React 19 + Vite 8, Mapbox GL, Zustand, Socket.IO)
- **Phase 5**: Deployment — COMPLETED (Docker Compose, Nginx, multi-stage builds)
