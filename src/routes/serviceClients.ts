/**
 * Service client routes — Phase 5
 * Mounted at /api/internal/service-clients
 *
 * POST /bootstrap                — create first service client (bootstrap key only)
 * POST /                         — create service client (service auth)
 * GET  /                         — list service clients (service auth)
 * GET  /:id                      — get service client (service auth)
 * PATCH /:id/status              — update status (service auth)
 * POST /:id/api-keys             — create API key (service auth)
 * GET  /:id/api-keys             — list API keys (service auth)
 * POST /api-keys/:keyId/revoke   — revoke API key (service auth)
 *
 * TODO: Phase 5 — add rate limiting on bootstrap route to prevent brute-force.
 */

import { Hono } from "hono";
import type { HonoEnv } from "../types/env";
import { success, error } from "../lib/response";
import {
  requireString,
  optionalString,
  ValidationError,
  isValidClientId,
  isValidServiceClientStatus,
} from "../lib/validation";
import {
  requireBootstrapAuth,
  requireServiceAuth,
} from "../middleware/auth";
import {
  createServiceClient,
  getServiceClientById,
  getServiceClientByClientId,
  listServiceClients,
  updateServiceClientStatus,
  createServiceApiKey,
  listServiceApiKeys,
  revokeServiceApiKey,
  DuplicateClientIdError,
} from "../services/serviceClients";
import { writeTokenEvent } from "../services/tokens";
import { SERVICE_CLIENT_STATUSES } from "../types/serviceClients";
import { parseLimitOffset } from "../lib/validation";

const serviceClientRoutes = new Hono<HonoEnv>();

// ── POST /bootstrap ───────────────────────────────────────────
// Bootstrap: create first service client. Bootstrap key only — no service auth.

serviceClientRoutes.post(
  "/bootstrap",
  requireBootstrapAuth(),
  async (c) => {
    // Hoist to outer scope so the DuplicateClientIdError catch can reference them.
    let clientId: string | undefined;
    let name: string | undefined;
    let appId: string | undefined;
    try {
      const body = await c.req.json();

      clientId = requireString(body.clientId, "clientId");
      name = requireString(body.name, "name");
      appId = optionalString(body.appId);
      const scopes = Array.isArray(body.scopes) ? body.scopes : null;
      const allowedOrigins = Array.isArray(body.allowedOrigins)
        ? body.allowedOrigins
        : null;

      if (!isValidClientId(clientId)) {
        return error(
          c,
          "INVALID_CLIENT_ID",
          "client_id must be lowercase snake_case (letters, digits, underscores).",
          400
        );
      }

      // Log bootstrap usage
      await writeTokenEvent(c.env, {
        tokenType: "bootstrap",
        eventType: "bootstrap_used",
        appId: appId ?? null,
        success: true,
        metadata: { clientId, name },
      });

      const serviceClient = await createServiceClient(c.env, {
        clientId,
        name,
        appId,
        scopes,
        allowedOrigins,
      });

      const { apiKey, rawKey } = await createServiceApiKey(
        c.env,
        serviceClient.id
      );

      return success(
        c,
        {
          serviceClient: {
            id: serviceClient.id,
            clientId: serviceClient.clientId,
            name: serviceClient.name,
            status: serviceClient.status,
          },
          apiKey: {
            id: apiKey.id,
            keyPrefix: apiKey.keyPrefix,
            // rawKey returned ONLY here — never again
            rawKey,
          },
        },
        201
      );
    } catch (err) {
      if (err instanceof DuplicateClientIdError) {
        // Bootstrap is idempotent: if the client already exists, issue a new API key.
        // This allows repeated bootstrap calls (e.g. re-deploys, test re-runs) without
        // manual cleanup. The caller must still have the bootstrap key.
        try {
          const existing = await getServiceClientByClientId(c.env, clientId!);
          if (!existing || existing.status !== "active") {
            return error(
              c,
              "CLIENT_NOT_ACTIVE",
              "Service client exists but is not active.",
              409
            );
          }
          const { apiKey, rawKey } = await createServiceApiKey(
            c.env,
            existing.id
          );
          return success(c, {
            serviceClient: {
              id: existing.id,
              clientId: existing.clientId,
              name: existing.name,
              status: existing.status,
            },
            apiKey: {
              id: apiKey.id,
              keyPrefix: apiKey.keyPrefix,
              rawKey, // returned only once per key — safe to return again here
            },
          });
        } catch {
          return error(c, "DUPLICATE_CLIENT_ID", (err as Error).message, 409);
        }
      }
      if (err instanceof ValidationError) {
        return error(c, "VALIDATION_ERROR", err.message, 400);
      }
      throw err;
    }
  }
);

// ── POST / ────────────────────────────────────────────────────
// Create service client. Requires service auth.

