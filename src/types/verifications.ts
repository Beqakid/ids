// ── Verification Types ───────────────────────────────────────

export type VerificationType =
  | "phone"
  | "email"
  | "identity"
  | "business"
  | "document"
  | "background_check";

export const VERIFICATION_TYPES: readonly VerificationType[] = [
  "phone",
  "email",
  "identity",
  "business",
  "document",
  "background_check",
] as const;

// ── Verification Providers ───────────────────────────────────

export type VerificationProvider = "twilio" | "internal" | "manual";

export const VERIFICATION_PROVIDERS: readonly VerificationProvider[] = [
  "twilio",
  "internal",
  "manual",
] as const;

// ── Verification Statuses ────────────────────────────────────

export type VerificationEventStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "failed"
  | "expired"
  | "canceled"
  | "max_attempts_reached";

export const VERIFICATION_EVENT_STATUSES: readonly VerificationEventStatus[] = [
  "pending",
  "approved",
  "rejected",
  "failed",
  "expired",
  "canceled",
  "max_attempts_reached",
] as const;

// ── Phone Verification Channels ──────────────────────────────

export type PhoneVerificationChannel = "sms" | "call" | "whatsapp";

export const PHONE_VERIFICATION_CHANNELS: readonly PhoneVerificationChannel[] = [
  "sms",
  "call",
  "whatsapp",
] as const;

// ── Input Types ──────────────────────────────────────────────

export interface PhoneVerificationStartInput {
  userId: string;
  phone: string;
  appId?: string;
  tenantId?: string;
  channel?: PhoneVerificationChannel;
}

export interface PhoneVerificationCheckInput {
  userId: string;
  phone: string;
  code: string;
  appId?: string;
  tenantId?: string;
}

// ── DB Row Types ─────────────────────────────────────────────

export interface VerificationEventRow {
  id: string;
  user_id: string;
  app_id: string | null;
  tenant_id: string | null;
  verification_type: string;
  provider: string;
  provider_reference_id: string | null;
  target: string;
  normalized_target: string;
  status: string;
  reason: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface PhoneVerificationAttemptRow {
  id: string;
  user_id: string;
  phone_id: string | null;
  app_id: string | null;
  tenant_id: string | null;
  normalized_phone: string;
  provider: string;
  provider_verification_sid: string | null;
  status: string;
  channel: string;
  attempt_count: number;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  last_checked_at: string | null;
  metadata: string | null;
}

// ── Safe Response Types ──────────────────────────────────────

export interface PhoneVerificationStartResponse {
  status: string;
  provider: string;
  channel: string;
  normalizedPhone: string;
  message: string;
}

export interface PhoneVerificationCheckResponse {
  verified: boolean;
  status: string;
  provider: string;
  normalizedPhone: string;
  message: string;
}

export interface PhoneVerificationStatusResponse {
  phone: string;
  normalizedPhone: string;
  verified: boolean;
  verificationStatus: string;
  lastAttemptStatus: string | null;
  lastCheckedAt: string | null;
}