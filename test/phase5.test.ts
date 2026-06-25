/**
 * Phase 5 Tests — JWT Token Issuing, Service Auth, Route Protection
 *
 * Tests cover:
 *   1. JWT library (sign, verify, decode, error codes)
 *   2. API key library
 *   3. Service client bootstrap
 *   4. Service API key auth (route protection)
 *   5. Token exchange (session → access JWT)
 *   6. Token verify endpoint
 *   7. Token revoke
 *   8. Auth context (/api/auth/context)
 *   9. Internal route protection (unauthenticated → 401)
 *  10. Public routes stay public
 *  11. Token event listing
 *  12. Service client management
 *  13. /api/users/me with optional auth
 *  14. Regression — Phase 1–4B routes
 */

import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { ensureMigrations, jsonRequest, authedRequest, getTestServiceKey } from "./setup";
import {
  bootstrapHeader,
  serviceKeyHeader,
  bearerHeader,
  buildTestJwt,
  buildExpiredJwt,
  buildWrongIssuerJwt,
  buildWrongSecretJwt,
} from "./helpers/auth";
import { signJwt, verifyJwt, JwtError, createJti, getUnixTime } from "../src/lib/jwt";
import {
  generateServiceApiKey,
  hashServiceApiKey,
  getApiKeyPrefix,
  verifyServiceApiKey,
} from "../src/lib/apiKeys";

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

async function createUser(): Promise<string> {
  const res = await SELF.fetch(
    authedRequest(
      "/api/internal/users",
      "POST",
      { displayName: "Phase5 User" },
      { "x-ids-service-key": getTestServiceKey() }
    )
  );
  const body = await res.json<{ data: { user: { id: string } } }>();
  return body.data.user.id;
}

async function createApp(appId: string): Promise<void> {
  await SELF.fetch(
    authedRequest(
      "/api/internal/apps",
      "POST",
      { appId, name: `Phase5 App ${appId}` },
      { "x-ids-service-key": getTestServiceKey() }
    )
  );
}

async function createSession(userId: string, appId: string): Promise<string> {
  const res = await SELF.fetch(
    authedRequest(
      "/api/internal/sessions",
      "POST",
      { userId, appId, ipAddress: "127.0.0.1", userAgent: "Phase5-Test/1.0" },
      { "x-ids-service-key": getTestServiceKey() }
    )
  );
  const body = await res.json<{ data: { token: string } }>();
  return body.data.token;
}

async function bootstrapServiceClient(
  clientId: string,
  name: string
): Promise<{ serviceClientId: string; rawKey: string }> {
  const res = await SELF.fetch(
    authedRequest(
      "/api/internal/service-clients/bootstrap",
      "POST",
      { clientId, name },
      bootstrapHeader()
    )
  );
  expect([200, 201]).toContain(res.status);
  const body = await res.json<{
    data: { serviceClient: { id: string }; apiKey: { rawKey: string } };
  }>();
  return {
    serviceClientId: body.data.serviceClient.id,
    rawKey: body.data.apiKey.rawKey,
  };
}

// ────────────────────────────────────────────────────────────

beforeAll(async () => {
  await ensureMigrations();
});

// ════════════════════════════════════════════════════════════
// 1. JWT Library
// ════════════════════════════════════════════════════════════

