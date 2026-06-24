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

async function getAuditLogs(eventType: string) {
  const db = (env as any).IDS_DB as D1Database;
  const result = await db
    .prepare(
      "SELECT * FROM ids_audit_logs WHERE event_type = ? ORDER BY created_at DESC"
    )
    .bind(eventType)
    .all();
  return result.results ?? [];
}

describe("Audit logging", () => {
  it("writes user_created audit log", async () => {
    const req = jsonRequest("/api/internal/users", "POST", {
      displayName: "Audit Create Test",
      email: "audit-create@example.com",
    });
    const ctx = createExecutionContext();
    await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const logs = await getAuditLogs("user_created");
    expect(logs.length).toBeGreaterThan(0);

    const latest = logs[0] as any;
    expect(latest.event_type).toBe("user_created");
    expect(latest.user_id).toBeTruthy();
  });

  it("writes user_status_updated audit log", async () => {
    // Create user
    const createReq = jsonRequest("/api/internal/users", "POST", {
      displayName: "Audit Status Test",
      email: "audit-status@example.com",
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
    await app.fetch(req, env, ctx2);
    await waitOnExecutionContext(ctx2);

    const logs = await getAuditLogs("user_status_updated");
    expect(logs.length).toBeGreaterThan(0);
    const match = logs.find((l: any) => l.user_id === userId);
    expect(match).toBeTruthy();
  });

  it("writes session_created audit log", async () => {
    // Create user
    const userReq = jsonRequest("/api/internal/users", "POST", {
      displayName: "Audit Session Test",
      email: "audit-session@example.com",
    });
    const ctx1 = createExecutionContext();
    const userRes = await app.fetch(userReq, env, ctx1);
    await waitOnExecutionContext(ctx1);
    const userId = ((await userRes.json()) as any).data.user.id;

    // Create session
    const req = jsonRequest("/api/internal/sessions", "POST", {
      userId,
      appId: "kai",
    });
    const ctx2 = createExecutionContext();
    await app.fetch(req, env, ctx2);
    await waitOnExecutionContext(ctx2);

    const logs = await getAuditLogs("session_created");
    expect(logs.length).toBeGreaterThan(0);
    const match = logs.find((l: any) => l.user_id === userId);
    expect(match).toBeTruthy();
  });

  it("writes session_revoked audit log", async () => {
    // Create user
    const userReq = jsonRequest("/api/internal/users", "POST", {
      displayName: "Audit Revoke Test",
      email: "audit-revoke@example.com",
    });
    const ctx1 = createExecutionContext();
    const userRes = await app.fetch(userReq, env, ctx1);
    await waitOnExecutionContext(ctx1);
    const userId = ((await userRes.json()) as any).data.user.id;

    // Create session
    const sessReq = jsonRequest("/api/internal/sessions", "POST", {
      userId,
      appId: "carehia",
    });
    const ctx2 = createExecutionContext();
    const sessRes = await app.fetch(sessReq, env, ctx2);
    await waitOnExecutionContext(ctx2);
    const sessionId = ((await sessRes.json()) as any).data.session.id;

    // Revoke
    const revokeReq = jsonRequest(
      `/api/internal/sessions/${sessionId}/revoke`,
      "POST"
    );
    const ctx3 = createExecutionContext();
    await app.fetch(revokeReq, env, ctx3);
    await waitOnExecutionContext(ctx3);

    const logs = await getAuditLogs("session_revoked");
    expect(logs.length).toBeGreaterThan(0);
    const match = logs.find((l: any) => l.user_id === userId);
    expect(match).toBeTruthy();
  });
});
