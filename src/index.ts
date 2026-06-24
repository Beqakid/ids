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

const app = new Hono<HonoEnv>();

// ── Global middleware ────────────────────────────────────────────────
app.use("*", requestId);
app.use("*", corsHandler);
app.use("*", errorHandler);

// ── API routes ───────────────────────────────────────────────────────
const api = new Hono<HonoEnv>();

api.route("/", healthRoutes);
api.route("/", appsRoutes);
api.route("/", usersRoutes);

// Internal routes (Phase 2)
api.route("/internal/users", internalUsersRoutes);
api.route("/internal/sessions", internalSessionsRoutes);

app.route("/api", api);

// ── Root redirect ────────────────────────────────────────────────────
app.get("/", (c) => {
  return c.redirect("/api/health");
});

export default app;
