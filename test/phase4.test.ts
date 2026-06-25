import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import app from "../src/index";
import { ensureMigrations, serviceRequest } from "./setup";

beforeAll(async () => {
  await ensureMigrations();
});

// ── Roles CRUD ───────────────────────────────────────────────

describe("Roles API", () => {
  it("GET /api/internal/roles — lists seeded roles", async () => {
    const res = await app.fetch(serviceRequest("/api/internal/roles?limit=50"), env);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.total).toBeGreaterThanOrEqual(6);
    const keys = json.data.roles.map((r: any) => r.roleKey);
    expect(keys).toContain("super_admin");
    expect(keys).toContain("platform_admin");
    expect(keys).toContain("user");
  });

  it("GET /api/internal/roles — filter by scope=global", async () => {
    const res = await app.fetch(serviceRequest("/api/internal/roles?scope=global"), env);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.roles.every((r: any) => r.scope === "global")).toBe(true);
  });

  it("GET /api/internal/roles — filter by appId", async () => {
    const res = await app.fetch(serviceRequest("/api/internal/roles?appId=kai"), env);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.roles.length).toBeGreaterThanOrEqual(3);
    expect(json.data.roles.every((r: any) => r.appId === "kai")).toBe(true);
  });

  it("GET /api/internal/roles/:id — retrieves a seeded role", async () => {
    const res = await app.fetch(serviceRequest("/api/internal/roles/role_super_admin"), env);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.role.roleKey).toBe("super_admin");
    expect(json.data.role.scope).toBe("global");
    expect(json.data.role.isSystemRole).toBe(true);
  });

  it("GET /api/internal/roles/:id — 404 for unknown role", async () => {
    const res = await app.fetch(serviceRequest("/api/internal/roles/nonexistent"), env);
    expect(res.status).toBe(404);
  });

  it("POST /api/internal/roles — creates a new custom role", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/roles", "POST", {
        roleKey: "custom_tester",
        name: "Custom Tester",
        scope: "app",
        appId: "kai",
        description: "A test role.",
      }),
      env
    );
    expect(res.status).toBe(201);
    const json: any = await res.json();
    expect(json.data.role.roleKey).toBe("custom_tester");
    expect(json.data.role.scope).toBe("app");
    expect(json.data.role.appId).toBe("kai");
    expect(json.data.role.isSystemRole).toBe(false);
  });

  it("POST /api/internal/roles — rejects invalid roleKey (uppercase)", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/roles", "POST", {
        roleKey: "Invalid-Key!",
        name: "Bad Role",
        scope: "global",
      }),
      env
    );
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.error.code).toBe("INVALID_ROLE_KEY");
  });

  it("POST /api/internal/roles — rejects uppercase roleKey", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/roles", "POST", {
        roleKey: "UpperCase",
        name: "Bad",
        scope: "global",
      }),
      env
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/internal/roles — rejects invalid scope", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/roles", "POST", {
        roleKey: "another_role",
        name: "Another",
        scope: "galaxy",
      }),
      env
    );
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.error.code).toBe("INVALID_SCOPE");
  });

  it("POST /api/internal/roles — rejects duplicate roleKey in same scope", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/roles", "POST", {
        roleKey: "super_admin",
        name: "Duplicate Super",
        scope: "global",
      }),
      env
    );
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.error.code).toBe("DUPLICATE_ROLE");
  });

  it("PATCH /api/internal/roles/:id — updates a role", async () => {
    const listRes = await app.fetch(serviceRequest("/api/internal/roles?limit=50"), env);
    const listJson: any = await listRes.json();
    const custom = listJson.data.roles.find((r: any) => r.roleKey === "custom_tester");
    expect(custom).toBeTruthy();

    const res = await app.fetch(
      serviceRequest(`/api/internal/roles/${custom.id}`, "PATCH", {
        name: "Updated Custom Tester",
      }),
      env
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.role.name).toBe("Updated Custom Tester");
  });

  it("PATCH /api/internal/roles/:id/status — changes role status", async () => {
    const listRes = await app.fetch(serviceRequest("/api/internal/roles?limit=50"), env);
    const listJson: any = await listRes.json();
    const custom = listJson.data.roles.find((r: any) => r.roleKey === "custom_tester");

    const res = await app.fetch(
      serviceRequest(`/api/internal/roles/${custom.id}/status`, "PATCH", {
        status: "suspended",
      }),
      env
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.role.status).toBe("suspended");
  });

  it("PATCH /api/internal/roles/:id/status — rejects invalid status", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/roles/role_super_admin/status", "PATCH", {
        status: "borkd",
      }),
      env
    );
    expect(res.status).toBe(400);
  });
});

