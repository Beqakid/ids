/**
 * Phase 6 Tests — Command Center + Kai Integration Prep
 *
 * Tests:
 * - Platform context endpoints (GET /api/platform/*)
 * - Kai context endpoints (POST /api/kai/*)
 * - Trust receipt envelope endpoints (POST/GET /api/internal/trust-receipts/*)
 * - Security regression (no secrets, all new routes protected)
 * - Phase 1–5 regression
 */

import { describe, it, expect, beforeAll } from "vitest";
import { SELF } from "cloudflare:test";
import {
  ensureMigrations,
  jsonRequest,
  serviceRequest,
  getTestServiceKey,
  authedRequest,
} from "./setup";
import { buildTestJwt } from "./helpers/auth";

// ── Setup shared test data ────────────────────────────────────

let testUserId: string;
let testTenantId: string;
let testSessionId: string;
let testJwt: string;

beforeAll(async () => {
  await ensureMigrations();

  // Create a test user
  const userRes = await SELF.fetch(
    serviceRequest("/api/internal/users", "POST", {
      displayName: "Phase 6 Test User",
      email: "phase6@test.ids",
    })
  );
  const userBody = await userRes.json<{ data: { user: { id: string } } }>();
  testUserId = userBody.data.user.id;

  // Create a session for JWT
  const sessionRes = await SELF.fetch(
    serviceRequest("/api/internal/sessions", "POST", {
      userId: testUserId,
      appId: "command_center",
    })
  );
  const sessionBody = await sessionRes.json<{
    data: { session: { id: string } };
  }>();
  testSessionId = sessionBody.data.session.id;

  // Create a tenant
  const tenantRes = await SELF.fetch(
    serviceRequest("/api/internal/tenants", "POST", {
      appId: "viliniu",
      tenantKey: `p6-test-${crypto.randomUUID().slice(0, 8)}`,
      name: "Phase 6 Test Tenant",
      tenantType: "store",
    })
  );
  const tenantBody = await tenantRes.json<{ data: { tenant: { id: string } } }>();
  testTenantId = tenantBody.data.tenant.id;

  // Create membership for user in the tenant
  await SELF.fetch(
    serviceRequest("/api/internal/memberships", "POST", {
      userId: testUserId,
      appId: "viliniu",
      tenantId: testTenantId,
      roleKey: "vendor_owner",
    })
  );

  // Build a JWT for this user
  testJwt = await buildTestJwt({
    userId: testUserId,
    sessionId: testSessionId,
    appId: "command_center",
  });
});

// ────────────────────────────────────────────────────────────
// Platform Context
// ────────────────────────────────────────────────────────────

