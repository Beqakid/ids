import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import app from "../src/index";

describe("GET /api/health", () => {
  it("returns ok true", async () => {
    const req = new Request("http://localhost/api/health");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.data.ok).toBe(true);
  });

  it("returns service ids", async () => {
    const req = new Request("http://localhost/api/health");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const json = (await res.json()) as any;
    expect(json.data.service).toBe("ids");
  });

  it("returns version 0.1.0", async () => {
    const req = new Request("http://localhost/api/health");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const json = (await res.json()) as any;
    expect(json.data.version).toBe("0.1.0");
  });

  it("includes x-request-id header", async () => {
    const req = new Request("http://localhost/api/health");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("GET /api/version", () => {
  it("returns phase_2_core_identity", async () => {
    const req = new Request("http://localhost/api/version");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.phase).toBe("phase_2_core_identity");
    expect(json.data.service).toBe("ids");
    expect(json.data.version).toBe("0.1.0");
  });
});
