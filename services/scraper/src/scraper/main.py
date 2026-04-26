"""Main scraping orchestrator with checkpoint/resume and deduplication."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any

# Force UTF-8 stdout on Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from rich.console import Console
from rich.progress import (
    BarColumn,
    MofNCompleteColumn,
    Progress,
    SpinnerColumn,
    TextColumn,
    TimeElapsedColumn,
    TimeRemainingColumn,
)
from rich.table import Table

from .api_client import WikimapiaClient
from .config import CONFIG, CYPRUS_BBOX
from .converter import place_to_feature
from .grid import Tile, generate_grid_tiles

console = Console(force_terminal=True)


# -- Checkpoint Management ---------------------------------------------------


def load_checkpoint(path: Path) -> dict[str, Any]:
    """Load checkpoint from disk, or return empty state."""
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            console.print(
                f"[green]>> Resumed from checkpoint: "
                f"{len(data.get('completed_tiles', []))} tiles done, "
                f"{len(data.get('places', {}))} places collected[/green]"
            )
            return data
        except (json.JSONDecodeError, KeyError):
            console.print("[yellow]!! Corrupt checkpoint, starting fresh[/yellow]")
    return {"completed_tiles": [], "places": {}}


def save_checkpoint(path: Path, state: dict[str, Any]) -> None:
    """Save checkpoint to disk atomically."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False)
    tmp_path.replace(path)


# -- Tile Scraping ------------------------------------------------------------


def scrape_tile(
    client: WikimapiaClient,
    tile: Tile,
    state: dict[str, Any],
) -> int:
    """Scrape all places in a single tile using the KML endpoint.

    Returns the number of new places added.
    """
    new_count = 0

    console.print(
        f"  [cyan]>> Fetching bbox={tile.bbox_str}...[/cyan]"
    )
    places = client.get_places_in_bbox(tile.bbox_str)

    if not places:
        console.print(f"  [dim]   No places in this tile[/dim]")
        return 0

    console.print(f"  [dim]   Got {len(places)} places from KML[/dim]")

    # Process each place
    for place in places:
        wid = str(place.get("id", ""))
        if not wid or wid in state["places"]:
            continue  # skip duplicates

        feature = place_to_feature(place)
        if feature is not None:
            state["places"][wid] = feature
            new_count += 1

    return new_count


# -- GeoJSON Output -----------------------------------------------------------


def write_geojson(features: list[dict], output_path: Path) -> None:
    """Write GeoJSON FeatureCollection to disk."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    collection = {
        "type": "FeatureCollection",
        "crs": {
            "type": "name",
            "properties": {"name": "urn:ogc:def:crs:EPSG::4326"},
        },
        "features": features,
    }
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(collection, f, ensure_ascii=False, indent=2)


# -- Main Pipeline ------------------------------------------------------------


def run_scraper() -> None:
    """Main scraping pipeline with grid tiling and checkpointing."""
    start_time = time.time()

    console.print()
    console.rule("[bold cyan]Cyprus Wikimapia Scraper (KML mode)[/bold cyan]")
    console.print()

    # Show configuration
    info_table = Table(title="Configuration", show_header=False, border_style="dim")
    info_table.add_column("Key", style="bold")
    info_table.add_column("Value")
    info_table.add_row("Method", "KML endpoint (/d?BBOX=)")
    info_table.add_row("Request Delay", f"{CONFIG.request_delay_kml:.1f}s")
    info_table.add_row(
        "Cyprus BBox",
        f"lon: {CYPRUS_BBOX.lon_min}..{CYPRUS_BBOX.lon_max}, "
        f"lat: {CYPRUS_BBOX.lat_min}..{CYPRUS_BBOX.lat_max}",
    )
    info_table.add_row("Tile Size", f"{CONFIG.tile_size} deg")
    info_table.add_row("Output", str(CONFIG.output_file))
    console.print(info_table)
    console.print()

    # Generate grid
    tiles = generate_grid_tiles()
    console.print(f"[bold]Generated {len(tiles)} grid tiles[/bold]")

    # Load checkpoint
    state = load_checkpoint(CONFIG.checkpoint_file)
    completed = set(state["completed_tiles"])
    remaining_tiles = [t for t in tiles if t.id not in completed]

    if remaining_tiles:
        console.print(
            f"[bold]{len(remaining_tiles)} tiles remaining "
            f"({len(completed)} already done, "
            f"{len(state['places'])} places collected so far)[/bold]"
        )
    else:
        console.print("[green]>> All tiles already scraped! Regenerating output...[/green]")

    console.print()

    # Estimate time
    est_seconds = len(remaining_tiles) * CONFIG.request_delay_kml
    console.print(
        f"[dim]Estimated time: ~{est_seconds / 60:.0f} min "
        f"({len(remaining_tiles)} tiles x {CONFIG.request_delay_kml}s delay)[/dim]"
    )
    console.print()

    # Scrape each tile
    with WikimapiaClient() as client:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            MofNCompleteColumn(),
            TimeElapsedColumn(),
            TimeRemainingColumn(),
            console=console,
        ) as progress:
            task = progress.add_task(
                "Scraping tiles...", total=len(remaining_tiles)
            )

            for i, tile in enumerate(remaining_tiles):
                progress.update(
                    task,
                    description=f"Tile {i + 1}/{len(remaining_tiles)} | "
                    f"{len(state['places'])} places",
                )

                try:
                    new = scrape_tile(client, tile, state)
                    state["completed_tiles"].append(tile.id)

                    # Save checkpoint after each tile
                    save_checkpoint(CONFIG.checkpoint_file, state)

                    if new > 0:
                        console.print(
                            f"  [green]+ {new} new places "
                            f"(total: {len(state['places'])})[/green]"
                        )

                except Exception as e:
                    console.print(
                        f"  [red]ERROR on tile {tile.id}: {e}[/red]"
                    )
                    # Save checkpoint even on error so we can resume
                    save_checkpoint(CONFIG.checkpoint_file, state)

                progress.advance(task)

        console.print()
        console.print(
            f"[bold]Total API requests: {client.request_count}[/bold]"
        )

    # Write final GeoJSON
    features = list(state["places"].values())
    write_geojson(features, CONFIG.output_file)

    elapsed = time.time() - start_time

    # Summary
    console.print()
    console.rule("[bold green]Scraping Complete[/bold green]")
    summary = Table(title="Results", show_header=False, border_style="green")
    summary.add_column("Metric", style="bold")
    summary.add_column("Value")
    summary.add_row("Total Places", str(len(features)))
    summary.add_row("Output File", str(CONFIG.output_file))
    summary.add_row(
        "File Size", f"{CONFIG.output_file.stat().st_size / 1024:.1f} KB"
    )
    summary.add_row("Time Elapsed", f"{elapsed / 60:.1f} min")
    summary.add_row("Tiles Processed", str(len(state["completed_tiles"])))
    console.print(summary)

    # Warn if under target
    if len(features) < 500:
        console.print(
            f"\n[yellow]!! Only {len(features)} places collected (target: >=500). "
            f"Consider running again with smaller tiles.[/yellow]"
        )
    else:
        console.print(
            f"\n[green]>> Target met! {len(features)} >= 500 places collected.[/green]"
        )