// ── Permissions CRUD ─────────────────────────────────────────

describe("Permissions API", () => {
  it("GET /api/internal/permissions — lists seeded permissions", async () => {
    const res = await app.fetch(serviceRequest("/api/internal/permissions?limit=100"), env);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.total).toBeGreaterThanOrEqual(20);
    const keys = json.data.permissions.map((p: any) => p.permissionKey);
    expect(keys).toContain("ids.users.read");
    expect(keys).toContain("kai.actions.prepare");
    expect(keys).toContain("sms.media.upload");
    expect(keys).toContain("viliniu.store.read");
    expect(keys).toContain("carehia.profile.read");
    expect(keys).toContain("volau.knowledge.read");
  });

  it("GET /api/internal/permissions — filter by category", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/permissions?category=actions"),
      env
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.permissions.length).toBeGreaterThanOrEqual(1);
    expect(json.data.permissions.every((p: any) => p.category === "actions")).toBe(true);
  });

  it("GET /api/internal/permissions — filter by riskLevel", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/permissions?riskLevel=high"),
      env
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.permissions.every((p: any) => p.riskLevel === "high")).toBe(true);
  });

  it("GET /api/internal/permissions/:id — by ID", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/permissions/perm_ids_users_read"),
      env
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.permission.permissionKey).toBe("ids.users.read");
  });

  it("GET /api/internal/permissions/key/:key — by key", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/permissions/key/ids.users.read"),
      env
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.permission.permissionKey).toBe("ids.users.read");
  });

  it("POST /api/internal/permissions — creates a new permission", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/permissions", "POST", {
        permissionKey: "test.custom.action",
        name: "Test Custom Action",
        category: "test",
        riskLevel: "medium",
      }),
      env
    );
    expect(res.status).toBe(201);
    const json: any = await res.json();
    expect(json.data.permission.permissionKey).toBe("test.custom.action");
    expect(json.data.permission.riskLevel).toBe("medium");
  });

  it("POST /api/internal/permissions — rejects no-dot permissionKey", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/permissions", "POST", {
        permissionKey: "nodot",
        name: "Bad Permission",
      }),
      env
    );
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.error.code).toBe("INVALID_PERMISSION_KEY");
  });

  it("POST /api/internal/permissions — rejects uppercase permissionKey", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/permissions", "POST", {
        permissionKey: "Test.Bad",
        name: "Bad Permission",
      }),
      env
    );
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.error.code).toBe("INVALID_PERMISSION_KEY");
  });

  it("POST /api/internal/permissions — rejects duplicate permissionKey", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/permissions", "POST", {
        permissionKey: "ids.users.read",
        name: "Duplicate",
      }),
      env
    );
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.error.code).toBe("DUPLICATE_PERMISSION_KEY");
  });

  it("PATCH /api/internal/permissions/:id — updates a permission", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/permissions/perm_ids_users_read", "PATCH", {
        name: "Read User Profiles (Updated)",
      }),
      env
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.permission.name).toBe("Read User Profiles (Updated)");
  });

  it("PATCH /api/internal/permissions/:id/status — changes status", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/permissions/perm_ids_users_read/status", "PATCH", {
        status: "suspended",
      }),
      env
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.permission.status).toBe("suspended");

    // Restore active
    await app.fetch(
      serviceRequest("/api/internal/permissions/perm_ids_users_read/status", "PATCH", {
        status: "active",
      }),
      env
    );
  });
});

// ── Role Permissions ─────────────────────────────────────────