describe("JWT library", () => {
  const secret = "test-jwt-secret-32-chars-minimum-00";

  it("signs and verifies a token", async () => {
    const token = await signJwt(
      { iss: "ids", sub: "user_1", aud: "app_1", typ: "access" },
      secret,
      { expiresIn: 900 }
    );
    expect(typeof token).toBe("string");
    const { payload } = await verifyJwt(token, secret, { issuer: "ids" });
    expect(payload.sub).toBe("user_1");
    expect(payload.iss).toBe("ids");
    expect(payload.aud).toBe("app_1");
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signJwt(
      { iss: "ids", sub: "u1" },
      "wrong-secret-that-is-at-least-32-chars-long",
      { expiresIn: 900 }
    );
    await expect(
      verifyJwt(token, secret, { issuer: "ids" })
    ).rejects.toThrow(JwtError);
  });

  it("rejects a token with wrong issuer", async () => {
    const token = await signJwt(
      { iss: "other", sub: "u1" },
      secret,
      { expiresIn: 900 }
    );
    await expect(
      verifyJwt(token, secret, { issuer: "ids" })
    ).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const token = await signJwt(
      { iss: "ids", sub: "u1" },
      secret,
      { expiresIn: -60 }
    );
    await expect(verifyJwt(token, secret, { issuer: "ids" })).rejects.toThrow(
      JwtError
    );
  });

  it("rejects a malformed token", async () => {
    await expect(
      verifyJwt("not.a.token", secret, { issuer: "ids" })
    ).rejects.toThrow(JwtError);
  });

  it("rejects an empty token", async () => {
    await expect(verifyJwt("", secret, { issuer: "ids" })).rejects.toThrow(
      JwtError
    );
  });

  it("sets exp / iat claims correctly", async () => {
    const now = getUnixTime();
    const token = await signJwt({ iss: "ids", sub: "u1" }, secret, {
      expiresIn: 300,
    });
    const { payload } = await verifyJwt(token, secret, { issuer: "ids" });
    expect(payload.exp as number).toBeGreaterThan(now);
    expect(payload.iat as number).toBeGreaterThanOrEqual(now - 2);
  });

  it("generates unique JTIs", () => {
    const a = createJti();
    const b = createJti();
    expect(a).not.toBe(b);
    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThan(8);
  });
});

// ════════════════════════════════════════════════════════════
// 2. API key library
// ════════════════════════════════════════════════════════════

describe("Service API key library", () => {
  it("generates a key with the correct prefix pattern", () => {
    const key = generateServiceApiKey("command_center");
    expect(key).toMatch(/^ids_sk_command_center_/);
  });

  it("hashes a key (SHA-256 no pepper)", async () => {
    const key = generateServiceApiKey("svc_a");
    const hash = await hashServiceApiKey(key);
    expect(typeof hash).toBe("string");
    expect(hash.length).toBe(64);
  });

  it("hashes a key (HMAC pepper)", async () => {
    const key = generateServiceApiKey("svc_b");
    const hash = await hashServiceApiKey(key, "mypepper");
    expect(typeof hash).toBe("string");
    expect(hash.length).toBe(64);
  });

  it("verifies a correct key", async () => {
    const key = generateServiceApiKey("svc_c");
    const hash = await hashServiceApiKey(key);
    expect(await verifyServiceApiKey(key, hash)).toBe(true);
  });

  it("rejects a wrong key", async () => {
    const key = generateServiceApiKey("svc_d");
    const hash = await hashServiceApiKey(key);
    expect(await verifyServiceApiKey("ids_sk_svc_d_wrongwrong", hash)).toBe(false);
  });

  it("extracts a stable prefix", () => {
    const key = generateServiceApiKey("svc_e");
    const prefix = getApiKeyPrefix(key);
    expect(typeof prefix).toBe("string");
    expect(prefix.length).toBe(28);
  });
});

// ════════════════════════════════════════════════════════════
// 3. Bootstrap route
// ════════════════════════════════════════════════════════════

