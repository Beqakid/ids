/**
 * Verification service — IDS source of truth for phone verification.
 *
 * Delegates OTP delivery/check to Twilio but owns all verification
 * state, events, attempt logs, and audit trail.
 *
 * Security rules:
 *  - Never stores OTP codes
 *  - Never logs OTP codes
 *  - Never returns Twilio credentials
 *  - Never returns session_token_hash
 */
import type { Env } from "../types/env";
import type {
  PhoneVerificationStartInput,
  PhoneVerificationCheckInput,
  PhoneVerificationChannel,
  VerificationEventRow,
  PhoneVerificationAttemptRow,
} from "../types/verifications";
import { getDB } from "../lib/db";
import { normalizePhone } from "./users";
import { normalizePhoneE164 } from "../lib/validation";
import { writeAuditLog } from "./audit";
import {
  startPhoneVerification as twilioStart,
  checkPhoneVerification as twilioCheck,
} from "./twilioVerify";

// ── Request Context ──────────────────────────────────────────

export interface RequestContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

// ── Start Phone Verification ─────────────────────────────────

export async function startPhoneVerification(
  input: PhoneVerificationStartInput,
  env: Env,
  requestContext: RequestContext = {}
): Promise<{
  status: string;
  provider: string;
  channel: string;
  normalizedPhone: string;
  message: string;
}> {
  const db = getDB(env);
  const now = new Date().toISOString();

  // Validate user exists and is active or pending_verification
  const user = await db
    .prepare("SELECT id, status, primary_phone FROM ids_users WHERE id = ?")
    .bind(input.userId)
    .first<{ id: string; status: string; primary_phone: string | null }>();

  if (!user) {
    throw new VerificationError("USER_NOT_FOUND", "User not found.", 404);
  }

  if (user.status !== "active" && user.status !== "pending_verification") {
    throw new VerificationError(
      "USER_NOT_ELIGIBLE",
      "User is not eligible for phone verification.",
      403
    );
  }

  // Normalize phone
  const normalizedPhoneDb = normalizePhone(input.phone);
  const normalizedPhoneE164 = normalizePhoneE164(input.phone);
  const channel: PhoneVerificationChannel = input.channel || "sms";

  // Ensure phone record exists for this user
  const existingPhone = await db
    .prepare(
      "SELECT id FROM ids_user_phones WHERE user_id = ? AND normalized_phone = ?"
    )
    .bind(input.userId, normalizedPhoneDb)
    .first<{ id: string }>();

  let phoneId: string;
  if (!existingPhone) {
    phoneId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO ids_user_phones
           (id, user_id, phone, normalized_phone, verified, is_primary,
            verification_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, 0, 'unverified', ?, ?)`
      )
      .bind(phoneId, input.userId, input.phone, normalizedPhoneDb, now, now)
      .run();
  } else {
    phoneId = existingPhone.id;
  }

  // Call Twilio Verify
  const twilioResult = await twilioStart(
    { normalizedPhone: normalizedPhoneE164, channel },
    env
  );

  // Write phone verification attempt
  const attemptId = crypto.randomUUID();
  await createPhoneVerificationAttempt({
    db,
    id: attemptId,
    userId: input.userId,
    phoneId,
    appId: input.appId,
    tenantId: input.tenantId,
    normalizedPhone: normalizedPhoneDb,
    provider: "twilio",
    providerVerificationSid: twilioResult.providerVerificationSid,
    status: "pending",
    channel,
    ipAddress: requestContext.ipAddress,
    userAgent: requestContext.userAgent,
    now,
  });

  // Write verification event
  await writeVerificationEvent({
    db,
    userId: input.userId,
    appId: input.appId,
    tenantId: input.tenantId,
    verificationType: "phone",
    provider: "twilio",
    providerReferenceId: twilioResult.providerVerificationSid,
    target: input.phone,
    normalizedTarget: normalizedPhoneDb,
    status: "pending",
    now,
  });

  // Audit log
  await writeAuditLog(env, {
    eventType: "phone_verification_started",
    userId: input.userId,
    appId: input.appId,
    tenantId: input.tenantId,
    ipAddress: requestContext.ipAddress,
    userAgent: requestContext.userAgent,
    metadata: {
      normalizedPhone: normalizedPhoneDb,
      provider: "twilio",
      channel,
    },
  });

  return {
    status: "pending",
    provider: "twilio",
    channel,
    normalizedPhone: normalizedPhoneE164,
    message: "Verification code sent.",
  };
}

// ── Check Phone Verification ─────────────────────────────────

export async function checkPhoneVerification(
  input: PhoneVerificationCheckInput,
  env: Env,
  requestContext: RequestContext = {}
): Promise<{
  verified: boolean;
  status: string;
  provider: string;
  normalizedPhone: string;
  message: string;
}> {
  const db = getDB(env);
  const now = new Date().toISOString();

  // Validate user
  const user = await db
    .prepare("SELECT id, status, primary_phone, phone_verified FROM ids_users WHERE id = ?")
    .bind(input.userId)
    .first<{
      id: string;
      status: string;
      primary_phone: string | null;
      phone_verified: number;
    }>();

  if (!user) {
    throw new VerificationError("USER_NOT_FOUND", "User not found.", 404);
  }

  const normalizedPhoneDb = normalizePhone(input.phone);
  const normalizedPhoneE164 = normalizePhoneE164(input.phone);

  // Call Twilio Verify check — code is passed directly, never stored
  const twilioResult = await twilioCheck(
    { normalizedPhone: normalizedPhoneE164, code: input.code },
    env
  );

  const mappedStatus = twilioResult.status;
  const verified = mappedStatus === "approved";

  if (verified) {
    // Mark phone as verified
    await markUserPhoneVerified(db, input.userId, normalizedPhoneDb, now);

    // Update user primary_phone if empty
    if (!user.primary_phone) {
      await db
        .prepare(
          "UPDATE ids_users SET primary_phone = ?, phone_verified = 1, updated_at = ? WHERE id = ?"
        )
        .bind(input.phone, now, input.userId)
        .run();
    } else {
      await db
        .prepare(
          "UPDATE ids_users SET phone_verified = 1, updated_at = ? WHERE id = ?"
        )
        .bind(now, input.userId)
        .run();
    }

    // Write verification event
    await writeVerificationEvent({
      db,
      userId: input.userId,
      appId: input.appId,
      tenantId: input.tenantId,
      verificationType: "phone",
      provider: "twilio",
      target: input.phone,
      normalizedTarget: normalizedPhoneDb,
      status: "approved",
      now,
    });

    // Update attempt
    await updatePhoneVerificationAttempt({
      db,
      userId: input.userId,
      normalizedPhone: normalizedPhoneDb,
      status: "approved",
      now,
    });

    // Audit
    await writeAuditLog(env, {
      eventType: "phone_verification_approved",
      userId: input.userId,
      appId: input.appId,
      tenantId: input.tenantId,
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
      metadata: {
        normalizedPhone: normalizedPhoneDb,
        provider: "twilio",
        status: "approved",
      },
    });
  } else {
    // Determine audit event type
    const auditEventType =
      mappedStatus === "expired"
        ? "phone_verification_expired"
        : mappedStatus === "max_attempts_reached"
          ? "phone_verification_max_attempts_reached"
          : "phone_verification_failed";

    // Write verification event
    await writeVerificationEvent({
      db,
      userId: input.userId,
      appId: input.appId,
      tenantId: input.tenantId,
      verificationType: "phone",
      provider: "twilio",
      target: input.phone,
      normalizedTarget: normalizedPhoneDb,
      status: mappedStatus,
      now,
    });

    // Update attempt
    await updatePhoneVerificationAttempt({
      db,
      userId: input.userId,
      normalizedPhone: normalizedPhoneDb,
      status: mappedStatus,
      now,
    });

    // Audit
    await writeAuditLog(env, {
      eventType: auditEventType,
      userId: input.userId,
      appId: input.appId,
      tenantId: input.tenantId,
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
      metadata: {
        normalizedPhone: normalizedPhoneDb,
        provider: "twilio",
        status: mappedStatus,
      },
    });
  }

  return {
    verified,
    status: mappedStatus,
    provider: "twilio",
    normalizedPhone: normalizedPhoneE164,
    message: verified
      ? "Phone verified successfully."
      : "Verification was not approved.",
  };
}

// ── Write Verification Event ─────────────────────────────────

async function writeVerificationEvent(input: {
  db: D1Database;
  userId: string;
  appId?: string | null;
  tenantId?: string | null;
  verificationType: string;
  provider: string;
  providerReferenceId?: string | null;
  target: string;
  normalizedTarget: string;
  status: string;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  now: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await input.db
    .prepare(
      `INSERT INTO ids_verification_events
         (id, user_id, app_id, tenant_id, verification_type, provider,
          provider_reference_id, target, normalized_target, status,
          reason, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.userId,
      input.appId ?? null,
      input.tenantId ?? null,
      input.verificationType,
      input.provider,
      input.providerReferenceId ?? null,
      input.target,
      input.normalizedTarget,
      input.status,
      input.reason ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.now,
      input.now
    )
    .run();
  return id;
}

// ── Phone Verification Attempt CRUD ──────────────────────────

async function createPhoneVerificationAttempt(input: {
  db: D1Database;
  id: string;
  userId: string;
  phoneId: string;
  appId?: string | null;
  tenantId?: string | null;
  normalizedPhone: string;
  provider: string;
  providerVerificationSid?: string | null;
  status: string;
  channel: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  now: string;
}): Promise<void> {
  await input.db
    .prepare(
      `INSERT INTO ids_phone_verification_attempts
         (id, user_id, phone_id, app_id, tenant_id, normalized_phone,
          provider, provider_verification_sid, status, channel,
          attempt_count, ip_address, user_agent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
    )
    .bind(
      input.id,
      input.userId,
      input.phoneId,
      input.appId ?? null,
      input.tenantId ?? null,
      input.normalizedPhone,
      input.provider,
      input.providerVerificationSid ?? null,
      input.status,
      input.channel,
      input.ipAddress ?? null,
      input.userAgent ?? null,
      input.now,
      input.now
    )
    .run();
}

async function updatePhoneVerificationAttempt(input: {
  db: D1Database;
  userId: string;
  normalizedPhone: string;
  status: string;
  now: string;
}): Promise<void> {
  await input.db
    .prepare(
      `UPDATE ids_phone_verification_attempts
         SET status = ?, last_checked_at = ?, updated_at = ?
         WHERE id = (
           SELECT id FROM ids_phone_verification_attempts
           WHERE user_id = ? AND normalized_phone = ?
           ORDER BY created_at DESC LIMIT 1
         )`
    )
    .bind(
      input.status,
      input.now,
      input.now,
      input.userId,
      input.normalizedPhone
    )
    .run();
}

// ── Query Helpers ────────────────────────────────────────────

export async function getLatestPhoneVerificationAttempt(
  env: Env,
  userId: string,
  normalizedPhone: string
): Promise<PhoneVerificationAttemptRow | null> {
  const db = getDB(env);
  return db
    .prepare(
      `SELECT * FROM ids_phone_verification_attempts
       WHERE user_id = ? AND normalized_phone = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(userId, normalizedPhone)
    .first<PhoneVerificationAttemptRow>();
}

export async function getPhoneVerificationStatus(
  env: Env,
  userId: string,
  normalizedPhone: string
): Promise<{
  verified: boolean;
  verificationStatus: string;
  lastAttemptStatus: string | null;
  lastCheckedAt: string | null;
} | null> {
  const db = getDB(env);

  const phoneRow = await db
    .prepare(
      "SELECT verified, verification_status FROM ids_user_phones WHERE user_id = ? AND normalized_phone = ?"
    )
    .bind(userId, normalizedPhone)
    .first<{ verified: number; verification_status: string }>();

  if (!phoneRow) return null;

  const latestAttempt = await getLatestPhoneVerificationAttempt(
    env,
    userId,
    normalizedPhone
  );

  return {
    verified: phoneRow.verified === 1,
    verificationStatus: phoneRow.verification_status,
    lastAttemptStatus: latestAttempt?.status ?? null,
    lastCheckedAt: latestAttempt?.last_checked_at ?? null,
  };
}

export async function getUserVerificationAttempts(
  env: Env,
  userId: string,
  limit = 25,
  offset = 0
): Promise<{
  attempts: PhoneVerificationAttemptRow[];
  events: VerificationEventRow[];
}> {
  const db = getDB(env);

  const attemptsResult = await db
    .prepare(
      `SELECT * FROM ids_phone_verification_attempts
       WHERE user_id = ?
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(userId, limit, offset)
    .all<PhoneVerificationAttemptRow>();

  const eventsResult = await db
    .prepare(
      `SELECT * FROM ids_verification_events
       WHERE user_id = ? AND verification_type = 'phone'
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(userId, limit, offset)
    .all<VerificationEventRow>();

  return {
    attempts: attemptsResult.results ?? [],
    events: eventsResult.results ?? [],
  };
}

// ── Mark Phone Verified ──────────────────────────────────────

async function markUserPhoneVerified(
  db: D1Database,
  userId: string,
  normalizedPhone: string,
  now: string
): Promise<void> {
  // Update the phone record
  await db
    .prepare(
      `UPDATE ids_user_phones
         SET verified = 1, verification_status = 'verified', updated_at = ?
         WHERE user_id = ? AND normalized_phone = ?`
    )
    .bind(now, userId, normalizedPhone)
    .run();

  // Set is_primary = 1 if user does not already have a primary phone
  const hasPrimary = await db
    .prepare(
      "SELECT id FROM ids_user_phones WHERE user_id = ? AND is_primary = 1"
    )
    .bind(userId)
    .first();

  if (!hasPrimary) {
    await db
      .prepare(
        `UPDATE ids_user_phones
           SET is_primary = 1, updated_at = ?
           WHERE user_id = ? AND normalized_phone = ?`
      )
      .bind(now, userId, normalizedPhone)
      .run();
  }
}

// ── Errors ───────────────────────────────────────────────────

export class VerificationError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number = 400) {
    super(message);
    this.name = "VerificationError";
    this.code = code;
    this.status = status;
  }
}