describe("Role-Permissions Mapping API", () => {
  it("GET /api/internal/roles/:id/permissions — lists permissions for super_admin", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/roles/role_super_admin/permissions"),
      env
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.permissions.length).toBeGreaterThanOrEqual(20);
  });

  it("POST /api/internal/roles/:id/permissions — assigns custom permission to role", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/roles/role_user/permissions", "POST", {
        permissionKey: "test.custom.action",
      }),
      env
    );
    expect(res.status).toBe(201);
    const json: any = await res.json();
    expect(json.data.rolePermissionId).toBeTruthy();

    // Verify it's now listed
    const listRes = await app.fetch(
      serviceRequest("/api/internal/roles/role_user/permissions"),
      env
    );
    const listJson: any = await listRes.json();
    const keys = listJson.data.permissions.map((p: any) => p.permissionKey);
    expect(keys).toContain("test.custom.action");
  });

  it("POST /api/internal/roles/:id/permissions — rejects duplicate assignment", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/roles/role_user/permissions", "POST", {
        permissionKey: "test.custom.action",
      }),
      env
    );
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.error.code).toBe("DUPLICATE_ROLE_PERMISSION");
  });

  it("POST /api/internal/roles/:id/permissions/remove — removes a mapping", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/roles/role_user/permissions/remove", "POST", {
        permissionKey: "test.custom.action",
      }),
      env
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.removed).toBe(true);
  });
});

// ── Permission Checks ────────────────────────────────────────

describe("Permission Checks API", () => {
  let testUserId: string;
  let testTenantId: string;

  beforeAll(async () => {
    // Create a test user
    const userRes = await app.fetch(
      serviceRequest("/api/internal/users", "POST", {
        displayName: "Permission Test User",
        email: "permtest@example.com",
      }),
      env
    );
    const userJson: any = await userRes.json();
    testUserId = userJson.data.user.id;

    // Create a test tenant
    const tenantRes = await app.fetch(
      serviceRequest("/api/internal/tenants", "POST", {
        appId: "kai",
        tenantKey: "perm-test-org",
        name: "Perm Test Org",
        tenantType: "organization",
      }),
      env
    );
    const tenantJson: any = await tenantRes.json();
    testTenantId = tenantJson.data.tenant.id;

    // Create membership with kai_admin role
    await app.fetch(
      serviceRequest("/api/internal/memberships", "POST", {
        userId: testUserId,
        appId: "kai",
        tenantId: testTenantId,
        roleKey: "kai_admin",
      }),
      env
    );
  });

  it("POST /api/internal/permission-checks — allows kai_admin to prepare actions", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/permission-checks", "POST", {
        userId: testUserId,
        appId: "kai",
        tenantId: testTenantId,
        permissionKey: "kai.actions.prepare",
      }),
      env
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.allowed).toBe(true);
    expect(json.data.matchedRoles).toContain("kai_admin");
  });

  it("POST /api/internal/permission-checks — denies kai_admin for viliniu permission", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/permission-checks", "POST", {
        userId: testUserId,
        appId: "kai",
        tenantId: testTenantId,
        permissionKey: "viliniu.store.read",
      }),
      env
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.allowed).toBe(false);
  });

  it("POST /api/internal/permission-checks — denies non-existent user", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/permission-checks", "POST", {
        userId: "user_nonexistent",
        appId: "kai",
        permissionKey: "kai.actions.prepare",
      }),
      env
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.allowed).toBe(false);
    expect(json.data.reason).toContain("User not found");
  });

  it("POST /api/internal/permission-checks — denies non-existent permission", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/permission-checks", "POST", {
        userId: testUserId,
        appId: "kai",
        tenantId: testTenantId,
        permissionKey: "fake.permission.key",
      }),
      env
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.allowed).toBe(false);
    expect(json.data.reason).toContain("Permission not found");
  });

  it("POST /api/internal/permission-checks — blocked risk level always denies", async () => {
    // Create a blocked permission
    await app.fetch(
      serviceRequest("/api/internal/permissions", "POST", {
        permissionKey: "test.blocked.action",
        name: "Blocked Action",
        riskLevel: "blocked",
      }),
      env
    );

    // Assign to kai_admin role
    await app.fetch(
      serviceRequest("/api/internal/roles/role_kai_admin/permissions", "POST", {
        permissionKey: "test.blocked.action",
      }),
      env
    );

    const res = await app.fetch(
      serviceRequest("/api/internal/permission-checks", "POST", {
        userId: testUserId,
        appId: "kai",
        tenantId: testTenantId,
        permissionKey: "test.blocked.action",
      }),
      env
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.allowed).toBe(false);
    expect(json.data.reason).toContain("blocked");
  });

  it("GET /api/internal/permission-checks — lists check history", async () => {
    const res = await app.fetch(serviceRequest("/api/internal/permission-checks"), env);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.total).toBeGreaterThanOrEqual(1);
    expect(json.data.checks.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/internal/permission-checks — filters by userId", async () => {
    const res = await app.fetch(
      serviceRequest(`/api/internal/permission-checks?userId=${testUserId}`),
      env
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.checks.every((c: any) => c.userId === testUserId)).toBe(true);
  });
});

