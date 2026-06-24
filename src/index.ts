import { Hono } from "hono";
import type { HonoEnv } from "./types/env";
import { requestId } from "./middleware/requestId";
import { corsHandler } from "./middleware/cors";
import { errorHandler } from "./middleware/errorHandler";
import healthRoutes from "./routes/health";
import appsRoutes from "./routes/apps";
import usersRoutes from "./routes/users";
import internalUsersRoutes from "./routes/internalUsers";
import internalSessionsRoutes from "./routes/internalSessions";
import internalAppsRoutes from "./routes/internalApps";
import internalTenantsRoutes from "./routes/internalTenants";
import internalMembershipsRoutes from "./routes/internalMemberships";
import internalContextRoutes from "./routes/internalContext";
import internalUserMembershipsRoutes from "./routes/internalUserMemberships";
import internalTenantMembershipsRoutes from "./routes/internalTenantMemberships";
import internalAppMembershipsRoutes from "./routes/internalAppMemberships";

const app = new Hono<HonoEnv>();

// ── Global middleware ────────────────────────────────────────
app.use("*", requestId);
app.use("*", corsHandler);
app.use("*", errorHandler);

// ── API routes ───────────────────────────────────────────────
const api = new Hono<HonoEnv>();

api.route("/", healthRoutes);
api.route("/", appsRoutes);
api.route("/", usersRoutes);

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

app.route("/api", api);

// ── Root redirect ────────────────────────────────────────────
app.get("/", (c) => {
  return c.redirect("/api/health");
});

export default app;
