import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Keep one Pool across Next dev hot reloads.
const globalForDb = globalThis as unknown as { __apilensPool?: Pool };

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new Pool({ connectionString });
}

export const pool = globalForDb.__apilensPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.__apilensPool = pool;

export const db = drizzle(pool, { schema });
export type Db = typeof db;
