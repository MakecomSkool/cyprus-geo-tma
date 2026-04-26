"""Validate the generated GeoJSON file."""

import json
import sys
from collections import Counter
from pathlib import Path

from shapely.geometry import shape

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OUTPUT_FILE = Path(__file__).resolve().parents[4] / "data" / "cyprus_places.geojson"

print(f"Validating: {OUTPUT_FILE}")
print()

with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
    data = json.load(f)

features = data["features"]
print(f"Total features: {len(features)}")
print(f"Type: {data['type']}")
crs = data.get("crs", {}).get("properties", {}).get("name", "N/A")
print(f"CRS: {crs}")
print()

# Check for duplicates
ids = [f["properties"]["wikimapia_id"] for f in features]
unique_ids = set(ids)
print(f"Unique wikimapia_ids: {len(unique_ids)}")
print(f"Duplicates: {len(ids) - len(unique_ids)}")
print()

# Geometry types
geom_types = Counter(f["geometry"]["type"] for f in features)
print("Geometry types:")
for gt, count in geom_types.most_common():
    print(f"  {gt}: {count}")
print()

# Validate geometries
invalid_count = 0
empty_count = 0
out_of_bounds = 0
for f in features:
    try:
        geom = shape(f["geometry"])
        if not geom.is_valid:
            invalid_count += 1
        if geom.is_empty:
            empty_count += 1
        c = geom.centroid
        if not (32.1 <= c.x <= 34.8 and 34.4 <= c.y <= 35.9):
            out_of_bounds += 1
    except Exception:
        invalid_count += 1

print(f"Invalid geometries: {invalid_count}")
print(f"Empty geometries: {empty_count}")
print(f"Out of Cyprus bbox: {out_of_bounds}")
print()

# Features with names
named = [f for f in features if f["properties"]["name"]]
print(f"Features with names: {len(named)} / {len(features)}")
print()

# Sample places
print("Sample places (first 15 with names):")
for f in named[:15]:
    p = f["properties"]
    gt = f["geometry"]["type"]
    print(f"  - {p['name']} (id: {p['wikimapia_id']}, geom: {gt})")

# Summary
print()
print("=" * 50)
ok = True
if len(features) < 500:
    print("FAIL: Less than 500 features")
    ok = False
else:
    print(f"PASS: {len(features)} features (>= 500)")

if len(ids) - len(unique_ids) > 0:
    print(f"FAIL: {len(ids) - len(unique_ids)} duplicate IDs")
    ok = False
else:
    print("PASS: No duplicate IDs")

if invalid_count > 0:
    print(f"FAIL: {invalid_count} invalid geometries")
    ok = False
else:
    print("PASS: All geometries valid")

if out_of_bounds > 0:
    print(f"WARN: {out_of_bounds} features outside Cyprus bbox")
else:
    print("PASS: All features within Cyprus bbox")

print()
if ok:
    print("ALL VALIDATIONS PASSED!")
else:
    print("SOME VALIDATIONS FAILED!")
