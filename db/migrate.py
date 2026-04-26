"""
db/migrate.py — Apply SQL migrations in order.

Usage:
    python db/migrate.py              # from project root
    python migrate.py                 # from db/ directory

Reads DATABASE_URL from .env or environment.
Applies all .sql files from db/migrations/ in lexicographic order.
Tracks applied migrations in a _migrations table to avoid re-running.
"""

import os
import sys
from pathlib import Path

# Ensure project root for .env loading
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(PROJECT_ROOT / ".env")
except ImportError:
    pass

import psycopg2


def get_connection():
    """Create a PostgreSQL connection from DATABASE_URL or individual vars."""
    url = os.getenv("DATABASE_URL")
    if url:
        return psycopg2.connect(url)
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=int(os.getenv("POSTGRES_PORT", "5432")),
        user=os.getenv("POSTGRES_USER", "cyprus"),
        password=os.getenv("POSTGRES_PASSWORD", "cyprus_dev_2026"),
        dbname=os.getenv("POSTGRES_DB", "cyprus_geo"),
    )


def ensure_migrations_table(conn):
    """Create the migrations tracking table if it doesn't exist."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS _migrations (
                filename VARCHAR(255) PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        """)
    conn.commit()


def get_applied_migrations(conn):
    """Return set of already-applied migration filenames."""
    with conn.cursor() as cur:
        cur.execute("SELECT filename FROM _migrations ORDER BY filename;")
        return {row[0] for row in cur.fetchall()}


def apply_migration(conn, filepath: Path):
    """Apply a single SQL migration file."""
    sql = filepath.read_text(encoding="utf-8")
    filename = filepath.name
    with conn.cursor() as cur:
        cur.execute(sql)
        cur.execute(
            "INSERT INTO _migrations (filename) VALUES (%s) ON CONFLICT DO NOTHING;",
            (filename,)
        )
    conn.commit()


def main():
    migrations_dir = Path(__file__).resolve().parent / "migrations"
    if not migrations_dir.exists():
        print(f"ERROR: migrations directory not found: {migrations_dir}")
        sys.exit(1)

    sql_files = sorted(migrations_dir.glob("*.sql"))
    if not sql_files:
        print("No migration files found.")
        return

    print(f"Connecting to database...")
    conn = get_connection()
    conn.autocommit = False

    try:
        ensure_migrations_table(conn)
        applied = get_applied_migrations(conn)

        pending = [f for f in sql_files if f.name not in applied]
        if not pending:
            print(f"All {len(sql_files)} migrations already applied.")
            return

        print(f"Found {len(pending)} pending migration(s) (of {len(sql_files)} total):")
        for f in pending:
            print(f"  >> Applying {f.name}...")
            try:
                apply_migration(conn, f)
                print(f"     OK")
            except Exception as e:
                conn.rollback()
                print(f"     FAILED: {e}")
                sys.exit(1)

        print(f"\nAll migrations applied successfully.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
