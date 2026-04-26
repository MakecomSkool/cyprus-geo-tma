"""Convert Wikimapia KML-parsed place data to GeoJSON Features with validation."""

from __future__ import annotations

from typing import Any

from shapely.geometry import Polygon, MultiPolygon, mapping, shape
from shapely.validation import make_valid

from .config import CYPRUS_BBOX


def polygon_coords_to_geojson(coords: list[list[float]]) -> dict | None:
    """Convert polygon coordinates [[lon, lat], ...] to GeoJSON geometry.

    Args:
        coords: List of [lon, lat] coordinate pairs.

    Returns:
        GeoJSON geometry dict (Polygon or MultiPolygon), or None if invalid.
    """
    if not coords or len(coords) < 3:
        return None

    # Convert to tuples
    ring = [(c[0], c[1]) for c in coords]

    # Ensure ring is closed
    if ring[0] != ring[-1]:
        ring.append(ring[0])

    try:
        poly = Polygon(ring)

        # Fix invalid geometries
        if not poly.is_valid:
            poly = make_valid(poly)

        # Skip empty or degenerate geometries
        if poly.is_empty:
            return None

        # Handle GeometryCollection from make_valid — extract polygons
        geom = poly
        if geom.geom_type == "GeometryCollection":
            polygons = [g for g in geom.geoms if g.geom_type in ("Polygon", "MultiPolygon") and not g.is_empty]
            if not polygons:
                return None
            if len(polygons) == 1:
                geom = polygons[0]
            else:
                geom = MultiPolygon(polygons)

        # Only accept Polygon or MultiPolygon
        if geom.geom_type not in ("Polygon", "MultiPolygon"):
            return None

        if geom.area == 0:
            return None

        return mapping(geom)

    except Exception:
        return None


def is_within_cyprus_bbox(coords: list[list[float]]) -> bool:
    """Check if polygon's centroid falls within the Cyprus bounding box.

    Uses centroid check (not full containment) because some polygons
    may extend slightly beyond the bbox edges.
    """
    if not coords:
        return False
    try:
        avg_lon = sum(c[0] for c in coords) / len(coords)
        avg_lat = sum(c[1] for c in coords) / len(coords)
        return (
            CYPRUS_BBOX.lon_min - 0.1 <= avg_lon <= CYPRUS_BBOX.lon_max + 0.1
            and CYPRUS_BBOX.lat_min - 0.1 <= avg_lat <= CYPRUS_BBOX.lat_max + 0.1
        )
    except Exception:
        return False


def place_to_feature(place: dict[str, Any]) -> dict | None:
    """Convert a parsed Wikimapia place to a GeoJSON Feature.

    Args:
        place: Dict with keys: id, name, description, url, polygon.

    Returns:
        GeoJSON Feature dict, or None if geometry is invalid.
    """
    polygon_coords = place.get("polygon", [])

    # Validate location
    if not is_within_cyprus_bbox(polygon_coords):
        return None

    # Convert to GeoJSON geometry
    geometry = polygon_coords_to_geojson(polygon_coords)
    if geometry is None:
        return None

    # Build feature
    feature = {
        "type": "Feature",
        "geometry": geometry,
        "properties": {
            "wikimapia_id": int(place["id"]) if place.get("id", "").isdigit() else place.get("id"),
            "name": (place.get("name") or "").strip(),
            "description": (place.get("description") or "").strip(),
            "photos": [],  # KML endpoint doesn't include photos; can be enriched later
            "url": place.get("url", ""),
        },
    }

    return feature