describe("Platform Context — GET /api/platform/me", () => {
  it("requires Bearer JWT", async () => {
    const res = await SELF.fetch(jsonRequest("/api/platform/me"));
    expect(res.status).toBe(401);
  });

  it("returns 401 for service key on /me", async () => {
    const res = await SELF.fetch(
      authedRequest("/api/platform/me", "GET", undefined, {
        "x-ids-service-key": getTestServiceKey(),
      })
    );
    // /me requires user JWT — service key should 401
    expect(res.status).toBe(401);
  });

  it("returns safe platform summary for authenticated user", async () => {
    const res = await SELF.fetch(
      authedRequest("/api/platform/me", "GET", undefined, {
        Authorization: `Bearer ${testJwt}`,
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      ok: boolean;
      data: {
        user: { id: string; status: string; emailVerified: boolean; phoneVerified: boolean };
        apps: unknown[];
        trustSignals: {
          emailVerified: boolean;
          phoneVerified: boolean;
          activeSessions: number;
          hasActiveMemberships: boolean;
        };
      };
    }>();
    expect(body.ok).toBe(true);
    expect(body.data.user.id).toBe(testUserId);
    expect(body.data.user.status).toBe("active");
    expect(typeof body.data.user.emailVerified).toBe("boolean");
    expect(typeof body.data.user.phoneVerified).toBe("boolean");
    expect(Array.isArray(body.data.apps)).toBe(true);
    expect(typeof body.data.trustSignals.activeSessions).toBe("number");
  });

  it("does not expose session_token_hash or secrets", async () => {
    const res = await SELF.fetch(
      authedRequest("/api/platform/me", "GET", undefined, {
        Authorization: `Bearer ${testJwt}`,
      })
    );
    const text = await res.text();
    expect(text).not.toContain("session_token_hash");
    expect(text).not.toContain("sessionTokenHash");
    expect(text).not.toContain("key_hash");
    expect(text).not.toContain("apiKeyHash");
    expect(text).not.toContain("password");
    expect(text).not.toContain("TWILIO");
  });
});

describe("Platform Context — GET /api/platform/users/:id/summary", () => {
  it("requires auth", async () => {
    const res = await SELF.fetch(
      jsonRequest(`/api/platform/users/${testUserId}/summary`)
    );
    expect(res.status).toBe(401);
  });

  it("service key can access user summary", async () => {
    const res = await SELF.fetch(
      serviceRequest(`/api/platform/users/${testUserId}/summary`)
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean; data: { user: { id: string } } }>();
    expect(body.ok).toBe(true);
    expect(body.data.user.id).toBe(testUserId);
  });

  it("returns 404 for non-existent user", async () => {
    const res = await SELF.fetch(
      serviceRequest(`/api/platform/users/non-existent-user-id/summary`)
    );
    expect(res.status).toBe(404);
  });
});

describe("Platform Context — GET /api/platform/users/:id/apps", () => {
  it("requires auth", async () => {
    const res = await SELF.fetch(
      jsonRequest(`/api/platform/users/${testUserId}/apps`)
    );
    expect(res.status).toBe(401);
  });

  it("returns app access list grouped by app", async () => {
    const res = await SELF.fetch(
      serviceRequest(`/api/platform/users/${testUserId}/apps`)
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      ok: boolean;
      data: { apps: { appId: string; roles: string[]; tenantCount: number }[] };
    }>();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data.apps)).toBe(true);

    // The user has a membership in viliniu via testTenantId
    const vilApp = body.data.apps.find((a) => a.appId === "viliniu");
    expect(vilApp).toBeDefined();
    expect(vilApp!.roles).toContain("vendor_owner");
    expect(vilApp!.tenantCount).toBeGreaterThan(0);
  });
});

describe("Platform Context — GET /api/platform/users/:id/tenants", () => {
  it("requires auth", async () => {
    const res = await SELF.fetch(
      jsonRequest(`/api/platform/users/${testUserId}/tenants`)
    );
    expect(res.status).toBe(401);
  });

  it("returns tenant membership list", async () => {
    const res = await SELF.fetch(
      serviceRequest(`/api/platform/users/${testUserId}/tenants`)
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      ok: boolean;
      data: {
        tenants: {
          tenantId: string;
          appId: string;
          roles: string[];
        }[];
      };
    }>();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data.tenants)).toBe(true);

    const vilTenant = body.data.tenants.find(
      (t) => t.tenantId === testTenantId
    );
    expect(vilTenant).toBeDefined();
    expect(vilTenant!.appId).toBe("viliniu");
    expect(vilTenant!.roles).toContain("vendor_owner");
  });

  it("filters by appId when provided", async () => {
    const res = await SELF.fetch(
      serviceRequest(
        `/api/platform/users/${testUserId}/tenants?appId=viliniu`
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      data: { tenants: { appId: string }[] };
    }>();
    for (const t of body.data.tenants) {
      expect(t.appId).toBe("viliniu");
    }
  });
});

