import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { ensureMigrations, serviceRequest } from "./setup";
import app from "../src/index";
import type { Env } from "../src/types/env";

let userId: string;
let tenantId: string;
let membershipId: string;

beforeAll(async () => {
  await ensureMigrations();

  // Create user
  const userReq = serviceRequest("/api/internal/users", "POST", {
    displayName: "Membership User",
    email: "membership-user@example.com",
  });
  const userCtx = createExecutionContext();
  const userRes = await app.fetch(userReq, env, userCtx);
  await waitOnExecutionContext(userCtx);
  const userJson = (await userRes.json()) as any;
  userId = userJson.data.user.id;

  // Create tenant
  const tenantReq = serviceRequest("/api/internal/tenants", "POST", {
    appId: "kai",
    tenantKey: "test-project",
    name: "Test Project",
    tenantType: "project",
    ownerUserId: userId,
  });
  const tenantCtx = createExecutionContext();
  const tenantRes = await app.fetch(tenantReq, env, tenantCtx);
  await waitOnExecutionContext(tenantCtx);
  const tenantJson = (await tenantRes.json()) as any;
  tenantId = tenantJson.data.tenant.id;
});

describe("POST /api/internal/memberships", () => {
  it("creates a membership", async () => {
    const req = serviceRequest("/api/internal/memberships", "POST", {
      userId,
      appId: "kai",
      tenantId,
      roleKey: "project_owner",
      status: "active",
      metadata: { source: "manual_internal_setup" },
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(201);
    const json = (await res.json()) as any;
    expect(json.data.membership.userId).toBe(userId);
    expect(json.data.membership.appId).toBe("kai");
    expect(json.data.membership.tenantId).toBe(tenantId);
    expect(json.data.membership.roleKey).toBe("project_owner");
    expect(json.data.membership.status).toBe("active");
    expect(json.data.membership.joinedAt).toBeTruthy();
    membershipId = json.data.membership.id;
  });

  it("rejects non-existent user", async () => {
    const req = serviceRequest("/api/internal/memberships", "POST", {
      userId: "nonexistent-user",
      appId: "kai",
      tenantId,
      roleKey: "member",
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
  });

  it("rejects non-existent app", async () => {
    const req = serviceRequest("/api/internal/memberships", "POST", {
      userId,
      appId: "nonexistent_app",
      tenantId,
      roleKey: "member",
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
  });

  it("rejects non-existent tenant", async () => {
    const req = serviceRequest("/api/internal/memberships", "POST", {
      userId,
      appId: "kai",
      tenantId: "nonexistent-tenant",
      roleKey: "member",
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
  });

  it("rejects tenant that does not belong to app", async () => {
    // Create a tenant in viliniu
    const tReq = serviceRequest("/api/internal/tenants", "POST", {
      appId: "viliniu",
      tenantKey: "wrong-app-tenant",
      name: "Wrong App",
      tenantType: "business",
    });
    const tCtx = createExecutionContext();
    const tRes = await app.fetch(tReq, env, tCtx);
    await waitOnExecutionContext(tCtx);
    const tJson = (await tRes.json()) as any;
    const wrongTenantId = tJson.data.tenant.id;

    // Try to create membership with kai but viliniu tenant
    const req = serviceRequest("/api/internal/memberships", "POST", {
      userId,
      appId: "kai",
      tenantId: wrongTenantId,
      roleKey: "member",
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    const json = (await res.json()) as any;
    expect(json.error.message).toContain("does not belong to app");
  });

  it("rejects duplicate user + tenant + role_key", async () => {
    const req = serviceRequest("/api/internal/memberships", "POST", {
      userId,
      appId: "kai",
      tenantId,
      roleKey: "project_owner",
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    const json = (await res.json()) as any;
    expect(json.error.code).toBe("DUPLICATE_MEMBERSHIP");
  });

  it("writes membership_created audit log", async () => {
    const db = (env as unknown as Env).IDS_DB;
    const row = await db
      .prepare(
        "SELECT * FROM ids_audit_logs WHERE event_type = 'membership_created' AND user_id = ?"
      )
      .bind(userId)
      .first();
    expect(row).toBeTruthy();
  });
});

describe("GET /api/internal/users/:id/memberships", () => {
  it("lists memberships for a user", async () => {
    const req = serviceRequest(
      `/api/internal/users/${userId}/memberships`
    );
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.memberships.length).toBeGreaterThanOrEqual(1);
    expect(json.data.memberships[0].roleKey).toBe("project_owner");
  });
});

describe("GET /api/internal/tenants/:id/memberships", () => {
  it("lists memberships for a tenant", async () => {
    const req = serviceRequest(
      `/api/internal/tenants/${tenantId}/memberships`
    );
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.memberships.length).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /api/internal/apps/:appId/memberships", () => {
  it("lists memberships for an app", async () => {
    const req = serviceRequest(
      "/api/internal/apps/kai/memberships"
    );
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.memberships.length).toBeGreaterThanOrEqual(1);
  });
});

describe("PATCH /api/internal/memberships/:id/status", () => {
  it("updates membership status", async () => {
    const req = serviceRequest(
      `/api/internal/memberships/${membershipId}/status`,
      "PATCH",
      { status: "suspended" }
    );
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.membership.status).toBe("suspended");
  });
});

describe("POST /api/internal/memberships/:id/remove", () => {
  it("marks membership as removed (not hard delete)", async () => {
    // First reactivate
    await app.fetch(
      serviceRequest(
        `/api/internal/memberships/${membershipId}/status`,
        "PATCH",
        { status: "active" }
      ),
      env,
      createExecutionContext()
    );

    const req = serviceRequest(
      `/api/internal/memberships/${membershipId}/remove`,
      "POST"
    );
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.membership.status).toBe("removed");

    // Verify row still exists in DB (soft delete)
    const db = (env as unknown as Env).IDS_DB;
    const row = await db
      .prepare("SELECT * FROM ids_memberships WHERE id = ?")
      .bind(membershipId)
      .first();
    expect(row).toBeTruthy();
    expect((row as any).status).toBe("removed");
  });

  it("writes membership_removed audit log", async () => {
    const db = (env as unknown as Env).IDS_DB;
    const row = await db
      .prepare(
        "SELECT * FROM ids_audit_logs WHERE event_type = 'membership_removed' AND user_id = ?"
      )
      .bind(userId)
      .first();
    expect(row).toBeTruthy();
  });
});