// ── User Effective Permissions ───────────────────────────────

describe("User Effective Permissions API", () => {
  it("GET /api/internal/users/:id/permissions — returns effective permissions", async () => {
    // Get test user
    const usersRes = await app.fetch(serviceRequest("/api/internal/users?limit=50"), env);
    const usersJson: any = await usersRes.json();
    const testUser = usersJson.data.users.find(
      (u: any) => u.displayName === "Permission Test User"
    );
    expect(testUser).toBeTruthy();

    // Get test tenant
    const tenantsRes = await app.fetch(
      serviceRequest("/api/internal/tenants?appId=kai"),
      env
    );
    const tenantsJson: any = await tenantsRes.json();
    const testTenant = tenantsJson.data.tenants.find(
      (t: any) => t.tenantKey === "perm-test-org"
    );
    expect(testTenant).toBeTruthy();

    const res = await app.fetch(
      serviceRequest(
        `/api/internal/users/${testUser.id}/permissions?appId=kai&tenantId=${testTenant.id}`
      ),
      env
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.permissions).toContain("kai.actions.prepare");
    expect(json.data.permissions).toContain("kai.actions.confirm");
    expect(json.data.permissions).toContain("kai.receipts.read");
  });

  it("GET /api/internal/users/:id/permissions — requires appId", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/users/someuser/permissions"),
      env
    );
    expect(res.status).toBe(400);
  });
});

// ── Context Enrichment ───────────────────────────────────────

describe("Context Enrichment (Phase 4)", () => {
  it("GET /api/internal/context — includes roles and effectivePermissions", async () => {
    const usersRes = await app.fetch(serviceRequest("/api/internal/users?limit=50"), env);
    const usersJson: any = await usersRes.json();
    const testUser = usersJson.data.users.find(
      (u: any) => u.displayName === "Permission Test User"
    );
    expect(testUser).toBeTruthy();

    const tenantsRes = await app.fetch(
      serviceRequest("/api/internal/tenants?appId=kai"),
      env
    );
    const tenantsJson: any = await tenantsRes.json();
    const testTenant = tenantsJson.data.tenants.find(
      (t: any) => t.tenantKey === "perm-test-org"
    );
    expect(testTenant).toBeTruthy();

    const res = await app.fetch(
      serviceRequest(
        `/api/internal/context?userId=${testUser.id}&appId=kai&tenantId=${testTenant.id}`
      ),
      env
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.roles).toContain("kai_admin");
    expect(json.data.effectivePermissions).toContain("kai.actions.prepare");
    expect(json.data.effectivePermissions).toContain("kai.receipts.read");
  });
});

// ── Validation Constraints ───────────────────────────────────

