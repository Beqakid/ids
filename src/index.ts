import { Hono } from "hono";
import type { HonoEnv } from "./types/env";
import { requestId } from "./middleware/requestId";
import { corsHandler } from "./middleware/cors";
import { errorHandler } from "./middleware/errorHandler";
import healthRoutes from "./routes/health";
import appsRoutes from "./routes/apps";
import usersRoutes from "./routes/users";
import authRoutes from "./routes/auth";
import internalUsersRoutes from "./routes/internalUsers";
import internalSessionsRoutes from "./routes/internalSessions";
import internalAppsRoutes from "./routes/internalApps";
import internalTenantsRoutes from "./routes/internalTenants";
import internalMembershipsRoutes from "./routes/internalMemberships";
import internalContextRoutes from "./routes/internalContext";
import internalUserMembershipsRoutes from "./routes/internalUserMemberships";
import internalTenantMembershipsRoutes from "./routes/internalTenantMemberships";
import internalAppMembershipsRoutes from "./routes/internalAppMemberships";
import internalRolesRoutes from "./routes/internalRoles";
import internalPermissionsRoutes from "./routes/internalPermissions";
import internalPermissionChecksRoutes from "./routes/internalPermissionChecks";
import internalUserPermissionsRoutes from "./routes/internalUserPermissions";
import internalVerificationsRoutes from "./routes/internalVerifications";
import { userPhoneVerificationRoutes } from "./routes/internalVerifications";
import serviceClientRoutes from "./routes/serviceClients";
import tokenEventRoutes from "./routes/tokenEvents";
import platformContextRoutes from "./routes/platformContext";
import kaiContextRoutes from "./routes/kaiContext";
import trustReceiptRoutes from "./routes/trustReceiptEnvelopes";

const app = new Hono<HonoEnv>();

// ── Global middleware ────────────────────────────────────────
app.use("*", requestId);
app.use("*", corsHandler);
app.use("*", errorHandler);

// ── API routes ───────────────────────────────────────────────
const api = new Hono<HonoEnv>();

// Public routes (no auth required)
api.route("/", healthRoutes);
api.route("/", appsRoutes);
// GET /api/users/me — uses optional auth (Phase 5)
api.route("/", usersRoutes);

// Auth routes (Phase 5) — no blanket auth; each route manages its own
api.route("/auth", authRoutes);

// ── Protected internal routes (Phase 5) ─────────────────────
// Each route group applies requireServiceAuth() via .use("*", ...) internally.
// The bootstrap route (/internal/service-clients/bootstrap) uses requireBootstrapAuth() instead.

// Internal routes (Phase 2)
api.route("/internal/users", internalUsersRoutes);
api.route("/internal/sessions", internalSessionsRoutes);

// Internal routes (Phase 3)
api.route("/internal/apps", internalAppsRoutes);
api.route("/internal/tenants", internalTenantsRoutes);
api.route("/internal/memberships", internalMembershipsRoutes);
api.route("/internal/context", internalContextRoutes);

// Phase 3: user memberships, tenant memberships, app memberships/tenant lookup
api.route("/internal/users", internalUserMembershipsRoutes);
api.route("/internal/tenants", internalTenantMembershipsRoutes);
api.route("/internal/apps", internalAppMembershipsRoutes);

// Internal routes (Phase 4)
api.route("/internal/roles", internalRolesRoutes);
api.route("/internal/permissions", internalPermissionsRoutes);
api.route("/internal/permission-checks", internalPermissionChecksRoutes);
api.route("/internal/users", internalUserPermissionsRoutes);

// Internal routes (Phase 4B)
api.route("/internal/verifications", internalVerificationsRoutes);
api.route("/internal/users", userPhoneVerificationRoutes);

// Internal routes (Phase 5)
api.route("/internal/service-clients", serviceClientRoutes);
api.route("/internal/token-events", tokenEventRoutes);

// ── Phase 6 routes ───────────────────────────────────────────
// Platform context (protected by service auth or Bearer JWT)
api.route("/platform", platformContextRoutes);

// Kai context (protected by service auth or Bearer JWT)
api.route("/kai", kaiContextRoutes);

// Trust receipt envelopes (internal, protected by service auth)
api.route("/internal/trust-receipts", trustReceiptRoutes);

app.route("/api", api);

// ── Root redirect ────────────────────────────────────────────
app.get("/", (c) => {
  return c.redirect("/api/health");
});

export default app;
