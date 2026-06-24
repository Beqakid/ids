// ── User ─────────────────────────────────────────────────────

export type UserStatus =
  | "active"
  | "pending_verification"
  | "suspended"
  | "blocked"
  | "deleted";

export const USER_STATUSES: UserStatus[] = [
  "active",
  "pending_verification",
  "suspended",
  "blocked",
  "deleted",
];

export interface IdsUser {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: UserStatus;
  primaryEmail: string | null;
  primaryPhone: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

/** Row shape as stored in D1 */
export interface IdsUserRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  status: string;
  primary_email: string | null;
  primary_phone: string | null;
  email_verified: number;
  phone_verified: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

// ── Verification ─────────────────────────────────────────────

export type VerificationStatus =
  | "unverified"
  | "pending"
  | "verified"
  | "rejected";

export const VERIFICATION_STATUSES: VerificationStatus[] = [
  "unverified",
  "pending",
  "verified",
  "rejected",
];

// ── Session ──────────────────────────────────────────────────

export type SessionStatus = "active" | "expired" | "revoked";

export const SESSION_STATUSES: SessionStatus[] = [
  "active",
  "expired",
  "revoked",
];

export interface IdsSession {
  id: string;
  userId: string;
  status: SessionStatus;
  appId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
}

/** Row shape as stored in D1 */
export interface IdsSessionRow {
  id: string;
  user_id: string;
  session_token_hash: string;
  status: string;
  app_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_seen_at: string | null;
}

// ── Login Events ─────────────────────────────────────────────

export type LoginEventType =
  | "login_attempt"
  | "login_success"
  | "login_failed"
  | "logout"
  | "session_created"
  | "session_revoked"
  | "session_expired";

export const LOGIN_EVENT_TYPES: LoginEventType[] = [
  "login_attempt",
  "login_success",
  "login_failed",
  "logout",
  "session_created",
  "session_revoked",
  "session_expired",
];
