# ───────────────────────────────────────────────────────────────
# db/Dockerfile — Migrations + Seeder runner
# One-shot container: runs migrate.py then seed_places.py
# ───────────────────────────────────────────────────────────────

FROM python:3.12-slim

WORKDIR /app

# Install Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy migration scripts, seeder, and data
COPY migrate.py ./
COPY migrations/ ./migrations/
COPY seeds/ ./seeds/

# The GeoJSON file is mounted from project root via docker-compose
# It will be at /data/cyprus_places.geojson

CMD ["sh", "-c", "python migrate.py && python seeds/seed_places.py"]