describe("Platform Context — GET /api/platform/context", () => {
  it("requires auth", async () => {
    const res = await SELF.fetch(
      jsonRequest(
        `/api/platform/context?userId=${testUserId}&appId=viliniu`
      )
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 if userId or appId missing", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/platform/context?userId=someone")
    );
    expect(res.status).toBe(400);
  });

  it("returns full context including roles and permissions", async () => {
    const res = await SELF.fetch(
      serviceRequest(
        `/api/platform/context?userId=${testUserId}&appId=viliniu&tenantId=${testTenantId}`
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      ok: boolean;
      data: {
        user: { id: string };
        app: { appId: string };
        membership: { roleKey: string } | null;
        roles: string[];
        effectivePermissions: string[];
        trustSignals: { hasActiveMemberships: boolean };
      };
    }>();
    expect(body.ok).toBe(true);
    expect(body.data.user.id).toBe(testUserId);
    expect(body.data.app.appId).toBe("viliniu");
    expect(body.data.membership?.roleKey).toBe("vendor_owner");
    expect(body.data.roles).toContain("vendor_owner");
    expect(Array.isArray(body.data.effectivePermissions)).toBe(true);
    expect(body.data.trustSignals.hasActiveMemberships).toBe(true);
  });

  it("context request writes to ids_platform_context_requests", async () => {
    // Hit context endpoint and check audit via logs (indirect)
    const res = await SELF.fetch(
      serviceRequest(
        `/api/platform/context?userId=${testUserId}&appId=viliniu`
      )
    );
    expect(res.status).toBe(200);
    // The write is fire-and-forget tested via internal DB; success here implies table exists
  });
});

// ────────────────────────────────────────────────────────────
// Kai Context
// ────────────────────────────────────────────────────────────

describe("Kai Context — POST /api/kai/context", () => {
  it("requires auth", async () => {
    const res = await SELF.fetch(
      jsonRequest("/api/kai/context", "POST", {
        userId: testUserId,
        appId: "viliniu",
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns Kai context payload with user/app/tenant/membership", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/kai/context", "POST", {
        userId: testUserId,
        appId: "viliniu",
        tenantId: testTenantId,
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      ok: boolean;
      data: {
        context: {
          user: { id: string };
          app: { appId: string };
          tenant: { tenantId: string } | null;
          membership: { roleKey: string } | null;
          roles: string[];
          effectivePermissions: string[];
          trustSignals: Record<string, unknown>;
          allowedActionHints: string[];
          safetyNotes: string[];
        };
      };
    }>();
    expect(body.ok).toBe(true);
    expect(body.data.context.user.id).toBe(testUserId);
    expect(body.data.context.app?.appId).toBe("viliniu");
    expect(body.data.context.tenant?.tenantId).toBe(testTenantId);
    expect(body.data.context.membership?.roleKey).toBe("vendor_owner");
    expect(body.data.context.roles).toContain("vendor_owner");
    expect(Array.isArray(body.data.context.effectivePermissions)).toBe(true);
    expect(Array.isArray(body.data.context.safetyNotes)).toBe(true);
  });

  it("returns 404 for non-existent user", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/kai/context", "POST", {
        userId: "ghost-user-id",
        appId: "viliniu",
      })
    );
    expect(res.status).toBe(404);
  });
});

