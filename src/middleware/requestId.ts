import { createMiddleware } from "hono/factory";
import type { HonoEnv } from "../types/env";

export const requestId = createMiddleware<HonoEnv>(async (c, next) => {
  const incoming = c.req.header("x-request-id");
  const id = incoming || crypto.randomUUID();
  c.set("requestId", id);
  await next();
  c.header("x-request-id", id);
});
