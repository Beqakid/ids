// ── App Statuses ─────────────────────────────────────────────

export type AppStatus =
  | "planned"
  | "active"
  | "suspended"
  | "deprecated"
  | "archived";

export const APP_STATUSES: readonly AppStatus[] = [
  "planned",
  "active",
  "suspended",
  "deprecated",
  "archived",
] as const;

// ── App Types ────────────────────────────────────────────────

export type AppType =
  | "platform"
  | "marketplace"
  | "media"
  | "ai"
  | "admin"
  | "knowledge"
  | "service";

export const APP_TYPES: readonly AppType[] = [
  "platform",
  "marketplace",
  "media",
  "ai",
  "admin",
  "knowledge",
  "service",
] as const;

// ── App Access Event Types ───────────────────────────────────

export type AppAccessEventType =
  | "app_lookup"
  | "app_access_checked"
  | "tenant_lookup"
  | "membership_lookup"
  | "membership_created"
  | "membership_updated"
  | "membership_removed";

export const APP_ACCESS_EVENT_TYPES: readonly AppAccessEventType[] = [
  "app_lookup",
  "app_access_checked",
  "tenant_lookup",
  "membership_lookup",
  "membership_created",
  "membership_updated",
  "membership_removed",
] as const;

// ── App ──────────────────────────────────────────────────────

export interface IdsApp {
  id: string;
  appId: string;
  name: string;
  appType: AppType | null;
  status: AppStatus;
  domain: string | null;
  allowedOrigins: string[];
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Row shape as stored in D1 */
export interface IdsAppRow {
  id: string;
  app_id: string;
  name: string;
  app_type: string | null;
  status: string;
  domain: string | null;
  allowed_origins: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}