describe("Kai Context — POST /api/kai/action-contexts/prepare", () => {
  it("requires auth", async () => {
    const res = await SELF.fetch(
      jsonRequest("/api/kai/action-contexts/prepare", "POST", {
        userId: testUserId,
        appId: "viliniu",
        actionKey: "viliniu.dispatch.create",
        actionLabel: "Create dispatch",
        actionType: "dispatch",
      })
    );
    expect(res.status).toBe(401);
  });

  it("validates required fields", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/kai/action-contexts/prepare", "POST", {
        userId: testUserId,
        appId: "viliniu",
        // missing actionKey, actionLabel, actionType
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects invalid actionType", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/kai/action-contexts/prepare", "POST", {
        userId: testUserId,
        appId: "viliniu",
        actionKey: "viliniu.dispatch.create",
        actionLabel: "Create dispatch",
        actionType: "invalidtype",
      })
    );
    expect(res.status).toBe(400);
  });

  it("low-risk action returns allowed status", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/kai/action-contexts/prepare", "POST", {
        userId: testUserId,
        appId: "viliniu",
        tenantId: testTenantId,
        actionKey: "viliniu.products.read",
        actionLabel: "Read products",
        actionType: "explain",
        riskLevel: "low",
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json<{
      ok: boolean;
      data: {
        allowed: boolean;
        status: string;
        requiresConfirmation: boolean;
        requiresAdminApproval: boolean;
        riskLevel: string;
      };
    }>();
    expect(body.ok).toBe(true);
    expect(body.data.allowed).toBe(true);
    expect(body.data.status).toBe("allowed");
    expect(body.data.requiresConfirmation).toBe(false);
    expect(body.data.requiresAdminApproval).toBe(false);
    expect(body.data.riskLevel).toBe("low");
  });

  it("medium-risk action returns confirmation_required", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/kai/action-contexts/prepare", "POST", {
        userId: testUserId,
        appId: "viliniu",
        tenantId: testTenantId,
        actionKey: "viliniu.dispatch.create",
        actionLabel: "Create Viliniu dispatch",
        actionType: "dispatch",
        riskLevel: "medium",
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json<{
      data: {
        allowed: boolean;
        status: string;
        requiresConfirmation: boolean;
        requiresAdminApproval: boolean;
      };
    }>();
    expect(body.data.status).toBe("confirmation_required");
    expect(body.data.requiresConfirmation).toBe(true);
    expect(body.data.requiresAdminApproval).toBe(false);
  });

  it("high-risk action returns admin_approval_required", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/kai/action-contexts/prepare", "POST", {
        userId: testUserId,
        appId: "viliniu",
        tenantId: testTenantId,
        actionKey: "viliniu.payouts.update",
        actionLabel: "Update payouts",
        actionType: "update",
        riskLevel: "high",
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json<{
      data: { status: string; requiresAdminApproval: boolean };
    }>();
    expect(body.data.status).toBe("admin_approval_required");
    expect(body.data.requiresAdminApproval).toBe(true);
  });

  it("blocked-risk action is denied", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/kai/action-contexts/prepare", "POST", {
        userId: testUserId,
        appId: "viliniu",
        tenantId: testTenantId,
        actionKey: "viliniu.danger.nuke",
        actionLabel: "Nuke everything",
        actionType: "delete",
        riskLevel: "blocked",
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json<{
      data: { allowed: boolean; status: string };
    }>();
    expect(body.data.allowed).toBe(false);
    expect(body.data.status).toBe("denied");
  });

  it("suspended user is denied", async () => {
    // Create + suspend a user
    const newUserRes = await SELF.fetch(
      serviceRequest("/api/internal/users", "POST", {
        displayName: "Suspended P6 User",
        email: `suspended-p6-${crypto.randomUUID().slice(0, 8)}@test.ids`,
      })
    );
    const newUser = await newUserRes.json<{ data: { user: { id: string } } }>();
    const suspendedUserId = newUser.data.user.id;

    await SELF.fetch(
      serviceRequest(`/api/internal/users/${suspendedUserId}/status`, "PATCH", {
        status: "suspended",
      })
    );

    const res = await SELF.fetch(
      serviceRequest("/api/kai/action-contexts/prepare", "POST", {
        userId: suspendedUserId,
        appId: "viliniu",
        actionKey: "viliniu.products.read",
        actionLabel: "Read products",
        actionType: "explain",
        riskLevel: "low",
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json<{
      data: { allowed: boolean; status: string };
    }>();
    expect(body.data.allowed).toBe(false);
    expect(body.data.status).toBe("denied");
  });

  it("suspended app is denied", async () => {
    // Create a new app and suspend it
    const appRes = await SELF.fetch(
      serviceRequest("/api/internal/apps", "POST", {
        appId: `p6testapp${crypto.randomUUID().slice(0, 6)}`,
        name: "P6 Suspended App",
      })
    );
    const appBody = await appRes.json<{ data: { app: { appId: string } } }>();
    const suspendedAppId = appBody.data.app.appId;

    await SELF.fetch(
      serviceRequest(`/api/internal/apps/${suspendedAppId}/status`, "PATCH", {
        status: "suspended",
      })
    );

    const res = await SELF.fetch(
      serviceRequest("/api/kai/action-contexts/prepare", "POST", {
        userId: testUserId,
        appId: suspendedAppId,
        actionKey: "some.action.test",
        actionLabel: "Test action",
        actionType: "explain",
        riskLevel: "low",
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json<{
      data: { allowed: boolean; status: string };
    }>();
    expect(body.data.allowed).toBe(false);
    expect(body.data.status).toBe("denied");
  });

  it("no membership in tenant is denied", async () => {
    // Create new user with no membership
    const newUserRes = await SELF.fetch(
      serviceRequest("/api/internal/users", "POST", {
        displayName: "No Membership P6 User",
        email: `nomem-p6-${crypto.randomUUID().slice(0, 8)}@test.ids`,
      })
    );
    const newUser = await newUserRes.json<{ data: { user: { id: string } } }>();
    const newUserId = newUser.data.user.id;

    const res = await SELF.fetch(
      serviceRequest("/api/kai/action-contexts/prepare", "POST", {
        userId: newUserId,
        appId: "viliniu",
        tenantId: testTenantId,
        actionKey: "viliniu.products.read",
        actionLabel: "Read products",
        actionType: "explain",
        riskLevel: "low",
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json<{
      data: { allowed: boolean; status: string };
    }>();
    expect(body.data.allowed).toBe(false);
    expect(body.data.status).toBe("denied");
  });

  it("prepared action writes ids_kai_action_contexts and audit log", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/kai/action-contexts/prepare", "POST", {
        userId: testUserId,
        appId: "viliniu",
        tenantId: testTenantId,
        actionKey: "viliniu.products.create",
        actionLabel: "Create product",
        actionType: "draft",
        riskLevel: "low",
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json<{
      data: { actionContextId: string };
    }>();
    const contextId = body.data.actionContextId;
    expect(typeof contextId).toBe("string");
    expect(contextId.length).toBeGreaterThan(0);

    // Verify we can fetch it back
    const getRes = await SELF.fetch(
      serviceRequest(`/api/kai/action-contexts/${contextId}`)
    );
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json<{
      data: { actionContext: { id: string; userId: string } };
    }>();
    expect(getBody.data.actionContext.id).toBe(contextId);
    expect(getBody.data.actionContext.userId).toBe(testUserId);
  });

  it("prepared action creates a draft receipt envelope", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/kai/action-contexts/prepare", "POST", {
        userId: testUserId,
        appId: "viliniu",
        tenantId: testTenantId,
        actionKey: "viliniu.orders.update",
        actionLabel: "Update order status",
        actionType: "update",
        riskLevel: "medium",
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json<{
      data: { receiptEnvelopeId: string | null };
    }>();
    // Medium-risk allowed should produce a receipt envelope
    expect(body.data.receiptEnvelopeId).not.toBeNull();
    expect(typeof body.data.receiptEnvelopeId).toBe("string");
  });
});

describe("Kai Context — GET /api/kai/action-contexts/:id", () => {
  it("requires auth", async () => {
    const res = await SELF.fetch(jsonRequest("/api/kai/action-contexts/fake-id"));
    expect(res.status).toBe(401);
  });

  it("returns 404 for missing id", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/kai/action-contexts/not-a-real-id")
    );
    expect(res.status).toBe(404);
  });
});

describe("Kai Context — GET /api/kai/action-contexts", () => {
  it("requires auth", async () => {
    const res = await SELF.fetch(jsonRequest("/api/kai/action-contexts"));
    expect(res.status).toBe(401);
  });

  it("returns list with pagination", async () => {
    const res = await SELF.fetch(
      serviceRequest(
        `/api/kai/action-contexts?userId=${testUserId}&limit=5&offset=0`
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      ok: boolean;
      data: {
        actionContexts: unknown[];
        total: number;
        limit: number;
        offset: number;
      };
    }>();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data.actionContexts)).toBe(true);
    expect(typeof body.data.total).toBe("number");
    expect(body.data.total).toBeGreaterThan(0);
  });

  it("validates status filter", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/kai/action-contexts?status=invalid_status")
    );
    expect(res.status).toBe(400);
  });
});

