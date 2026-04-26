-- 0001_init_extensions.sql
-- Enable PostGIS and other required extensions.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
