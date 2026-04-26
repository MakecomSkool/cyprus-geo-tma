"""Configuration constants and environment loading."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root
_project_root = Path(__file__).resolve().parents[4]  # services/scraper/src/scraper -> root
load_dotenv(_project_root / ".env")


@dataclass(frozen=True)
class CyprusBBox:
    """Bounding box for Cyprus island (WGS84 / EPSG:4326)."""

    lon_min: float = 32.2
    lat_min: float = 34.5
    lon_max: float = 34.7
    lat_max: float = 35.8


@dataclass(frozen=True)
class ScraperConfig:
    """Scraper runtime configuration."""

    # Rate limiting for KML endpoint
    request_delay_kml: float = 1.5  # seconds between requests (KML endpoint is more lenient)

    # Retry policy
    max_retries: int = 5
    initial_backoff: float = 2.0
    max_backoff: float = 120.0

    # Grid tiling
    tile_size: float = 0.1  # degrees — balanced for KML (caps ~800 places per tile)

    # Paths
    output_dir: Path = Path("")
    checkpoint_file: Path = Path("")

    @classmethod
    def from_env(cls) -> "ScraperConfig":
        """Create config from environment variables."""
        root = Path(__file__).resolve().parents[4]
        return cls(
            output_dir=root / "data",
            checkpoint_file=root / "data" / ".scraper_checkpoint.json",
        )

    @property
    def output_file(self) -> Path:
        return self.output_dir / "cyprus_places.geojson"


# Singleton instances
CYPRUS_BBOX = CyprusBBox()
CONFIG = ScraperConfig.from_env()