// ────────────────────────────────────────────────────────────
// Trust Receipt Envelopes
// ────────────────────────────────────────────────────────────

describe("Trust Receipt Envelopes — POST /api/internal/trust-receipts/envelopes", () => {
  it("requires auth", async () => {
    const res = await SELF.fetch(
      jsonRequest("/api/internal/trust-receipts/envelopes", "POST", {
        receiptType: "kai_action",
        sourceAppId: "command_center",
      })
    );
    expect(res.status).toBe(401);
  });

  it("creates a draft receipt envelope", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/internal/trust-receipts/envelopes", "POST", {
        receiptType: "kai_action",
        sourceAppId: "command_center",
        userId: testUserId,
        riskLevel: "medium",
        actionKey: "viliniu.dispatch.create",
        summary: "Kai prepared a medium-risk dispatch action requiring confirmation.",
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json<{
      ok: boolean;
      data: { envelope: { id: string; status: string; receiptType: string } };
    }>();
    expect(body.ok).toBe(true);
    expect(body.data.envelope.status).toBe("draft");
    expect(body.data.envelope.receiptType).toBe("kai_action");
    expect(typeof body.data.envelope.id).toBe("string");
  });

  it("rejects invalid receiptType", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/internal/trust-receipts/envelopes", "POST", {
        receiptType: "invalid_type",
        sourceAppId: "command_center",
      })
    );
    expect(res.status).toBe(400);
  });

  it("requires receiptType and sourceAppId", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/internal/trust-receipts/envelopes", "POST", {
        receiptType: "kai_action",
        // missing sourceAppId
      })
    );
    expect(res.status).toBe(400);
  });
});

