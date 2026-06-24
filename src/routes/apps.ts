import { Hono } from "hono";
import type { HonoEnv } from "../types/env";
import { success, error } from "../lib/response";
import { listApps, getAppById } from "../services/apps";

const apps = new Hono<HonoEnv>();

/**
 * GET /api/apps
 * Phase 3: reads from D1 instead of static list.
 */
apps.get("/apps", async (c) => {
  const appList = await listApps(c.env);
  return success(
    c,
    appList.map((a) => ({
      appId: a.appId,
      name: a.name,
      appType: a.appType,
      status: a.status,
      description: a.description,
    }))
  );
});

/**
 * GET /api/apps/:appId
 * Phase 3: return single app by app_id.
 */
apps.get("/apps/:appId", async (c) => {
  const appId = c.req.param("appId");
  const app = await getAppById(c.env, appId);

  if (!app) {
    return error(c, "APP_NOT_FOUND", "App not found.", 404);
  }

  return success(c, {
    appId: app.appId,
    name: app.name,
    appType: app.appType,
    status: app.status,
    domain: app.domain,
    allowedOrigins: app.allowedOrigins,
    description: app.description,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  });
});

export default apps;