serviceClientRoutes.post("/", requireServiceAuth(), async (c) => {
  try {
    const body = await c.req.json();
    const authCtx = c.get("authContext");

    const clientId = requireString(body.clientId, "clientId");
    const name = requireString(body.name, "name");
    const appId = optionalString(body.appId);
    const scopes = Array.isArray(body.scopes) ? body.scopes : null;
    const allowedOrigins = Array.isArray(body.allowedOrigins)
      ? body.allowedOrigins
      : null;

    if (!isValidClientId(clientId)) {
      return error(
        c,
        "INVALID_CLIENT_ID",
        "client_id must be lowercase snake_case (letters, digits, underscores).",
        400
      );
    }

    const serviceClient = await createServiceClient(
      c.env,
      { clientId, name, appId, scopes, allowedOrigins },
      authCtx?.userId
    );

    return success(
      c,
      {
        serviceClient: {
          id: serviceClient.id,
          clientId: serviceClient.clientId,
          name: serviceClient.name,
          appId: serviceClient.appId,
          status: serviceClient.status,
          scopes: serviceClient.scopes,
          createdAt: serviceClient.createdAt,
        },
      },
      201
    );
  } catch (err) {
    if (err instanceof DuplicateClientIdError) {
      return error(c, "DUPLICATE_CLIENT_ID", err.message, 409);
    }
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── GET / ─────────────────────────────────────────────────────

serviceClientRoutes.get("/", requireServiceAuth(), async (c) => {
  const { limit, offset } = parseLimitOffset(
    c.req.query("limit"),
    c.req.query("offset")
  );
  const status = c.req.query("status");

  if (status && !isValidServiceClientStatus(status)) {
    return error(
      c,
      "INVALID_STATUS",
      `Invalid status. Allowed: ${SERVICE_CLIENT_STATUSES.join(", ")}`,
      400
    );
  }

  const result = await listServiceClients(c.env, { limit, offset, status });

  return success(c, {
    serviceClients: result.serviceClients.map((sc) => ({
      id: sc.id,
      clientId: sc.clientId,
      name: sc.name,
      appId: sc.appId,
      status: sc.status,
      scopes: sc.scopes,
      createdAt: sc.createdAt,
      lastUsedAt: sc.lastUsedAt,
    })),
    total: result.total,
    limit,
    offset,
  });
});

// ── GET /:id ──────────────────────────────────────────────────

serviceClientRoutes.get("/:id", requireServiceAuth(), async (c) => {
  const id = c.req.param("id");
  const sc = await getServiceClientById(c.env, id);

  if (!sc) {
    return error(c, "SERVICE_CLIENT_NOT_FOUND", "Service client not found.", 404);
  }

  return success(c, {
    serviceClient: {
      id: sc.id,
      clientId: sc.clientId,
      name: sc.name,
      appId: sc.appId,
      tenantId: sc.tenantId,
      status: sc.status,
      scopes: sc.scopes,
      allowedOrigins: sc.allowedOrigins,
      createdAt: sc.createdAt,
      updatedAt: sc.updatedAt,
      lastUsedAt: sc.lastUsedAt,
    },
  });
});

// ── PATCH /:id/status ─────────────────────────────────────────

serviceClientRoutes.patch("/:id/status", requireServiceAuth(), async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const authCtx = c.get("authContext");

    const status = requireString(body.status, "status");
    if (!isValidServiceClientStatus(status)) {
      return error(
        c,
        "INVALID_STATUS",
        `Invalid status. Allowed: ${SERVICE_CLIENT_STATUSES.join(", ")}`,
        400
      );
    }

    const updated = await updateServiceClientStatus(
      c.env,
      id,
      status as import("../types/serviceClients").ServiceClientStatus,
      authCtx?.userId
    );

    if (!updated) {
      return error(
        c,
        "SERVICE_CLIENT_NOT_FOUND",
        "Service client not found.",
        404
      );
    }

    return success(c, {
      serviceClient: {
        id: updated.id,
        clientId: updated.clientId,
        status: updated.status,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── POST /:id/api-keys ────────────────────────────────────────

serviceClientRoutes.post("/:id/api-keys", requireServiceAuth(), async (c) => {
  try {
    const serviceClientId = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const authCtx = c.get("authContext");

    const expiresAt = optionalString(body.expiresAt) ?? null;

    const { apiKey, rawKey } = await createServiceApiKey(
      c.env,
      serviceClientId,
      {
        expiresAt,
        createdByUserId: authCtx?.userId ?? null,
      }
    );

    return success(
      c,
      {
        apiKey: {
          id: apiKey.id,
          serviceClientId: apiKey.serviceClientId,
          keyPrefix: apiKey.keyPrefix,
          status: apiKey.status,
          expiresAt: apiKey.expiresAt,
          createdAt: apiKey.createdAt,
          // rawKey returned ONLY here — never again
          rawKey,
        },
      },
      201
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      return error(c, "SERVICE_CLIENT_NOT_FOUND", "Service client not found.", 404);
    }
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── GET /:id/api-keys ─────────────────────────────────────────

serviceClientRoutes.get("/:id/api-keys", requireServiceAuth(), async (c) => {
  const serviceClientId = c.req.param("id");

  const sc = await getServiceClientById(c.env, serviceClientId);
  if (!sc) {
    return error(c, "SERVICE_CLIENT_NOT_FOUND", "Service client not found.", 404);
  }

  const keys = await listServiceApiKeys(c.env, serviceClientId);

  return success(c, {
    // key_hash is never returned
    apiKeys: keys.map((k) => ({
      id: k.id,
      serviceClientId: k.serviceClientId,
      keyPrefix: k.keyPrefix,
      status: k.status,
      expiresAt: k.expiresAt,
      revokedAt: k.revokedAt,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
    })),
  });
});

// ── POST /api-keys/:keyId/revoke ──────────────────────────────

serviceClientRoutes.post(
  "/api-keys/:keyId/revoke",
  requireServiceAuth(),
  async (c) => {
    const keyId = c.req.param("keyId");
    const authCtx = c.get("authContext");

    const revoked = await revokeServiceApiKey(c.env, keyId, authCtx?.userId);

    if (!revoked) {
      return error(c, "API_KEY_NOT_FOUND", "API key not found.", 404);
    }

    return success(c, {
      apiKey: {
        id: revoked.id,
        status: revoked.status,
        revokedAt: revoked.revokedAt,
      },
    });
  }
);

export default serviceClientRoutes;