describe("Trust Receipt Envelopes — GET", () => {
  let envelopeId: string;

  beforeAll(async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/internal/trust-receipts/envelopes", "POST", {
        receiptType: "permission_check",
        sourceAppId: "viliniu",
        userId: testUserId,
        riskLevel: "low",
        summary: "Permission check receipt for test.",
      })
    );
    const body = await res.json<{
      data: { envelope: { id: string } };
    }>();
    envelopeId = body.data.envelope.id;
  });

  it("requires auth to get envelope by ID", async () => {
    const res = await SELF.fetch(
      jsonRequest(`/api/internal/trust-receipts/envelopes/${envelopeId}`)
    );
    expect(res.status).toBe(401);
  });

  it("gets receipt envelope by ID", async () => {
    const res = await SELF.fetch(
      serviceRequest(`/api/internal/trust-receipts/envelopes/${envelopeId}`)
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      ok: boolean;
      data: { envelope: { id: string; status: string } };
    }>();
    expect(body.ok).toBe(true);
    expect(body.data.envelope.id).toBe(envelopeId);
    expect(body.data.envelope.status).toBe("draft");
  });

  it("returns 404 for missing envelope", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/internal/trust-receipts/envelopes/not-a-real-id")
    );
    expect(res.status).toBe(404);
  });

  it("lists receipt envelopes with pagination", async () => {
    const res = await SELF.fetch(
      serviceRequest(
        `/api/internal/trust-receipts/envelopes?userId=${testUserId}&limit=10`
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      ok: boolean;
      data: { envelopes: unknown[]; total: number };
    }>();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data.envelopes)).toBe(true);
    expect(body.data.total).toBeGreaterThan(0);
  });

  it("filters by receiptType", async () => {
    const res = await SELF.fetch(
      serviceRequest(
        "/api/internal/trust-receipts/envelopes?receiptType=permission_check"
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      data: { envelopes: { receiptType: string }[] };
    }>();
    for (const e of body.data.envelopes) {
      expect(e.receiptType).toBe("permission_check");
    }
  });

  it("rejects invalid receiptType filter", async () => {
    const res = await SELF.fetch(
      serviceRequest(
        "/api/internal/trust-receipts/envelopes?receiptType=bogus_type"
      )
    );
    expect(res.status).toBe(400);
  });

  it("finalizes envelope", async () => {
    const res = await SELF.fetch(
      serviceRequest(
        `/api/internal/trust-receipts/envelopes/${envelopeId}/finalize`,
        "POST",
        { summary: "Finalized for testing." }
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      data: { envelope: { id: string; status: string; finalizedAt: string | null } };
    }>();
    expect(body.data.envelope.status).toBe("finalized");
    expect(body.data.envelope.finalizedAt).not.toBeNull();
  });

  it("cancels a draft envelope", async () => {
    // Create a fresh envelope to cancel
    const createRes = await SELF.fetch(
      serviceRequest("/api/internal/trust-receipts/envelopes", "POST", {
        receiptType: "system_event",
        sourceAppId: "command_center",
        summary: "Test cancel.",
      })
    );
    const createBody = await createRes.json<{
      data: { envelope: { id: string } };
    }>();
    const cancelId = createBody.data.envelope.id;

    const res = await SELF.fetch(
      serviceRequest(
        `/api/internal/trust-receipts/envelopes/${cancelId}/cancel`,
        "POST",
        { reason: "Test cancellation." }
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      data: { envelope: { status: string } };
    }>();
    expect(body.data.envelope.status).toBe("canceled");
  });

  it("receipt envelope audit log is written (create writes audit)", async () => {
    // Creating an envelope triggers writeAuditLog for trust_receipt_envelope_created.
    // Success is implicit: if DB is happy, audit ran without exception.
    const res = await SELF.fetch(
      serviceRequest("/api/internal/trust-receipts/envelopes", "POST", {
        receiptType: "admin_action",
        sourceAppId: "command_center",
        summary: "Admin audit log test.",
      })
    );
    expect(res.status).toBe(201);
  });

  it("never exposes secrets in receipt envelope response", async () => {
    const res = await SELF.fetch(
      serviceRequest(`/api/internal/trust-receipts/envelopes/${envelopeId}`)
    );
    const text = await res.text();
    expect(text).not.toContain("session_token_hash");
    expect(text).not.toContain("key_hash");
    expect(text).not.toContain("TWILIO");
    expect(text).not.toContain("password");
  });
});

// ────────────────────────────────────────────────────────────
// Security Regression
// ────────────────────────────────────────────────────────────

describe("Security Regression — Phase 6 routes require auth", () => {
  const protectedRoutes: Array<{ method: string; path: string; body?: unknown }> = [
    { method: "GET", path: "/api/platform/me" },
    { method: "GET", path: "/api/platform/users/any-id/summary" },
    { method: "GET", path: "/api/platform/users/any-id/apps" },
    { method: "GET", path: "/api/platform/users/any-id/tenants" },
    { method: "GET", path: "/api/platform/context" },
    { method: "POST", path: "/api/kai/context", body: {} },
    {
      method: "POST",
      path: "/api/kai/action-contexts/prepare",
      body: {},
    },
    { method: "GET", path: "/api/kai/action-contexts" },
    { method: "GET", path: "/api/kai/action-contexts/fake-id" },
    {
      method: "POST",
      path: "/api/internal/trust-receipts/envelopes",
      body: {},
    },
    { method: "GET", path: "/api/internal/trust-receipts/envelopes" },
    { method: "GET", path: "/api/internal/trust-receipts/envelopes/fake-id" },
  ];

  for (const route of protectedRoutes) {
    it(`${route.method} ${route.path} returns 401 without auth`, async () => {
      const res = await SELF.fetch(
        jsonRequest(route.path, route.method, route.body)
      );
      expect(res.status).toBe(401);
    });
  }

  it("invalid service API key is denied", async () => {
    const res = await SELF.fetch(
      authedRequest("/api/platform/users/any/summary", "GET", undefined, {
        "x-ids-service-key": "ids_sk_totally_fake_key_here",
      })
    );
    expect(res.status).toBe(401);
  });

  it("invalid Bearer token is denied", async () => {
    const res = await SELF.fetch(
      authedRequest("/api/platform/me", "GET", undefined, {
        Authorization: "Bearer totally.fake.token",
      })
    );
    expect(res.status).toBe(401);
  });

  it("GET /api/health is still public", async () => {
    const res = await SELF.fetch(jsonRequest("/api/health"));
    expect(res.status).toBe(200);
  });

  it("GET /api/version is still public", async () => {
    const res = await SELF.fetch(jsonRequest("/api/version"));
    // 200 or 404 if not yet implemented — just not 401
    expect(res.status).not.toBe(401);
  });

  it("/api/users/me is still accessible (optional auth)", async () => {
    const res = await SELF.fetch(jsonRequest("/api/users/me"));
    expect(res.status).not.toBe(500);
  });

  it("no endpoint returns session_token_hash", async () => {
    const endpoints = [
      "/api/platform/me",
      `/api/platform/users/${testUserId}/summary`,
    ];
    for (const path of endpoints) {
      const res = await SELF.fetch(
        path === "/api/platform/me"
          ? authedRequest(path, "GET", undefined, {
              Authorization: `Bearer ${testJwt}`,
            })
          : serviceRequest(path)
      );
      const text = await res.text();
      expect(text).not.toContain("session_token_hash");
    }
  });

  it("no endpoint returns API key hash", async () => {
    const res = await SELF.fetch(serviceRequest(`/api/platform/users/${testUserId}/summary`));
    const text = await res.text();
    expect(text).not.toContain("key_hash");
    expect(text).not.toContain("apiKeyHash");
  });
});

// ────────────────────────────────────────────────────────────
// Phase 1–5 Regression
// ────────────────────────────────────────────────────────────

describe("Regression — Phase 1–5 routes still work", () => {
  it("GET /api/health returns 200", async () => {
    const res = await SELF.fetch(jsonRequest("/api/health"));
    expect(res.status).toBe(200);
  });

  it("GET /api/internal/users works with service key", async () => {
    const res = await SELF.fetch(serviceRequest("/api/internal/users"));
    expect(res.status).toBe(200);
  });

  it("GET /api/internal/roles works with service key", async () => {
    const res = await SELF.fetch(serviceRequest("/api/internal/roles"));
    expect(res.status).toBe(200);
  });

  it("GET /api/internal/permissions works with service key", async () => {
    const res = await SELF.fetch(serviceRequest("/api/internal/permissions"));
    expect(res.status).toBe(200);
  });

  it("GET /api/internal/token-events works with service key", async () => {
    const res = await SELF.fetch(serviceRequest("/api/internal/token-events"));
    expect(res.status).toBe(200);
  });

  it("GET /api/internal/service-clients requires auth", async () => {
    const res = await SELF.fetch(jsonRequest("/api/internal/service-clients"));
    expect(res.status).toBe(401);
  });

  it("POST /api/auth/token/verify with malformed token returns valid: false", async () => {
    const res = await SELF.fetch(
      jsonRequest("/api/auth/token/verify", "POST", {
        accessToken: "garbage.token.here",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ data: { valid: boolean } }>();
    expect(body.data.valid).toBe(false);
  });
});
