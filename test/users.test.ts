import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import app from "../src/index";
import { ensureMigrations, jsonRequest } from "./setup";

beforeAll(async () => {
  await ensureMigrations();
});

describe("GET /api/users/me", () => {
  it("returns authenticated false", async () => {
    const req = new Request("http://localhost/api/users/me");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.data.authenticated).toBe(false);
  });

  it("does not fake login", async () => {
    const req = new Request("http://localhost/api/users/me");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const json = (await res.json()) as any;
    expect(json.data.email).toBeUndefined();
    expect(json.data.name).toBeUndefined();
    expect(json.data.id).toBeUndefined();
    expect(json.data.role).toBeUndefined();
  });
});

describe("POST /api/internal/users", () => {
  it("creates a user", async () => {
    const req = jsonRequest("/api/internal/users", "POST", {
      displayName: "Test User",
      email: "test-create@example.com",
      phone: "+1 555 000 1111",
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(201);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.data.user.displayName).toBe("Test User");
    expect(json.data.user.primaryEmail).toBe("test-create@example.com");
    expect(json.data.user.primaryPhone).toBe("+1 555 000 1111");
    expect(json.data.user.status).toBe("active");
    expect(json.data.user.emailVerified).toBe(false);
    expect(json.data.user.phoneVerified).toBe(false);
    expect(json.data.user.id).toBeTruthy();
  });

  it("rejects duplicate email", async () => {
    // First create
    const req1 = jsonRequest("/api/internal/users", "POST", {
      displayName: "First",
      email: "duplicate@example.com",
    });
    const ctx1 = createExecutionContext();
    await app.fetch(req1, env, ctx1);
    await waitOnExecutionContext(ctx1);

    // Second create with same email
    const req2 = jsonRequest("/api/internal/users", "POST", {
      displayName: "Second",
      email: "duplicate@example.com",
    });
    const ctx2 = createExecutionContext();
    const res = await app.fetch(req2, env, ctx2);
    await waitOnExecutionContext(ctx2);

    expect(res.status).toBe(400);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("DUPLICATE_EMAIL");
  });

  it("rejects invalid email", async () => {
    const req = jsonRequest("/api/internal/users", "POST", {
      displayName: "Bad Email",
      email: "not-an-email",
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("INVALID_EMAIL");
  });
});

describe("GET /api/internal/users/:id", () => {
  it("returns safe user profile", async () => {
    // Create a user first
    const createReq = jsonRequest("/api/internal/users", "POST", {
      displayName: "Get Test",
      email: "gettest@example.com",
    });
    const ctx1 = createExecutionContext();
    const createRes = await app.fetch(createReq, env, ctx1);
    await waitOnExecutionContext(ctx1);
    const created = (await createRes.json()) as any;
    const userId = created.data.user.id;

    // Get the user
    const req = new Request(`http://localhost/api/internal/users/${userId}`);
    const ctx2 = createExecutionContext();
    const res = await app.fetch(req, env, ctx2);
    await waitOnExecutionContext(ctx2);

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.user.id).toBe(userId);
    expect(json.data.user.displayName).toBe("Get Test");
    expect(json.data.user.status).toBe("active");
    // Should not contain session_token_hash or sensitive fields
    expect(json.data.user.session_token_hash).toBeUndefined();
    expect(json.data.user.password).toBeUndefined();
  });

  it("returns 404 for unknown user", async () => {
    const req = new Request(
      "http://localhost/api/internal/users/nonexistent-id"
    );
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(404);
  });
});

describe("GET /api/internal/users", () => {
  it("returns paginated list", async () => {
    const req = new Request(
      "http://localhost/api/internal/users?limit=5&offset=0"
    );
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.data.users)).toBe(true);
    expect(typeof json.data.total).toBe("number");
    expect(json.data.limit).toBe(5);
    expect(json.data.offset).toBe(0);
  });
});

describe("PATCH /api/internal/users/:id/status", () => {
  it("updates status", async () => {
    // Create user
    const createReq = jsonRequest("/api/internal/users", "POST", {
      displayName: "Status Test",
      email: "statustest@example.com",
    });
    const ctx1 = createExecutionContext();
    const createRes = await app.fetch(createReq, env, ctx1);
    await waitOnExecutionContext(ctx1);
    const userId = ((await createRes.json()) as any).data.user.id;

    // Update status
    const req = jsonRequest(
      `/api/internal/users/${userId}/status`,
      "PATCH",
      { status: "pending_verification" }
    );
    const ctx2 = createExecutionContext();
    const res = await app.fetch(req, env, ctx2);
    await waitOnExecutionContext(ctx2);

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.user.status).toBe("pending_verification");
  });

  it("rejects invalid status", async () => {
    // Create user
    const createReq = jsonRequest("/api/internal/users", "POST", {
      displayName: "Invalid Status",
      email: "invalidstatus@example.com",
    });
    const ctx1 = createExecutionContext();
    const createRes = await app.fetch(createReq, env, ctx1);
    await waitOnExecutionContext(ctx1);
    const userId = ((await createRes.json()) as any).data.user.id;

    const req = jsonRequest(
      `/api/internal/users/${userId}/status`,
      "PATCH",
      { status: "banana" }
    );
    const ctx2 = createExecutionContext();
    const res = await app.fetch(req, env, ctx2);
    await waitOnExecutionContext(ctx2);

    expect(res.status).toBe(400);
    const json = (await res.json()) as any;
    expect(json.error.code).toBe("INVALID_STATUS");
  });

  it("revokes sessions when suspended", async () => {
    // Create user
    const createReq = jsonRequest("/api/internal/users", "POST", {
      displayName: "Suspend Test",
      email: "suspendtest@example.com",
    });
    const ctx1 = createExecutionContext();
    const createRes = await app.fetch(createReq, env, ctx1);
    await waitOnExecutionContext(ctx1);
    const userId = ((await createRes.json()) as any).data.user.id;

    // Create a session
    const sessReq = jsonRequest("/api/internal/sessions", "POST", {
      userId,
      appId: "kai",
      ttlSeconds: 3600,
    });
    const ctx2 = createExecutionContext();
    await app.fetch(sessReq, env, ctx2);
    await waitOnExecutionContext(ctx2);

    // Suspend the user
    const suspendReq = jsonRequest(
      `/api/internal/users/${userId}/status`,
      "PATCH",
      { status: "suspended" }
    );
    const ctx3 = createExecutionContext();
    const suspendRes = await app.fetch(suspendReq, env, ctx3);
    await waitOnExecutionContext(ctx3);

    const json = (await suspendRes.json()) as any;
    expect(json.data.user.status).toBe("suspended");
    expect(json.data.sessionsRevoked).toBeGreaterThanOrEqual(1);
  });
});
