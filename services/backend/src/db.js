/**
 * services/backend/src/db.js
 * PostgreSQL connection pool using `pg`.
 */

import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool(
  config.db.connectionString
    ? { connectionString: config.db.connectionString }
    : {
        host: config.db.host,
        port: config.db.port,
        user: config.db.user,
        password: config.db.password,
        database: config.db.database,
      }
);

/**
 * Convenience wrapper: run a single query and return rows.
 * @param {string} text  SQL query
 * @param {any[]}  params  Parameterized values
 * @returns {Promise<import('pg').QueryResult>}
 */
export async function query(text, params) {
  return pool.query(text, params);
}
