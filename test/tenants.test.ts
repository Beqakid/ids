import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { ensureMigrations, jsonRequest } from "./setup";
import app from "../src/index";
import type { Env } from "../src/types/env";

let testUserId: string;
let testTenantId: string;

beforeAll(async () => {
  await ensureMigrations();

  // Create a test user for owner references
  const req = jsonRequest("/api/internal/users", "POST", {
    displayName: "Tenant Test User",
    email: "tenant-test@example.com",
  });
  const ctx = createExecutionContext();
  const res = await app.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  const json = (await res.json()) as any;
  testUserId = json.data.user.id;
});

describe("POST /api/internal/tenants", () => {
  it("creates a tenant", async () => {
    const req = jsonRequest("/api/internal/tenants", "POST", {
      appId: "viliniu",
      tenantKey: "derebu-farmers",
      name: "Derebu Farmers",
      tenantType: "business",
      ownerUserId: testUserId,
      domain: "derebu-farmers.viliniu.com",
      metadata: { country: "Fiji", category: "Farmers Market" },
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(201);
    const json = (await res.json()) as any;
    expect(json.data.tenant.tenantKey).toBe("derebu-farmers");
    expect(json.data.tenant.appId).toBe("viliniu");
    expect(json.data.tenant.tenantType).toBe("business");
    expect(json.data.tenant.ownerUserId).toBe(testUserId);
    testTenantId = json.data.tenant.id;
  });

  it("rejects invalid tenant_key", async () => {
    const req = jsonRequest("/api/internal/tenants", "POST", {
      appId: "viliniu",
      tenantKey: "Invalid Key!",
      name: "Bad",
      tenantType: "business",
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    const json = (await res.json()) as any;
    expect(json.error.code).toBe("INVALID_TENANT_KEY");
  });

  it("rejects duplicate tenant_key within same app", async () => {
    const req = jsonRequest("/api/internal/tenants", "POST", {
      appId: "viliniu",
      tenantKey: "derebu-farmers",
      name: "Duplicate",
      tenantType: "business",
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    const json = (await res.json()) as any;
    expect(json.error.code).toBe("DUPLICATE_TENANT_KEY");
  });

  it("allows same tenant_key across different apps", async () => {
    const req = jsonRequest("/api/internal/tenants", "POST", {
      appId: "carehia",
      tenantKey: "derebu-farmers",
      name: "Derebu Farmers Carehia",
      tenantType: "care_team",
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(201);
    const json = (await res.json()) as any;
    expect(json.data.tenant.appId).toBe("carehia");
    expect(json.data.tenant.tenantKey).toBe("derebu-farmers");
  });

  it("rejects non-existent owner_user_id", async () => {
    const req = jsonRequest("/api/internal/tenants", "POST", {
      appId: "viliniu",
      tenantKey: "ghost-owner-tenant",
      name: "Ghost Owner",
      tenantType: "business",
      ownerUserId: "nonexistent-user-id",
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
  });

  it("rejects invalid tenant status", async () => {
    const req = jsonRequest("/api/internal/tenants", "POST", {
      appId: "viliniu",
      tenantKey: "bad-status-tenant",
      name: "Bad Status",
      tenantType: "business",
      status: "fake_status",
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
  });

  it("writes tenant_created audit log", async () => {
    const db = (env as unknown as Env).IDS_DB;
    const row = await db
      .prepare(
        "SELECT * FROM ids_audit_logs WHERE event_type = 'tenant_created' AND app_id = 'viliniu'"
      )
      .first();
    expect(row).toBeTruthy();
  });
});

describe("GET /api/internal/tenants/:id", () => {
  it("returns tenant by ID", async () => {
    const req = new Request(
      `http://localhost/api/internal/tenants/${testTenantId}`
    );
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.tenant.id).toBe(testTenantId);
    expect(json.data.tenant.tenantKey).toBe("derebu-farmers");
  });
});

describe("GET /api/internal/apps/:appId/tenants/:tenantKey", () => {
  it("returns tenant by appId + tenantKey", async () => {
    const req = new Request(
      "http://localhost/api/internal/apps/viliniu/tenants/derebu-farmers"
    );
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.tenant.appId).toBe("viliniu");
    expect(json.data.tenant.tenantKey).toBe("derebu-farmers");
  });
});

describe("PATCH /api/internal/tenants/:id/status", () => {
  it("updates tenant status", async () => {
    const req = jsonRequest(
      `/api/internal/tenants/${testTenantId}/status`,
      "PATCH",
      { status: "suspended" }
    );
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.tenant.status).toBe("suspended");
  });

  // Revert for subsequent tests
  it("can revert tenant status back to active", async () => {
    const req = jsonRequest(
      `/api/internal/tenants/${testTenantId}/status`,
      "PATCH",
      { status: "active" }
    );
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.tenant.status).toBe("active");
  });
});
