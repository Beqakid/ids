import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import app from "../src/index";
import { ensureMigrations, serviceRequest } from "./setup";

let testUserId: string;

beforeAll(async () => {
  await ensureMigrations();

  // Create a test user for session tests
  const req = serviceRequest("/api/internal/users", "POST", {
    displayName: "Session Test User",
    email: "session-test@example.com",
  });
  const ctx = createExecutionContext();
  const res = await app.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  const json = (await res.json()) as any;
  testUserId = json.data.user.id;
});

describe("POST /api/internal/sessions", () => {
  it("creates a session and returns token only once", async () => {
    const req = serviceRequest("/api/internal/sessions", "POST", {
      userId: testUserId,
      appId: "command_center",
      ttlSeconds: 7200,
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(201);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.data.session.id).toBeTruthy();
    expect(json.data.session.userId).toBe(testUserId);
    expect(json.data.session.appId).toBe("command_center");
    expect(json.data.session.status).toBe("active");
    expect(json.data.token).toBeTruthy();
    // Must NOT contain token_hash
    expect(json.data.session.session_token_hash).toBeUndefined();
    expect(json.data.session.sessionTokenHash).toBeUndefined();
  });

  it("stores hash only — not raw token", async () => {
    const req = serviceRequest("/api/internal/sessions", "POST", {
      userId: testUserId,
      appId: "kai",
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const json = (await res.json()) as any;
    const sessionId = json.data.session.id;
    const rawToken = json.data.token;

    // Verify raw token is a UUID-like string
    expect(rawToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );

    // Verify the DB stores a hash, not the raw token
    const db = (env as any).IDS_DB as D1Database;
    const row = await db
      .prepare("SELECT session_token_hash FROM ids_sessions WHERE id = ?")
      .bind(sessionId)
      .first<{ session_token_hash: string }>();

    expect(row).toBeTruthy();
    expect(row!.session_token_hash).not.toBe(rawToken);
    expect(row!.session_token_hash.length).toBe(64); // SHA-256 hex
  });
});

describe("GET /api/internal/users/:id/sessions", () => {
  it("lists sessions without token hash", async () => {
    // Create a session first so there's something to list
    const createReq = serviceRequest("/api/internal/sessions", "POST", {
      userId: testUserId,
      appId: "viliniu",
    });
    const ctx1 = createExecutionContext();
    await app.fetch(createReq, env, ctx1);
    await waitOnExecutionContext(ctx1);

    const req = serviceRequest(
      `/api/internal/users/${testUserId}/sessions`
    );
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(Array.isArray(json.data.sessions)).toBe(true);
    expect(json.data.sessions.length).toBeGreaterThan(0);

    // No session should expose token hash
    for (const s of json.data.sessions) {
      expect(s.session_token_hash).toBeUndefined();
      expect(s.sessionTokenHash).toBeUndefined();
      expect(s.token).toBeUndefined();
    }
  });
});

describe("POST /api/internal/sessions/:id/revoke", () => {
  it("revokes a session", async () => {
    // Create session
    const createReq = serviceRequest("/api/internal/sessions", "POST", {
      userId: testUserId,
      appId: "carehia",
    });
    const ctx1 = createExecutionContext();
    const createRes = await app.fetch(createReq, env, ctx1);
    await waitOnExecutionContext(ctx1);
    const sessionId = ((await createRes.json()) as any).data.session.id;

    // Revoke it
    const revokeReq = serviceRequest(
      `/api/internal/sessions/${sessionId}/revoke`,
      "POST"
    );
    const ctx2 = createExecutionContext();
    const revokeRes = await app.fetch(revokeReq, env, ctx2);
    await waitOnExecutionContext(ctx2);

    expect(revokeRes.status).toBe(200);
    const json = (await revokeRes.json()) as any;
    expect(json.data.session.status).toBe("revoked");
    expect(json.data.session.revokedAt).toBeTruthy();
  });
});

describe("POST /api/internal/users/:id/sessions/revoke-all", () => {
  it("revokes all active sessions for user", async () => {
    // Create a fresh user with multiple sessions
    const userReq = serviceRequest("/api/internal/users", "POST", {
      displayName: "Revoke All Test",
      email: "revokeall@example.com",
    });
    const ctx1 = createExecutionContext();
    const userRes = await app.fetch(userReq, env, ctx1);
    await waitOnExecutionContext(ctx1);
    const userId = ((await userRes.json()) as any).data.user.id;

    // Create two sessions
    for (const appId of ["kai", "viliniu"]) {
      const req = serviceRequest("/api/internal/sessions", "POST", {
        userId,
        appId,
      });
      const ctx = createExecutionContext();
      await app.fetch(req, env, ctx);
      await waitOnExecutionContext(ctx);
    }

    // Revoke all
    const revokeReq = serviceRequest(
      `/api/internal/users/${userId}/sessions/revoke-all`,
      "POST"
    );
    const ctx2 = createExecutionContext();
    const revokeRes = await app.fetch(revokeReq, env, ctx2);
    await waitOnExecutionContext(ctx2);

    expect(revokeRes.status).toBe(200);
    const json = (await revokeRes.json()) as any;
    expect(json.data.sessionsRevoked).toBe(2);

    // Verify all sessions are revoked
    const listReq = serviceRequest(
      `/api/internal/users/${userId}/sessions`
    );
    const ctx3 = createExecutionContext();
    const listRes = await app.fetch(listReq, env, ctx3);
    await waitOnExecutionContext(ctx3);
    const listJson = (await listRes.json()) as any;

    for (const s of listJson.data.sessions) {
      expect(s.status).toBe("revoked");
    }
  });
});
