import { createMiddleware } from "hono/factory";
import type { HonoEnv } from "../types/env";

export const errorHandler = createMiddleware<HonoEnv>(async (c, next) => {
  try {
    await next();
  } catch (err) {
    const requestId = c.get("requestId") || "unknown";
    console.error(`[IDS] Unhandled error (requestId: ${requestId}):`, err);

    return c.json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Something went wrong.",
        },
        requestId,
      },
      500
    );
  }
});
