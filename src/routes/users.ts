import { Hono } from "hono";
import type { HonoEnv } from "../types/env";
import { success } from "../lib/response";

const users = new Hono<HonoEnv>();

/**
 * GET /api/users/me
 * Phase 2: still returns unauthenticated. Real auth comes later.
 */
users.get("/users/me", (c) => {
  return success(c, {
    authenticated: false,
    message:
      "Authentication is not implemented yet. Core identity tables are available.",
  });
});

export default users;