describe("Bootstrap route", () => {
  it("creates a service client with valid bootstrap key", async () => {
    const res = await SELF.fetch(
      authedRequest(
        "/api/internal/service-clients/bootstrap",
        "POST",
        { clientId: "bootstrap_test_client", name: "Bootstrap Test Client" },
        bootstrapHeader()
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json<{
      data: {
        serviceClient: { id: string };
        apiKey: { rawKey: string; keyPrefix: string };
      };
    }>();
    expect(body.data.serviceClient.id).toBeTruthy();
    expect(body.data.apiKey.rawKey).toMatch(/^ids_sk_/);
    expect(body.data.apiKey.keyPrefix).toBeTruthy();
    expect(body.data.apiKey.rawKey.length).toBeGreaterThan(
      body.data.apiKey.keyPrefix.length
    );
    // key_hash must never appear
    expect(JSON.stringify(body)).not.toContain("key_hash");
  });

  it("rejects incorrect bootstrap key", async () => {
    const res = await SELF.fetch(
      authedRequest(
        "/api/internal/service-clients/bootstrap",
        "POST",
        { clientId: "bad_bootstrap_client", name: "Bad" },
        { "x-ids-bootstrap-key": "wrong-key-here" }
      )
    );
    expect(res.status).toBe(401);
  });

  it("is idempotent — duplicate client_id returns 200 with a new API key", async () => {
    await SELF.fetch(
      authedRequest(
        "/api/internal/service-clients/bootstrap",
        "POST",
        { clientId: "duplicate_client", name: "Dup A" },
        bootstrapHeader()
      )
    );
    const res = await SELF.fetch(
      authedRequest(
        "/api/internal/service-clients/bootstrap",
        "POST",
        { clientId: "duplicate_client", name: "Dup B" },
        bootstrapHeader()
      )
    );
    // Bootstrap is idempotent — duplicate returns 200 with a new API key.
    expect(res.status).toBe(200);
    const body = await res.json<{ data: { apiKey: { rawKey: string } } }>();
    expect(body.data.apiKey.rawKey).toBeTruthy();
  });

  it("rejects invalid client_id format", async () => {
    const res = await SELF.fetch(
      authedRequest(
        "/api/internal/service-clients/bootstrap",
        "POST",
        { clientId: "Bad Client ID!", name: "Bad" },
        bootstrapHeader()
      )
    );
    expect([400, 422]).toContain(res.status);
  });

  it("rejects missing bootstrap key", async () => {
    const res = await SELF.fetch(
      jsonRequest("/api/internal/service-clients/bootstrap", "POST", {
        clientId: "no_key_client",
        name: "No Key",
      })
    );
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════
// 4. Service client auth (via API key)
// ════════════════════════════════════════════════════════════

describe("Service API key auth", () => {
  let rawKey: string;

  beforeAll(async () => {
    const result = await bootstrapServiceClient(
      "auth_test_client",
      "Auth Test Client"
    );
    rawKey = result.rawKey;
  });

  it("authenticates a valid service API key on protected route", async () => {
    const res = await SELF.fetch(
      authedRequest(
        "/api/internal/service-clients",
        "GET",
        undefined,
        serviceKeyHeader(rawKey)
      )
    );
    expect(res.status).toBe(200);
  });

  it("rejects an invalid service API key", async () => {
    const res = await SELF.fetch(
      authedRequest(
        "/api/internal/service-clients",
        "GET",
        undefined,
        serviceKeyHeader("ids_sk_auth_test_client_totally_wrong_key_1234")
      )
    );
    expect(res.status).toBe(401);
  });

  it("rejects missing auth on protected route", async () => {
    const res = await SELF.fetch(
      jsonRequest("/api/internal/service-clients", "GET")
    );
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════
// 5. Token exchange (session → access JWT)
// ════════════════════════════════════════════════════════════

describe("POST /api/auth/token/exchange", () => {
  let sessionToken: string;
  let userId: string;
  const appId = "phase5_exchange_app";

  beforeAll(async () => {
    userId = await createUser();
    await createApp(appId);
    sessionToken = await createSession(userId, appId);
  });

  it("exchanges a valid session for a JWT", async () => {
    const res = await SELF.fetch(
      jsonRequest("/api/auth/token/exchange", "POST", { sessionToken, appId })
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      data: {
        accessToken: string;
        tokenType: string;
        expiresIn: number;
        user: { id: string };
        roles: string[];
        permissions: string[];
      };
    }>();
    expect(body.data.accessToken).toMatch(/^eyJ/);
    expect(body.data.tokenType).toBe("Bearer");
    expect(body.data.expiresIn).toBe(900);
    expect(body.data.user.id).toBe(userId);
    expect(Array.isArray(body.data.roles)).toBe(true);
    expect(Array.isArray(body.data.permissions)).toBe(true);
  });

  it("does not expose session_token_hash or raw secrets", async () => {
    const res = await SELF.fetch(
      jsonRequest("/api/auth/token/exchange", "POST", { sessionToken, appId })
    );
    const text = await res.text();
    expect(text).not.toContain("session_token_hash");
    expect(text).not.toContain("key_hash");
    expect(text).not.toContain("IDS_JWT_SECRET");
  });

  it("rejects an invalid session token", async () => {
    const res = await SELF.fetch(
      jsonRequest("/api/auth/token/exchange", "POST", {
        sessionToken: "totally_invalid_token",
        appId,
      })
    );
    expect(res.status).toBe(401);
  });

  it("rejects with a non-existent app", async () => {
    const res = await SELF.fetch(
      jsonRequest("/api/auth/token/exchange", "POST", {
        sessionToken,
        appId: "does_not_exist",
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects missing sessionToken", async () => {
    const res = await SELF.fetch(
      jsonRequest("/api/auth/token/exchange", "POST", { appId })
    );
    expect(res.status).toBe(400);
  });

  it("rejects missing appId", async () => {
    const res = await SELF.fetch(
      jsonRequest("/api/auth/token/exchange", "POST", { sessionToken })
    );
    expect(res.status).toBe(400);
  });

  it("respects a custom ttlSeconds", async () => {
    const res = await SELF.fetch(
      jsonRequest("/api/auth/token/exchange", "POST", {
        sessionToken,
        appId,
        ttlSeconds: 300,
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ data: { expiresIn: number } }>();
    expect(body.data.expiresIn).toBe(300);
  });
});

// ════════════════════════════════════════════════════════════
// 6. Token verify endpoint
// ════════════════════════════════════════════════════════════

describe("POST /api/auth/token/verify", () => {
  let accessToken: string;
  let userId: string;
  const appId = "phase5_verify_app";

  beforeAll(async () => {
    userId = await createUser();
    await createApp(appId);
    const sessionToken = await createSession(userId, appId);
    const res = await SELF.fetch(
      jsonRequest("/api/auth/token/exchange", "POST", { sessionToken, appId })
    );
    const body = await res.json<{ data: { accessToken: string } }>();
    accessToken = body.data.accessToken;
  });

  it("verifies a valid access token", async () => {
    const res = await SELF.fetch(
      jsonRequest("/api/auth/token/verify", "POST", { accessToken })
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      data: { valid: boolean; userId: string; appId: string };
    }>();
    expect(body.data.valid).toBe(true);
    expect(body.data.userId).toBe(userId);
    expect(body.data.appId).toBe(appId);
  });

  it("returns valid: false for an invalid token", async () => {
    const res = await SELF.fetch(
      jsonRequest("/api/auth/token/verify", "POST", {
        accessToken: "not.a.valid.jwt",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ data: { valid: boolean } }>();
    expect(body.data.valid).toBe(false);
  });

  it("returns valid: false for an expired token", async () => {
    const expired = await buildExpiredJwt({ userId, appId });
    const res = await SELF.fetch(
      jsonRequest("/api/auth/token/verify", "POST", { accessToken: expired })
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ data: { valid: boolean } }>();
    expect(body.data.valid).toBe(false);
  });

  it("returns valid: false for a wrong-issuer token", async () => {
    const bad = await buildWrongIssuerJwt({ userId, appId });
    const res = await SELF.fetch(
      jsonRequest("/api/auth/token/verify", "POST", { accessToken: bad })
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ data: { valid: boolean } }>();
    expect(body.data.valid).toBe(false);
  });

  it("rejects missing accessToken field", async () => {
    const res = await SELF.fetch(
      jsonRequest("/api/auth/token/verify", "POST", {})
    );
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════
// 7. Token revoke
// ════════════════════════════════════════════════════════════

describe("POST /api/auth/token/revoke", () => {
  let accessToken: string;
  let userId: string;
  const appId = "phase5_revoke_app";

  beforeAll(async () => {
    userId = await createUser();
    await createApp(appId);
    const sessionToken = await createSession(userId, appId);
    const res = await SELF.fetch(
      jsonRequest("/api/auth/token/exchange", "POST", { sessionToken, appId })
    );
    const body = await res.json<{ data: { accessToken: string } }>();
    accessToken = body.data.accessToken;
  });

  it("requires a Bearer token to revoke", async () => {
    const res = await SELF.fetch(
      jsonRequest("/api/auth/token/revoke", "POST", {})
    );
    expect(res.status).toBe(401);
  });

  it("revokes a valid token", async () => {
    const res = await SELF.fetch(
      authedRequest(
        "/api/auth/token/revoke",
        "POST",
        {},
        bearerHeader(accessToken)
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ data: { revoked: boolean } }>();
    expect(body.data.revoked).toBe(true);
  });

  it("token no longer validates after revocation", async () => {
    const res = await SELF.fetch(
      jsonRequest("/api/auth/token/verify", "POST", { accessToken })
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ data: { valid: boolean } }>();
    expect(body.data.valid).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
// 8. Auth context
// ════════════════════════════════════════════════════════════

describe("GET /api/auth/context", () => {
  let accessToken: string;
  let userId: string;
  const appId = "phase5_context_app";

  beforeAll(async () => {
    userId = await createUser();
    await createApp(appId);
    const sessionToken = await createSession(userId, appId);
    const res = await SELF.fetch(
      jsonRequest("/api/auth/token/exchange", "POST", { sessionToken, appId })
    );
    const body = await res.json<{ data: { accessToken: string } }>();
    accessToken = body.data.accessToken;
  });

  it("returns auth context for a valid Bearer token", async () => {
    const res = await SELF.fetch(
      authedRequest(
        "/api/auth/context",
        "GET",
        undefined,
        bearerHeader(accessToken)
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      data: {
        authenticated: boolean;
        user: { id: string };
        app: { appId: string };
      };
    }>();
    expect(body.data.authenticated).toBe(true);
    expect(body.data.user.id).toBe(userId);
    expect(body.data.app.appId).toBe(appId);
  });

  it("returns 401 without a token", async () => {
    const res = await SELF.fetch(
      jsonRequest("/api/auth/context", "GET")
    );
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════
// 9. Internal route protection
// ════════════════════════════════════════════════════════════

describe("Internal route protection", () => {
  const protectedRoutes = [
    { method: "GET", path: "/api/internal/users" },
    { method: "GET", path: "/api/internal/sessions" },
    { method: "GET", path: "/api/internal/apps" },
    { method: "GET", path: "/api/internal/tenants" },
    { method: "GET", path: "/api/internal/roles" },
    { method: "GET", path: "/api/internal/permissions" },
    { method: "GET", path: "/api/internal/token-events" },
    { method: "GET", path: "/api/internal/service-clients" },
  ];

  it.each(protectedRoutes)(
    "returns 401 for unauthenticated $method $path",
    async ({ method, path }) => {
      const res = await SELF.fetch(
        jsonRequest(path, method)
      );
      expect(res.status).toBe(401);
    }
  );
});

// ════════════════════════════════════════════════════════════
// 10. Public routes still work
// ════════════════════════════════════════════════════════════

describe("Public routes", () => {
  it("GET /api/health responds 200", async () => {
    const res = await SELF.fetch(
      jsonRequest("/api/health", "GET")
    );
    expect(res.status).toBe(200);
  });

  it("GET /api/users/me responds 200 without auth (not authenticated)", async () => {
    const res = await SELF.fetch(
      jsonRequest("/api/users/me", "GET")
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ data: { authenticated: boolean } }>();
    expect(body.data.authenticated).toBe(false);
  });

  it("GET /api/auth/token/verify is reachable (no blanket auth)", async () => {
    const res = await SELF.fetch(
      jsonRequest("/api/auth/token/verify", "POST", { accessToken: "x" })
    );
    // Should return 200 with valid: false, NOT 401
    expect(res.status).toBe(200);
    const body = await res.json<{ data: { valid: boolean } }>();
    expect(body.data.valid).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
// 11. /api/users/me with auth
// ════════════════════════════════════════════════════════════

describe("GET /api/users/me — with auth", () => {
  let accessToken: string;
  let userId: string;
  const appId = "phase5_me_app";

  beforeAll(async () => {
    userId = await createUser();
    await createApp(appId);
    const sessionToken = await createSession(userId, appId);
    const res = await SELF.fetch(
      jsonRequest("/api/auth/token/exchange", "POST", { sessionToken, appId })
    );
    const body = await res.json<{ data: { accessToken: string } }>();
    accessToken = body.data.accessToken;
  });

  it("returns user context with valid Bearer token", async () => {
    const res = await SELF.fetch(
      authedRequest(
        "/api/users/me",
        "GET",
        undefined,
        bearerHeader(accessToken)
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      data: { authenticated: boolean; user: { id: string } };
    }>();
    expect(body.data.authenticated).toBe(true);
    expect(body.data.user.id).toBe(userId);
  });
});

// ════════════════════════════════════════════════════════════
// 12. Token events listing
// ════════════════════════════════════════════════════════════

describe("GET /api/internal/token-events", () => {
  let rawKey: string;

  beforeAll(async () => {
    // Generate some events first
    const userId = await createUser();
    const appId = "phase5_events_app";
    await createApp(appId);
    const sessionToken = await createSession(userId, appId);
    await SELF.fetch(
      jsonRequest("/api/auth/token/exchange", "POST", { sessionToken, appId })
    );

    const result = await bootstrapServiceClient(
      "events_viewer_client",
      "Events Viewer"
    );
    rawKey = result.rawKey;
  });

  it("returns token events with service key auth", async () => {
    const res = await SELF.fetch(
      authedRequest(
        "/api/internal/token-events",
        "GET",
        undefined,
        serviceKeyHeader(rawKey)
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      data: { events: unknown[]; total: number };
    }>();
    expect(Array.isArray(body.data.events)).toBe(true);
    expect(typeof body.data.total).toBe("number");
    expect(JSON.stringify(body)).not.toContain("key_hash");
  });

  it("returns 401 without auth", async () => {
    const res = await SELF.fetch(
      jsonRequest("/api/internal/token-events", "GET")
    );
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════
// 13. Service client management
// ════════════════════════════════════════════════════════════

describe("Service client management", () => {
  let rawKey: string;
  let serviceClientId: string;

  beforeAll(async () => {
    const result = await bootstrapServiceClient(
      "mgmt_test_client",
      "Management Test Client"
    );
    rawKey = result.rawKey;
    serviceClientId = result.serviceClientId;
  });

  it("lists service clients", async () => {
    const res = await SELF.fetch(
      authedRequest(
        "/api/internal/service-clients",
        "GET",
        undefined,
        serviceKeyHeader(rawKey)
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      data: { serviceClients: { id: string }[] };
    }>();
    expect(Array.isArray(body.data.serviceClients)).toBe(true);
    expect(body.data.serviceClients.length).toBeGreaterThan(0);
  });

  it("gets a service client by id", async () => {
    const res = await SELF.fetch(
      authedRequest(
        `/api/internal/service-clients/${serviceClientId}`,
        "GET",
        undefined,
        serviceKeyHeader(rawKey)
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      data: { serviceClient: { id: string; clientId: string } };
    }>();
    expect(body.data.serviceClient.id).toBe(serviceClientId);
    expect(body.data.serviceClient.clientId).toBe("mgmt_test_client");
  });

  it("returns 404 for unknown service client", async () => {
    const res = await SELF.fetch(
      authedRequest(
        `/api/internal/service-clients/${crypto.randomUUID()}`,
        "GET",
        undefined,
        serviceKeyHeader(rawKey)
      )
    );
    expect(res.status).toBe(404);
  });

  it("creates an API key for a service client (rawKey returned once only)", async () => {
    const res = await SELF.fetch(
      authedRequest(
        `/api/internal/service-clients/${serviceClientId}/api-keys`,
        "POST",
        {},
        serviceKeyHeader(rawKey)
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json<{
      data: { apiKey: { id: string; rawKey: string; keyPrefix: string } };
    }>();
    expect(body.data.apiKey.rawKey).toMatch(/^ids_sk_/);
    // key_hash must not appear
    expect(JSON.stringify(body)).not.toContain("key_hash");
  });

  it("lists API keys (no rawKey or key_hash in list)", async () => {
    const res = await SELF.fetch(
      authedRequest(
        `/api/internal/service-clients/${serviceClientId}/api-keys`,
        "GET",
        undefined,
        serviceKeyHeader(rawKey)
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      data: { apiKeys: { id: string; status: string }[] };
    }>();
    expect(body.data.apiKeys.length).toBeGreaterThanOrEqual(1);
    const text = JSON.stringify(body);
    expect(text).not.toContain("key_hash");
    expect(text).not.toContain("rawKey");
  });

  it("revokes an API key", async () => {
    const createRes = await SELF.fetch(
      authedRequest(
        `/api/internal/service-clients/${serviceClientId}/api-keys`,
        "POST",
        {},
        serviceKeyHeader(rawKey)
      )
    );
    const createBody = await createRes.json<{
      data: { apiKey: { id: string; rawKey: string } };
    }>();
    const newKeyId = createBody.data.apiKey.id;

    const revokeRes = await SELF.fetch(
      authedRequest(
        `/api/internal/service-clients/api-keys/${newKeyId}/revoke`,
        "POST",
        {},
        serviceKeyHeader(rawKey)
      )
    );
    expect(revokeRes.status).toBe(200);
    const revokeBody = await revokeRes.json<{
      data: { apiKey: { status: string } };
    }>();
    expect(revokeBody.data.apiKey.status).toBe("revoked");
  });

  it("revoked API key can no longer authenticate", async () => {
    const createRes = await SELF.fetch(
      authedRequest(
        `/api/internal/service-clients/${serviceClientId}/api-keys`,
        "POST",
        {},
        serviceKeyHeader(rawKey)
      )
    );
    const createBody = await createRes.json<{
      data: { apiKey: { id: string; rawKey: string } };
    }>();
    const newRawKey = createBody.data.apiKey.rawKey;
    const newKeyId = createBody.data.apiKey.id;

    await SELF.fetch(
      authedRequest(
        `/api/internal/service-clients/api-keys/${newKeyId}/revoke`,
        "POST",
        {},
        serviceKeyHeader(rawKey)
      )
    );

    const res = await SELF.fetch(
      authedRequest(
        "/api/internal/service-clients",
        "GET",
        undefined,
        serviceKeyHeader(newRawKey)
      )
    );
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════
// 14. Regression — Phase 1–4B
// ════════════════════════════════════════════════════════════

describe("Regression — Phase 1–4B", () => {
  let rawKey: string;

  beforeAll(async () => {
    const result = await bootstrapServiceClient(
      "regression_client",
      "Regression Client"
    );
    rawKey = result.rawKey;
  });

  it("GET /api/health still returns 200", async () => {
    const res = await SELF.fetch(jsonRequest("/api/health", "GET"));
    expect(res.status).toBe(200);
  });

  it("GET /api/apps still returns 200", async () => {
    const res = await SELF.fetch(jsonRequest("/api/apps", "GET"));
    expect(res.status).toBe(200);
  });

  it("POST /api/internal/users still works with service key", async () => {
    const res = await SELF.fetch(
      authedRequest(
        "/api/internal/users",
        "POST",
        { displayName: "Regression User" },
        serviceKeyHeader(rawKey)
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json<{ data: { user: { id: string } } }>();
    expect(body.data.user.id).toBeTruthy();
  });

  it("POST /api/internal/apps still works with service key", async () => {
    const res = await SELF.fetch(
      authedRequest(
        "/api/internal/apps",
        "POST",
        { appId: "regression_phase5_app", name: "Regression App" },
        serviceKeyHeader(rawKey)
      )
    );
    expect([200, 201, 409]).toContain(res.status);
  });

  it("GET /api/internal/roles still returns 200 with service key", async () => {
    const res = await SELF.fetch(
      authedRequest(
        "/api/internal/roles",
        "GET",
        undefined,
        serviceKeyHeader(rawKey)
      )
    );
    expect(res.status).toBe(200);
  });

  it("GET /api/internal/permissions still returns 200 with service key", async () => {
    const res = await SELF.fetch(
      authedRequest(
        "/api/internal/permissions",
        "GET",
        undefined,
        serviceKeyHeader(rawKey)
      )
    );
    expect(res.status).toBe(200);
  });
});
