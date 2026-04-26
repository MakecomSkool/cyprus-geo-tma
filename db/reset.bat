@echo off
REM db\reset.bat — Destroy and recreate the dev database from scratch (Windows).
REM
REM Usage:
REM     db\reset.bat          (from project root)
REM     reset.bat             (from db\ directory)
REM
REM Requires: docker compose, python3, psycopg2, python-dotenv

cd /d "%~dp0\.."

echo ========================================
echo   Cyprus Geo DB — Full Reset
echo ========================================
echo.

echo [1/5] Stopping containers and removing volumes...
docker compose down -v 2>nul

echo [2/5] Starting PostgreSQL + PostGIS...
docker compose up -d db

echo   Waiting for database to be ready...
:waitloop
docker compose exec db pg_isready -U cyprus -d cyprus_geo >nul 2>&1
if errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto waitloop
)
echo   Database is ready.

echo [3/5] Applying migrations...
python db\migrate.py
if errorlevel 1 goto :error

echo [4/5] Seeding places from GeoJSON...
python db\seeds\seed_places.py
if errorlevel 1 goto :error

echo [5/5] Running smoke test...
docker compose exec db psql -U cyprus -d cyprus_geo -c "SELECT 'tables' AS check, COUNT(*)::text AS result FROM information_schema.tables WHERE table_schema = 'public' AND table_name NOT LIKE '\_%%' UNION ALL SELECT 'places', COUNT(*)::text FROM places UNION ALL SELECT 'nicosia_bbox', COUNT(*)::text FROM places WHERE ST_Intersects(geom, ST_MakeEnvelope(33.3, 35.1, 33.4, 35.2, 4326));"

echo.
echo ========================================
echo   Reset complete!
echo ========================================
goto :eof

:error
echo.
echo ERROR: A step failed. Check the output above.
exit /b 1
