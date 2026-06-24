import { createMiddleware } from "hono/factory";
import type { HonoEnv } from "../types/env";
import { getAllowedOrigins } from "../lib/env";

export const corsHandler = createMiddleware<HonoEnv>(async (c, next) => {
  const origin = c.req.header("origin");
  const allowedOrigins = getAllowedOrigins(c.env);

  if (origin) {
    const isAllowed =
      allowedOrigins.includes(origin) ||
      origin.endsWith(".pages.dev") ||
      origin.endsWith(".workers.dev");

    if (isAllowed) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
      );
      c.header(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, x-request-id"
      );
      c.header("Access-Control-Expose-Headers", "x-request-id");
      c.header("Access-Control-Max-Age", "86400");
    }
  }

  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }

  await next();
});
