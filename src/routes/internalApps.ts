import { Hono } from "hono";
import type { HonoEnv } from "../types/env";
import { success, error } from "../lib/response";
import {
  requireString,
  optionalString,
  isValidAppId,
  isValidOrigin,
  parseJsonMetadata,
  ValidationError,
} from "../lib/validation";
import { APP_STATUSES, APP_TYPES, type AppStatus, type AppType } from "../types/apps";
import {
  createApp,
  updateApp,
  updateAppStatus,
  DuplicateAppError,
} from "../services/apps";
import { isAllowedValue } from "../lib/validation";

const internalApps = new Hono<HonoEnv>();

// ── POST /api/internal/apps ──────────────────────────────────
// TODO: Phase 4/5 — protect with API key or service token.
internalApps.post("/", async (c) => {
  try {
    const body = await c.req.json();

    const appId = requireString(body.appId, "appId").toLowerCase();
    const name = requireString(body.name, "name");
    const appType = optionalString(body.appType);
    const status = optionalString(body.status);
    const domain = optionalString(body.domain);
    const description = optionalString(body.description);
    const allowedOrigins: string[] = Array.isArray(body.allowedOrigins)
      ? body.allowedOrigins
      : [];

    if (!isValidAppId(appId)) {
      return error(
        c,
        "INVALID_APP_ID",
        "app_id must be lowercase snake_case (letters, digits, underscores).",
        400
      );
    }

    if (appType && !isAllowedValue(appType, APP_TYPES)) {
      return error(
        c,
        "INVALID_APP_TYPE",
        `Invalid appType. Allowed: ${APP_TYPES.join(", ")}`,
        400
      );
    }

    if (status && !isAllowedValue(status, APP_STATUSES)) {
      return error(
        c,
        "INVALID_STATUS",
        `Invalid status. Allowed: ${APP_STATUSES.join(", ")}`,
        400
      );
    }

    // Validate origins
    for (const origin of allowedOrigins) {
      if (!isValidOrigin(origin)) {
        return error(
          c,
          "INVALID_ORIGIN",
          `Invalid origin: ${origin}`,
          400
        );
      }
    }

    const app = await createApp(c.env, {
      appId,
      name,
      appType: appType as AppType | undefined,
      status: status as AppStatus | undefined,
      domain,
      allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : undefined,
      description,
    });

    return success(
      c,
      {
        app: {
          appId: app.appId,
          name: app.name,
          appType: app.appType,
          status: app.status,
          domain: app.domain,
          allowedOrigins: app.allowedOrigins,
          description: app.description,
          createdAt: app.createdAt,
        },
      },
      201
    );
  } catch (err) {
    if (err instanceof DuplicateAppError) {
      return error(c, "DUPLICATE_APP_ID", err.message, 400);
    }
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── PATCH /api/internal/apps/:appId ──────────────────────────
// TODO: Phase 4/5 — protect with API key or service token.
internalApps.patch("/:appId", async (c) => {
  try {
    const appId = c.req.param("appId");
    const body = await c.req.json();

    const name = optionalString(body.name);
    const appType = optionalString(body.appType);
    const domain = body.domain !== undefined ? body.domain : undefined;
    const description =
      body.description !== undefined ? body.description : undefined;
    const allowedOrigins: string[] | undefined = Array.isArray(body.allowedOrigins)
      ? body.allowedOrigins
      : undefined;

    if (appType && !isAllowedValue(appType, APP_TYPES)) {
      return error(
        c,
        "INVALID_APP_TYPE",
        `Invalid appType. Allowed: ${APP_TYPES.join(", ")}`,
        400
      );
    }

    if (allowedOrigins) {
      for (const origin of allowedOrigins) {
        if (!isValidOrigin(origin)) {
          return error(c, "INVALID_ORIGIN", `Invalid origin: ${origin}`, 400);
        }
      }
    }

    const app = await updateApp(c.env, {
      appId,
      name,
      appType: appType as AppType | undefined,
      domain,
      allowedOrigins,
      description,
    });

    if (!app) {
      return error(c, "APP_NOT_FOUND", "App not found.", 404);
    }

    return success(c, {
      app: {
        appId: app.appId,
        name: app.name,
        appType: app.appType,
        status: app.status,
        domain: app.domain,
        allowedOrigins: app.allowedOrigins,
        description: app.description,
        updatedAt: app.updatedAt,
      },
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── PATCH /api/internal/apps/:appId/status ───────────────────
// TODO: Phase 4/5 — protect with API key or service token.
internalApps.patch("/:appId/status", async (c) => {
  try {
    const appId = c.req.param("appId");
    const body = await c.req.json();
    const status = requireString(body.status, "status");

    if (!isAllowedValue(status, APP_STATUSES)) {
      return error(
        c,
        "INVALID_STATUS",
        `Invalid status. Allowed: ${APP_STATUSES.join(", ")}`,
        400
      );
    }

    const app = await updateAppStatus(c.env, appId, status as AppStatus);

    if (!app) {
      return error(c, "APP_NOT_FOUND", "App not found.", 404);
    }

    return success(c, {
      app: {
        appId: app.appId,
        name: app.name,
        status: app.status,
        updatedAt: app.updatedAt,
      },
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

export default internalApps;
