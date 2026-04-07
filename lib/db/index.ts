import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";

const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), "portco-pulse.db");

const sqlite = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("cache_size = -20000"); // 20MB cache
sqlite.pragma("temp_store = MEMORY");

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
