/**
 * Token events route — Phase 5
 * Mounted at /api/internal/token-events
 *
 * GET / — list token events (requires service auth)
 */

import { Hono } from "hono";
import type { HonoEnv } from "../types/env";
import { success, error } from "../lib/response";
import { requireServiceAuth } from "../middleware/auth";
import { listTokenEvents } from "../services/tokens";
import { isAllowedValue, parseLimitOffset } from "../lib/validation";
import { TOKEN_EVENT_TYPES } from "../types/tokens";

const tokenEventRoutes = new Hono<HonoEnv>();

tokenEventRoutes.use("*", requireServiceAuth());

// ── GET / ─────────────────────────────────────────────────────

tokenEventRoutes.get("/", async (c) => {
  const { limit, offset } = parseLimitOffset(
    c.req.query("limit"),
    c.req.query("offset")
  );

  const userId = c.req.query("userId");
  const sessionId = c.req.query("sessionId");
  const appId = c.req.query("appId");
  const eventType = c.req.query("eventType");
  const jti = c.req.query("jti");

  if (
    eventType &&
    !isAllowedValue(eventType, TOKEN_EVENT_TYPES)
  ) {
    return error(
      c,
      "INVALID_EVENT_TYPE",
      `Invalid eventType. Allowed: ${TOKEN_EVENT_TYPES.join(", ")}`,
      400
    );
  }

  const result = await listTokenEvents(c.env, {
    userId,
    sessionId,
    appId,
    eventType,
    jti,
    limit,
    offset,
  });

  return success(c, result);
});

export default tokenEventRoutes;
