"""Wikimapia KML endpoint client with rate limiting and cookie verification."""

from __future__ import annotations

import re
import sys
import time
from typing import Any
from xml.etree import ElementTree as ET

# Force UTF-8 stdout on Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import httpx
from rich.console import Console

from .config import CONFIG

console = Console(force_terminal=True)

# KML namespace
KML_NS = {"kml": "http://earth.google.com/kml/2.1"}


class WikimapiaClient:
    """HTTP client for Wikimapia internal KML endpoint.

    Uses the /d?BBOX= endpoint which returns KML data with place polygons.
    Handles the cookie verification challenge (status 218) automatically.
    """

    def __init__(self, config: type | None = None):
        self._config = config or CONFIG
        self._headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "http://wikimapia.org/",
        }
        self._client = httpx.Client(
            headers=self._headers,
            timeout=60.0,
            follow_redirects=True,
        )
        self._verified = False
        self._last_request_time: float = 0.0
        self._request_count: int = 0

    def _ensure_verified(self) -> None:
        """Handle the cookie verification challenge on first request."""
        if self._verified:
            return

        # Make initial request to trigger verification
        r = self._client.get(
            "http://wikimapia.org/d",
            params={"BBOX": "33.3,35.15,33.35,35.18", "page": "1", "count": "1"},
        )
        if r.status_code == 218:
            # Set the verified cookie
            self._client.cookies.set("verified", "1", domain="wikimapia.org")
            self._verified = True
            console.print("[green]>> Cookie verification completed[/green]")
        elif r.status_code == 200:
            self._verified = True
        else:
            console.print(f"[yellow]!! Unexpected status {r.status_code} during verification[/yellow]")
            self._client.cookies.set("verified", "1", domain="wikimapia.org")
            self._verified = True

    def _wait_for_rate_limit(self) -> None:
        """Ensure minimum delay between requests."""
        if self._last_request_time > 0:
            elapsed = time.time() - self._last_request_time
            remaining = CONFIG.request_delay_kml - elapsed
            if remaining > 0:
                console.print(
                    f"  [dim]... Waiting {remaining:.0f}s for rate limit...[/dim]"
                )
                time.sleep(remaining)

    def _parse_kml_places(self, kml_text: str) -> list[dict[str, Any]]:
        """Parse KML response into list of place dicts.

        Each place dict has: id, name, description, polygon (list of [lon, lat]).
        """
        places = []
        try:
            root = ET.fromstring(kml_text)
        except ET.ParseError as e:
            console.print(f"  [red]!! KML parse error: {e}[/red]")
            return places

        # Find all Placemark elements
        for pm in root.iter("{http://earth.google.com/kml/2.1}Placemark"):
            place = self._parse_placemark(pm)
            if place:
                places.append(place)

        return places

    def _parse_placemark(self, pm: ET.Element) -> dict[str, Any] | None:
        """Parse a single KML Placemark element."""
        ns = "http://earth.google.com/kml/2.1"

        # Extract ID from attribute (format: "wm12345")
        pm_id = pm.get("id", "")
        wikimapia_id = pm_id.replace("wm", "") if pm_id.startswith("wm") else pm_id
        if not wikimapia_id:
            return None

        # Extract name from <name> element first
        name_elem = pm.find(f"{{{ns}}}name")
        name = name_elem.text.strip() if name_elem is not None and name_elem.text else ""

        # Extract text from description CDATA
        desc_elem = pm.find(f"{{{ns}}}description")
        cdata_text = ""
        if desc_elem is not None and desc_elem.text:
            raw = desc_elem.text.strip()
            # Remove CDATA wrapper if present
            raw = raw.replace("<![CDATA[", "").replace("]]>", "").strip()
            # Get the text content before the link/br tags
            match = re.match(r"(.*?)\s*<(?:br|a)[\s/>]", raw, re.DOTALL)
            if match:
                cdata_text = match.group(1).strip()
            else:
                cdata_text = re.sub(r"<[^>]+>", "", raw).strip()

        # If <name> is empty, use CDATA text as the name
        # In Wikimapia KML, the name is typically in the CDATA, not in <name>
        if not name and cdata_text:
            name = cdata_text
            description = ""
        elif name and cdata_text and cdata_text != name:
            description = cdata_text
        else:
            description = ""

        # Extract URL from description
        url = ""
        if desc_elem is not None and desc_elem.text:
            url_match = re.search(r"href='([^']*)'", desc_elem.text)
            if url_match:
                url = url_match.group(1).replace("#ge", "")

        # Extract polygon coordinates from LineString or LinearRing
        polygon = []
        for coords_elem in pm.iter(f"{{{ns}}}coordinates"):
            if coords_elem.text:
                coords_text = coords_elem.text.strip()
                for line in coords_text.split("\n"):
                    line = line.strip()
                    if not line:
                        continue
                    parts = line.split(",")
                    if len(parts) >= 2:
                        try:
                            lon = float(parts[0])
                            lat = float(parts[1])
                            polygon.append([lon, lat])
                        except ValueError:
                            continue

        if not polygon or len(polygon) < 3:
            return None

        return {
            "id": wikimapia_id,
            "name": name,
            "description": description,
            "url": url,
            "polygon": polygon,
        }

    def get_places_in_bbox(self, bbox: str, page: int = 1) -> list[dict[str, Any]]:
        """Fetch places within a bounding box from Wikimapia KML endpoint.

        Args:
            bbox: Bounding box string "lon_min,lat_min,lon_max,lat_max"
            page: Page number (1-indexed)

        Returns:
            List of place dicts with id, name, description, polygon data.
        """
        self._ensure_verified()

        params = {
            "BBOX": bbox,
            "page": str(page),
            "count": "200",
        }

        backoff = self._config.initial_backoff

        for attempt in range(1, self._config.max_retries + 1):
            self._wait_for_rate_limit()

            try:
                self._last_request_time = time.time()
                self._request_count += 1

                response = self._client.get(
                    "http://wikimapia.org/d", params=params
                )

                # Handle verification challenge
                if response.status_code == 218:
                    self._client.cookies.set("verified", "1", domain="wikimapia.org")
                    time.sleep(1)
                    response = self._client.get(
                        "http://wikimapia.org/d", params=params
                    )

                if response.status_code == 429:
                    wait_time = 30
                    console.print(
                        f"  [yellow]!! HTTP 429 (attempt {attempt}/{self._config.max_retries}), "
                        f"waiting {wait_time}s...[/yellow]"
                    )
                    time.sleep(wait_time)
                    continue

                response.raise_for_status()

                # Parse KML response
                return self._parse_kml_places(response.text)

            except httpx.HTTPStatusError as e:
                console.print(
                    f"  [yellow]!! HTTP {e.response.status_code} (attempt {attempt}/{self._config.max_retries}), "
                    f"backing off {backoff:.0f}s...[/yellow]"
                )
                time.sleep(backoff)
                backoff = min(backoff * 2, self._config.max_backoff)
                continue

            except httpx.RequestError as e:
                if attempt < self._config.max_retries:
                    console.print(
                        f"  [red]!! Network error (attempt {attempt}/{self._config.max_retries}): "
                        f"{e}. Backing off {backoff:.0f}s...[/red]"
                    )
                    time.sleep(backoff)
                    backoff = min(backoff * 2, self._config.max_backoff)
                    continue
                raise

        console.print("  [red]!! All retries exhausted[/red]")
        return []

    @property
    def request_count(self) -> int:
        return self._request_count

    def close(self) -> None:
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
