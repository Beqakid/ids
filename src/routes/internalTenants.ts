import { Hono } from "hono";
import { requireServiceAuth } from "../middleware/auth";
import type { HonoEnv } from "../types/env";
import { success, error } from "../lib/response";
import {
  requireString,
  optionalString,
  isValidTenantKey,
  isAllowedValue,
  parseLimitOffset,
  parseJsonMetadata,
  ValidationError,
} from "../lib/validation";
import {
  TENANT_TYPES,
  TENANT_STATUSES,
  type TenantType,
  type TenantStatus,
} from "../types/tenants";
import {
  createTenant,
  getTenantById,
  getTenantByKey,
  listTenants,
  updateTenant,
  updateTenantStatus,
  DuplicateTenantKeyError,
} from "../services/tenants";

const internalTenants = new Hono<HonoEnv>();

// Phase 5: protect all routes in this group with service/user auth.
// TODO: Phase 6 — add permission-level checks (ids.users.read etc.) per route.
internalTenants.use("*", requireServiceAuth());

// ── POST /api/internal/tenants ───────────────────────────────
// TODO: Phase 4/5 — protect with API key or service token.
internalTenants.post("/", async (c) => {
  try {
    const body = await c.req.json();

    const appId = requireString(body.appId, "appId");
    const tenantKey = requireString(body.tenantKey, "tenantKey").toLowerCase();
    const name = requireString(body.name, "name");
    const tenantType = requireString(body.tenantType, "tenantType");
    const status = optionalString(body.status);
    const ownerUserId = optionalString(body.ownerUserId);
    const domain = optionalString(body.domain);
    const metadata = parseJsonMetadata(body.metadata);

    if (!isValidTenantKey(tenantKey)) {
      return error(
        c,
        "INVALID_TENANT_KEY",
        "tenantKey must be lowercase letters, numbers, and hyphens only.",
        400
      );
    }

    if (!isAllowedValue(tenantType, TENANT_TYPES)) {
      return error(
        c,
        "INVALID_TENANT_TYPE",
        `Invalid tenantType. Allowed: ${TENANT_TYPES.join(", ")}`,
        400
      );
    }

    if (status && !isAllowedValue(status, TENANT_STATUSES)) {
      return error(
        c,
        "INVALID_STATUS",
        `Invalid status. Allowed: ${TENANT_STATUSES.join(", ")}`,
        400
      );
    }

    const tenant = await createTenant(c.env, {
      appId,
      tenantKey,
      name,
      tenantType: tenantType as TenantType,
      status: status as TenantStatus | undefined,
      ownerUserId,
      domain,
      metadata,
    });

    return success(
      c,
      {
        tenant: {
          id: tenant.id,
          appId: tenant.appId,
          tenantKey: tenant.tenantKey,
          name: tenant.name,
          tenantType: tenant.tenantType,
          status: tenant.status,
          ownerUserId: tenant.ownerUserId,
          domain: tenant.domain,
          metadata: tenant.metadata,
          createdAt: tenant.createdAt,
        },
      },
      201
    );
  } catch (err) {
    if (err instanceof DuplicateTenantKeyError) {
      return error(c, "DUPLICATE_TENANT_KEY", err.message, 400);
    }
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── GET /api/internal/tenants ────────────────────────────────
internalTenants.get("/", async (c) => {
  const { limit, offset } = parseLimitOffset(
    c.req.query("limit"),
    c.req.query("offset")
  );
  const appId = c.req.query("appId");
  const status = c.req.query("status");
  const tenantType = c.req.query("tenantType");
  const ownerUserId = c.req.query("ownerUserId");

  if (status && !isAllowedValue(status, TENANT_STATUSES)) {
    return error(c, "INVALID_STATUS", `Invalid status filter: ${status}`, 400);
  }
  if (tenantType && !isAllowedValue(tenantType, TENANT_TYPES)) {
    return error(
      c,
      "INVALID_TENANT_TYPE",
      `Invalid tenantType filter: ${tenantType}`,
      400
    );
  }

  const result = await listTenants(c.env, {
    limit,
    offset,
    appId,
    status,
    tenantType,
    ownerUserId,
  });

  return success(c, {
    tenants: result.tenants.map((t) => ({
      id: t.id,
      appId: t.appId,
      tenantKey: t.tenantKey,
      name: t.name,
      tenantType: t.tenantType,
      status: t.status,
      ownerUserId: t.ownerUserId,
      createdAt: t.createdAt,
    })),
    total: result.total,
    limit,
    offset,
  });
});

// ── GET /api/internal/tenants/:id ────────────────────────────
internalTenants.get("/:id", async (c) => {
  const tenantId = c.req.param("id");
  const tenant = await getTenantById(c.env, tenantId);

  if (!tenant) {
    return error(c, "TENANT_NOT_FOUND", "Tenant not found.", 404);
  }

  return success(c, {
    tenant: {
      id: tenant.id,
      appId: tenant.appId,
      tenantKey: tenant.tenantKey,
      name: tenant.name,
      tenantType: tenant.tenantType,
      status: tenant.status,
      ownerUserId: tenant.ownerUserId,
      domain: tenant.domain,
      metadata: tenant.metadata,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
    },
  });
});

// ── PATCH /api/internal/tenants/:id ──────────────────────────
// TODO: Phase 4/5 — protect with API key or service token.
internalTenants.patch("/:id", async (c) => {
  try {
    const tenantId = c.req.param("id");
    const body = await c.req.json();

    const name = optionalString(body.name);
    const domain = body.domain !== undefined ? body.domain : undefined;
    const ownerUserId =
      body.ownerUserId !== undefined ? body.ownerUserId : undefined;
    const metadata =
      body.metadata !== undefined ? parseJsonMetadata(body.metadata) : undefined;

    const tenant = await updateTenant(c.env, {
      tenantId,
      name,
      domain,
      ownerUserId,
      metadata,
    });

    if (!tenant) {
      return error(c, "TENANT_NOT_FOUND", "Tenant not found.", 404);
    }

    return success(c, {
      tenant: {
        id: tenant.id,
        appId: tenant.appId,
        tenantKey: tenant.tenantKey,
        name: tenant.name,
        tenantType: tenant.tenantType,
        status: tenant.status,
        ownerUserId: tenant.ownerUserId,
        domain: tenant.domain,
        metadata: tenant.metadata,
        updatedAt: tenant.updatedAt,
      },
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── PATCH /api/internal/tenants/:id/status ───────────────────
// TODO: Phase 4/5 — protect with API key or service token.
internalTenants.patch("/:id/status", async (c) => {
  try {
    const tenantId = c.req.param("id");
    const body = await c.req.json();
    const status = requireString(body.status, "status");

    if (!isAllowedValue(status, TENANT_STATUSES)) {
      return error(
        c,
        "INVALID_STATUS",
        `Invalid status. Allowed: ${TENANT_STATUSES.join(", ")}`,
        400
      );
    }

    const tenant = await updateTenantStatus(
      c.env,
      tenantId,
      status as TenantStatus
    );

    if (!tenant) {
      return error(c, "TENANT_NOT_FOUND", "Tenant not found.", 404);
    }

    return success(c, {
      tenant: {
        id: tenant.id,
        appId: tenant.appId,
        tenantKey: tenant.tenantKey,
        name: tenant.name,
        status: tenant.status,
        updatedAt: tenant.updatedAt,
      },
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

export default internalTenants;
