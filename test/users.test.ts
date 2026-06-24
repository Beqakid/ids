import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import app from "../src/index";

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

  it("does not expose fake user data", async () => {
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
