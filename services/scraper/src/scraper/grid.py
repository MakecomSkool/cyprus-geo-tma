"""Grid tiling for splitting Cyprus bbox into manageable sub-regions."""

from __future__ import annotations

from dataclasses import dataclass

from .config import CYPRUS_BBOX, CONFIG


@dataclass(frozen=True)
class Tile:
    """A rectangular tile defined by its bounding box."""

    lon_min: float
    lat_min: float
    lon_max: float
    lat_max: float

    @property
    def bbox_str(self) -> str:
        """Format as Wikimapia API bbox parameter: lon_min,lat_min,lon_max,lat_max."""
        return f"{self.lon_min},{self.lat_min},{self.lon_max},{self.lat_max}"

    @property
    def id(self) -> str:
        """Unique tile identifier based on coordinates."""
        return f"{self.lon_min:.3f}_{self.lat_min:.3f}_{self.lon_max:.3f}_{self.lat_max:.3f}"

    def subdivide(self) -> list["Tile"]:
        """Split this tile into 4 equal sub-tiles."""
        mid_lon = (self.lon_min + self.lon_max) / 2
        mid_lat = (self.lat_min + self.lat_max) / 2
        return [
            Tile(self.lon_min, self.lat_min, mid_lon, mid_lat),  # SW
            Tile(mid_lon, self.lat_min, self.lon_max, mid_lat),  # SE
            Tile(self.lon_min, mid_lat, mid_lon, self.lat_max),  # NW
            Tile(mid_lon, mid_lat, self.lon_max, self.lat_max),  # NE
        ]


def generate_grid_tiles(tile_size: float | None = None) -> list[Tile]:
    """Generate a grid of tiles covering the Cyprus bounding box.

    Args:
        tile_size: Size of each tile in degrees. Defaults to config value.

    Returns:
        List of Tile objects covering the full Cyprus bbox.
    """
    size = tile_size or CONFIG.tile_size
    bbox = CYPRUS_BBOX
    tiles: list[Tile] = []

    lon = bbox.lon_min
    while lon < bbox.lon_max:
        lat = bbox.lat_min
        while lat < bbox.lat_max:
            tiles.append(
                Tile(
                    lon_min=round(lon, 4),
                    lat_min=round(lat, 4),
                    lon_max=round(min(lon + size, bbox.lon_max), 4),
                    lat_max=round(min(lat + size, bbox.lat_max), 4),
                )
            )
            lat += size
        lon += size

    return tiles