describe("Validation Constraints", () => {
  it("roleKey rejects uppercase", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/roles", "POST", {
        roleKey: "UpperCase",
        name: "Bad",
        scope: "global",
      }),
      env
    );
    expect(res.status).toBe(400);
  });

  it("roleKey rejects dots", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/roles", "POST", {
        roleKey: "has.dots",
        name: "Bad",
        scope: "global",
      }),
      env
    );
    expect(res.status).toBe(400);
  });

  it("permissionKey rejects no dots", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/permissions", "POST", {
        permissionKey: "nodots",
        name: "Bad",
      }),
      env
    );
    expect(res.status).toBe(400);
  });

  it("permissionKey accepts valid keys", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/permissions", "POST", {
        permissionKey: "my_app.my_resource.read",
        name: "Valid Permission",
      }),
      env
    );
    expect(res.status).toBe(201);
  });

  it("scope rejects unknown values", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/roles", "POST", {
        roleKey: "scope_test",
        name: "Scope Test",
        scope: "interstellar",
      }),
      env
    );
    expect(res.status).toBe(400);
  });

  it("riskLevel rejects unknown values", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/permissions", "POST", {
        permissionKey: "risk.test.x",
        name: "Risk Test",
        riskLevel: "extreme",
      }),
      env
    );
    expect(res.status).toBe(400);
  });

  it("status rejects unknown values for roles", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/roles", "POST", {
        roleKey: "status_test",
        name: "Status Test",
        scope: "global",
        status: "blurple",
      }),
      env
    );
    expect(res.status).toBe(400);
  });

  it("status rejects unknown values for permissions", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/permissions", "POST", {
        permissionKey: "status.test.perm",
        name: "Status Test",
        status: "blurple",
      }),
      env
    );
    expect(res.status).toBe(400);
  });
});

// ── Phase 1-3 Regression ────────────────────────────────────

describe("Phase 1-3 Regression", () => {
  it("GET /api/health — still works", async () => {
    const res = await app.fetch(serviceRequest("/api/health"), env);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.ok).toBe(true);
  });

  it("GET /api/apps — still works", async () => {
    const res = await app.fetch(serviceRequest("/api/apps"), env);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThanOrEqual(6);
  });

  it("GET /api/internal/users — still works", async () => {
    const res = await app.fetch(serviceRequest("/api/internal/users"), env);
    expect(res.status).toBe(200);
  });

  it("GET /api/internal/tenants — still works", async () => {
    const res = await app.fetch(serviceRequest("/api/internal/tenants"), env);
    expect(res.status).toBe(200);
  });

  it("POST /api/internal/memberships — still works", async () => {
    // Create a test user and tenant first
    const userRes = await app.fetch(
      serviceRequest("/api/internal/users", "POST", {
        displayName: "Membership Regression User",
        email: "mem_regr@example.com",
      }),
      env
    );
    const userJson: any = await userRes.json();

    const tenantRes = await app.fetch(
      serviceRequest("/api/internal/tenants", "POST", {
        appId: "sms",
        tenantKey: "regr-org",
        name: "Regression Org",
        tenantType: "organization",
      }),
      env
    );
    const tenantJson: any = await tenantRes.json();

    const res = await app.fetch(
      serviceRequest("/api/internal/memberships", "POST", {
        userId: userJson.data.user.id,
        appId: "sms",
        tenantId: tenantJson.data.tenant.id,
        roleKey: "media_uploader",
      }),
      env
    );
    expect(res.status).toBe(201);
    const json: any = await res.json();
    expect(json.data.membership.roleKey).toBe("media_uploader");
  });

  it("POST /api/internal/sessions — still works, no token_hash exposed", async () => {
    const userRes = await app.fetch(
      serviceRequest("/api/internal/users", "POST", {
        displayName: "Session Regression Test",
        email: "session_regr@example.com",
      }),
      env
    );
    const userJson: any = await userRes.json();

    const res = await app.fetch(
      serviceRequest("/api/internal/sessions", "POST", {
        userId: userJson.data.user.id,
      }),
      env
    );
    expect(res.status).toBe(201);
    const json: any = await res.json();
    expect(json.data.session.status).toBe("active");
    expect(json.data.token).toBeTruthy();
    // session_token_hash must NOT be exposed
    expect(json.data.session.sessionTokenHash).toBeUndefined();
    expect(json.data.session.session_token_hash).toBeUndefined();
  });
});

// ── Security: No Secrets Leaked ──────────────────────────────

describe("Security", () => {
  it("error responses do not expose stack traces", async () => {
    const res = await app.fetch(
      serviceRequest("/api/internal/permission-checks", "POST", {}),
      env
    );
    const text = await res.text();
    expect(text).not.toContain("at ");
    expect(text).not.toContain(".ts:");
    expect(text).not.toContain("Error:");
  });

  it("role and permission endpoints use ok/error format", async () => {
    const res = await app.fetch(serviceRequest("/api/internal/roles/nonexistent"), env);
    const json: any = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBeTruthy();
    expect(json.error.code).toBeTruthy();
    expect(json.error.message).toBeTruthy();
  });
});
