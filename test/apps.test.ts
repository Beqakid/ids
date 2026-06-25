import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { ensureMigrations, serviceRequest } from "./setup";
import app from "../src/index";
import type { Env } from "../src/types/env";

beforeAll(async () => {
  await ensureMigrations();
});

describe("GET /api/apps", () => {
  it("returns seeded apps from D1", async () => {
    const req = new Request("http://localhost/api/apps");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThanOrEqual(6);
  });

  it("includes command_center, kai, sms, carehia, viliniu, volau", async () => {
    const req = new Request("http://localhost/api/apps");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const json = (await res.json()) as any;
    const appIds = json.data.map((a: any) => a.appId);

    expect(appIds).toContain("carehia");
    expect(appIds).toContain("viliniu");
    expect(appIds).toContain("volau");
    expect(appIds).toContain("sms");
    expect(appIds).toContain("kai");
    expect(appIds).toContain("command_center");
  });

  it("seeded apps have correct types and statuses", async () => {
    const req = new Request("http://localhost/api/apps");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const json = (await res.json()) as any;
    const byId: Record<string, any> = {};
    for (const a of json.data) byId[a.appId] = a;

    expect(byId.command_center.appType).toBe("admin");
    expect(byId.command_center.status).toBe("active");
    expect(byId.kai.appType).toBe("ai");
    expect(byId.kai.status).toBe("active");
    expect(byId.sms.appType).toBe("media");
    expect(byId.sms.status).toBe("active");
    expect(byId.carehia.appType).toBe("marketplace");
    expect(byId.carehia.status).toBe("planned");
    expect(byId.viliniu.appType).toBe("marketplace");
    expect(byId.viliniu.status).toBe("planned");
    expect(byId.volau.appType).toBe("knowledge");
    expect(byId.volau.status).toBe("planned");
  });
});

describe("GET /api/apps/:appId", () => {
  it("returns a single app by app_id", async () => {
    const req = new Request("http://localhost/api/apps/kai");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.appId).toBe("kai");
    expect(json.data.name).toBe("Kai");
    expect(json.data.appType).toBe("ai");
  });

  it("returns 404 for unknown app", async () => {
    const req = new Request("http://localhost/api/apps/nonexistent");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(404);
  });
});

describe("POST /api/internal/apps", () => {
  it("creates a new app", async () => {
    const req = serviceRequest("/api/internal/apps", "POST", {
      appId: "test_app",
      name: "Test App",
      appType: "service",
      status: "planned",
      description: "A test app for Phase 3.",
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(201);
    const json = (await res.json()) as any;
    expect(json.data.app.appId).toBe("test_app");
    expect(json.data.app.name).toBe("Test App");
    expect(json.data.app.appType).toBe("service");
  });

  it("rejects duplicate app_id", async () => {
    const req = serviceRequest("/api/internal/apps", "POST", {
      appId: "test_app",
      name: "Duplicate",
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    const json = (await res.json()) as any;
    expect(json.error.code).toBe("DUPLICATE_APP_ID");
  });

  it("rejects invalid app_id format", async () => {
    const req = serviceRequest("/api/internal/apps", "POST", {
      appId: "Invalid App-ID!",
      name: "Bad",
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    const json = (await res.json()) as any;
    expect(json.error.code).toBe("INVALID_APP_ID");
  });

  it("rejects invalid app status", async () => {
    const req = serviceRequest("/api/internal/apps", "POST", {
      appId: "bad_status_app",
      name: "Bad Status",
      status: "invalid_status",
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    const json = (await res.json()) as any;
    expect(json.error.code).toBe("INVALID_STATUS");
  });

  it("writes app_created audit log", async () => {
    const db = (env as unknown as Env).IDS_DB;
    const row = await db
      .prepare(
        "SELECT * FROM ids_audit_logs WHERE event_type = 'app_created' AND app_id = 'test_app'"
      )
      .first();
    expect(row).toBeTruthy();
  });
});

describe("PATCH /api/internal/apps/:appId/status", () => {
  it("updates app status", async () => {
    const req = serviceRequest("/api/internal/apps/test_app/status", "PATCH", {
      status: "active",
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.app.status).toBe("active");
  });
});
