# Cyprus Wikimapia Scraper

Scrapes geodata (buildings, parks, landmarks, districts) from the [Wikimapia API](http://wikimapia.org/api/) for the island of Cyprus and outputs a validated GeoJSON file ready for PostGIS import.

## Features

- **Grid tiling** — splits Cyprus bbox into ~50 sub-tiles for complete coverage
- **Rate limiting** — respects Wikimapia API limits (31s delay for `example` key, 3.5s for personal key)
- **Exponential backoff** — automatic retries on transient errors
- **Checkpoint/resume** — saves progress after each tile; re-run continues from where it left off
- **Deduplication** — no duplicate `wikimapia_id` values in output
- **Geometry validation** — all polygons validated and fixed via Shapely
- **Idempotent** — re-running produces the same output without duplicates

## Prerequisites

- Python 3.11+
- [uv](https://docs.astral.sh/uv/) package manager

## Setup

```bash
cd services/scraper

# Install dependencies
uv sync
```

## Usage

### Run the scraper

```bash
# From services/scraper directory
uv run python -m scraper
```

### With a personal API key (faster)

Create a `.env` file in the project root:

```env
WIKIMAPIA_API_KEY=your_key_here
```

Register for a free key at: https://wikimapia.org/api/?action=create_key

### Key modes

| Mode | Key | Delay | ~Time for 500 places |
|------|-----|-------|---------------------|
| Slow (default) | `example` | 31s | ~3-5 hours |
| Fast | Personal key | 3.5s | ~15-30 min |

## Output

The scraper produces `data/cyprus_places.geojson` — a GeoJSON FeatureCollection (CRS: WGS84 / EPSG:4326).

### Feature schema

```json
{
  "type": "Feature",
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[lon, lat], ...]]
  },
  "properties": {
    "wikimapia_id": 12345,
    "name": "Place Name",
    "description": "Description text",
    "photos": ["https://..."],
    "url": "http://wikimapia.org/12345/"
  }
}
```

## Checkpoint / Resume

Progress is saved to `data/.scraper_checkpoint.json` after each tile. If the scraper is interrupted (Ctrl+C, network issue, etc.), simply re-run and it will continue from the last completed tile.

To force a fresh scrape, delete the checkpoint file:

```bash
rm ../../data/.scraper_checkpoint.json
```

## Project Structure

```
services/scraper/
├── pyproject.toml          # Project config & dependencies
├── README.md               # This file
└── src/scraper/
    ├── __init__.py          # Package init
    ├── __main__.py          # Entry point (python -m scraper)
    ├── config.py            # Constants, bbox, env loading
    ├── api_client.py        # Wikimapia HTTP client with rate limiting
    ├── grid.py              # BBox grid tiling
    ├── converter.py         # Wikimapia → GeoJSON conversion + validation
    └── main.py              # Orchestration pipeline
```
