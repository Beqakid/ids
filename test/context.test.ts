import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { ensureMigrations, jsonRequest } from "./setup";
import app from "../src/index";
import type { Env } from "../src/types/env";

let userId: string;
let tenantId: string;
let membershipId: string;

beforeAll(async () => {
  await ensureMigrations();

  // Create user
  const userReq = jsonRequest("/api/internal/users", "POST", {
    displayName: "Context User",
    email: "context-user@example.com",
  });
  const userCtx = createExecutionContext();
  const userRes = await app.fetch(userReq, env, userCtx);
  await waitOnExecutionContext(userCtx);
  const userJson = (await userRes.json()) as any;
  userId = userJson.data.user.id;

  // Create tenant
  const tenantReq = jsonRequest("/api/internal/tenants", "POST", {
    appId: "command_center",
    tenantKey: "context-project",
    name: "Context Project",
    tenantType: "project",
  });
  const tenantCtx = createExecutionContext();
  const tenantRes = await app.fetch(tenantReq, env, tenantCtx);
  await waitOnExecutionContext(tenantCtx);
  const tenantJson = (await tenantRes.json()) as any;
  tenantId = tenantJson.data.tenant.id;

  // Create membership
  const memReq = jsonRequest("/api/internal/memberships", "POST", {
    userId,
    appId: "command_center",
    tenantId,
    roleKey: "admin",
  });
  const memCtx = createExecutionContext();
  const memRes = await app.fetch(memReq, env, memCtx);
  await waitOnExecutionContext(memCtx);
  const memJson = (await memRes.json()) as any;
  membershipId = memJson.data.membership.id;
});

describe("GET /api/internal/context", () => {
  it("returns full user + app + tenant + membership context", async () => {
    const req = new Request(
      `http://localhost/api/internal/context?userId=${userId}&appId=command_center&tenantId=${tenantId}`
    );
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.user.id).toBe(userId);
    expect(json.data.user.displayName).toBe("Context User");
    expect(json.data.app.appId).toBe("command_center");
    expect(json.data.tenant.tenantKey).toBe("context-project");
    expect(json.data.membership.roleKey).toBe("admin");
    expect(json.data.active).toBe(true);
  });

  it("returns active false for inactive membership", async () => {
    // Suspend the membership
    await app.fetch(
      jsonRequest(
        `/api/internal/memberships/${membershipId}/status`,
        "PATCH",
        { status: "suspended" }
      ),
      env,
      createExecutionContext()
    );

    const req = new Request(
      `http://localhost/api/internal/context?userId=${userId}&appId=command_center&tenantId=${tenantId}`
    );
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const json = (await res.json()) as any;
    expect(json.data.active).toBe(false);

    // Reactivate
    await app.fetch(
      jsonRequest(
        `/api/internal/memberships/${membershipId}/status`,
        "PATCH",
        { status: "active" }
      ),
      env,
      createExecutionContext()
    );
  });

  it("returns active false for suspended tenant", async () => {
    // Suspend tenant
    await app.fetch(
      jsonRequest(
        `/api/internal/tenants/${tenantId}/status`,
        "PATCH",
        { status: "suspended" }
      ),
      env,
      createExecutionContext()
    );

    const req = new Request(
      `http://localhost/api/internal/context?userId=${userId}&appId=command_center&tenantId=${tenantId}`
    );
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const json = (await res.json()) as any;
    expect(json.data.active).toBe(false);

    // Reactivate
    await app.fetch(
      jsonRequest(
        `/api/internal/tenants/${tenantId}/status`,
        "PATCH",
        { status: "active" }
      ),
      env,
      createExecutionContext()
    );
  });

  it("returns active false for suspended user", async () => {
    // Suspend user
    await app.fetch(
      jsonRequest(
        `/api/internal/users/${userId}/status`,
        "PATCH",
        { status: "suspended" }
      ),
      env,
      createExecutionContext()
    );

    const req = new Request(
      `http://localhost/api/internal/context?userId=${userId}&appId=command_center&tenantId=${tenantId}`
    );
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const json = (await res.json()) as any;
    expect(json.data.active).toBe(false);

    // Reactivate
    await app.fetch(
      jsonRequest(
        `/api/internal/users/${userId}/status`,
        "PATCH",
        { status: "active" }
      ),
      env,
      createExecutionContext()
    );
  });

  it("returns active false for missing membership", async () => {
    // Create user with no membership
    const noMemReq = jsonRequest("/api/internal/users", "POST", {
      displayName: "No Membership User",
      email: "no-membership@example.com",
    });
    const noMemCtx = createExecutionContext();
    const noMemRes = await app.fetch(noMemReq, env, noMemCtx);
    await waitOnExecutionContext(noMemCtx);
    const noMemJson = (await noMemRes.json()) as any;
    const noMemUserId = noMemJson.data.user.id;

    const req = new Request(
      `http://localhost/api/internal/context?userId=${noMemUserId}&appId=command_center&tenantId=${tenantId}`
    );
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const json = (await res.json()) as any;
    expect(json.data.active).toBe(false);
    expect(json.data.membership).toBeNull();
  });

  it("writes user_context_lookup audit log", async () => {
    const db = (env as unknown as Env).IDS_DB;
    const row = await db
      .prepare(
        "SELECT * FROM ids_audit_logs WHERE event_type = 'user_context_lookup' AND user_id = ?"
      )
      .bind(userId)
      .first();
    expect(row).toBeTruthy();
  });

  it("writes app access log for context lookup", async () => {
    const db = (env as unknown as Env).IDS_DB;
    const row = await db
      .prepare(
        "SELECT * FROM ids_app_access_logs WHERE event_type = 'membership_lookup' AND user_id = ?"
      )
      .bind(userId)
      .first();
    expect(row).toBeTruthy();
  });

  it("requires all query params", async () => {
    const req = new Request(
      "http://localhost/api/internal/context?userId=x&appId=y"
    );
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
  });
});
