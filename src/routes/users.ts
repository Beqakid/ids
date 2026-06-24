import { Hono } from "hono";
import type { HonoEnv } from "../types/env";
import { success } from "../lib/response";

const users = new Hono<HonoEnv>();

users.get("/users/me", (c) => {
  return success(c, {
    authenticated: false,
    message: "Authentication is not implemented in Phase 1.",
  });
});

export default users;
