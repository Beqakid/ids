import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import app from "../src/index";

describe("GET /api/apps", () => {
  it("returns list of planned platform apps", async () => {
    const req = new Request("http://localhost/api/apps");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBe(6);
  });

  it("includes carehia, viliniu, volau, sms, kai, command_center", async () => {
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

  it("all apps have status planned", async () => {
    const req = new Request("http://localhost/api/apps");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const json = (await res.json()) as any;
    for (const a of json.data) {
      expect(a.status).toBe("planned");
    }
  });
});
