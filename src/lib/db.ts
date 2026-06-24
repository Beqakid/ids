import type { Env } from "../types/env";

export function getDB(env: Env): D1Database {
  return env.IDS_DB;
}
