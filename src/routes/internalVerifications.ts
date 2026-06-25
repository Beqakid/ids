/**
 * Internal verification routes — Phase 4B.
 *
 * TODO: Phase 5 must protect these routes with API key / signed JWT /
 * service-to-service authorization.
 *
 * TODO: Phase 5 — add rate limiting and abuse protection.
 * TODO: Future — add MFA support.
 */
import { Hono } from "hono";
import type { HonoEnv } from "../types/env";
import { success, error } from "../lib/response";
import {
  requireString,
  optionalString,
  isValidPhoneVerificationChannel,
  isLikelyE164Phone,
  ValidationError,
} from "../lib/validation";
import { PHONE_VERIFICATION_CHANNELS } from "../types/verifications";
import {
  startPhoneVerification,
  checkPhoneVerification,
  getPhoneVerificationStatus,
  getUserVerificationAttempts,
  VerificationError,
} from "../services/verifications";
import {
  TwilioNotConfiguredError,
  TwilioProviderError,
} from "../services/twilioVerify";
import { normalizePhone } from "../services/users";
import { writeAuditLog } from "../services/audit";
import { writeAppAccessLog } from "../services/appAccessLogs";
import { getUserById } from "../services/users";
import { parseLimitOffset } from "../lib/validation";

const verifications = new Hono<HonoEnv>();

// ── POST /phone/start ────────────────────────────────────────
verifications.post("/phone/start", async (c) => {
  try {
    const body = await c.req.json();

    const userId = requireString(body.userId, "userId");
    const phone = requireString(body.phone, "phone");
    const appId = optionalString(body.appId);
    const tenantId = optionalString(body.tenantId);
    const channel = optionalString(body.channel);

    if (!isLikelyE164Phone(phone)) {
      return error(c, "INVALID_PHONE", "A valid phone number is required.", 400);
    }

    if (channel && !isValidPhoneVerificationChannel(channel)) {
      return error(
        c,
        "INVALID_CHANNEL",
        `Unsupported verification channel. Allowed: ${PHONE_VERIFICATION_CHANNELS.join(", ")}`,
        400
      );
    }

    const result = await startPhoneVerification(
      {
        userId,
        phone,
        appId,
        tenantId,
        channel: (channel as any) || undefined,
      },
      c.env,
      {
        ipAddress: c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || null,
        userAgent: c.req.header("user-agent") || null,
      }
    );

    // App access log
    if (appId) {
      await writeAppAccessLog(c.env, {
        appId,
        userId,
        tenantId,
        eventType: "phone_verification_started" as any,
        allowed: true,
        metadata: { normalizedPhone: result.normalizedPhone, provider: "twilio" },
      });
    }

    return success(c, result);
  } catch (err) {
    if (err instanceof TwilioNotConfiguredError) {
      return error(c, "TWILIO_NOT_CONFIGURED", err.message, 500);
    }
    if (err instanceof TwilioProviderError) {
      return error(c, "VERIFICATION_PROVIDER_ERROR", err.message, 500);
    }
    if (err instanceof VerificationError) {
      return error(c, err.code, err.message, err.status as any);
    }
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── POST /phone/check ────────────────────────────────────────
verifications.post("/phone/check", async (c) => {
  try {
    const body = await c.req.json();

    const userId = requireString(body.userId, "userId");
    const phone = requireString(body.phone, "phone");
    const code = requireString(body.code, "code");
    const appId = optionalString(body.appId);
    const tenantId = optionalString(body.tenantId);

    if (!isLikelyE164Phone(phone)) {
      return error(c, "INVALID_PHONE", "A valid phone number is required.", 400);
    }

    if (typeof body.code !== "string" || body.code.trim().length === 0) {
      return error(
        c,
        "INVALID_VERIFICATION_CODE",
        "A valid verification code is required.",
        400
      );
    }

    const result = await checkPhoneVerification(
      { userId, phone, code, appId, tenantId },
      c.env,
      {
        ipAddress: c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || null,
        userAgent: c.req.header("user-agent") || null,
      }
    );

    // App access log
    if (appId) {
      await writeAppAccessLog(c.env, {
        appId,
        userId,
        tenantId,
        eventType: "phone_verification_checked" as any,
        allowed: result.verified,
        metadata: {
          normalizedPhone: result.normalizedPhone,
          provider: "twilio",
          status: result.status,
        },
      });
    }

    return success(c, result);
  } catch (err) {
    if (err instanceof TwilioNotConfiguredError) {
      return error(c, "TWILIO_NOT_CONFIGURED", err.message, 500);
    }
    if (err instanceof TwilioProviderError) {
      return error(c, "VERIFICATION_PROVIDER_ERROR", err.message, 500);
    }
    if (err instanceof VerificationError) {
      return error(c, err.code, err.message, err.status as any);
    }
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── GET /users/:id/phone-verifications ───────────────────────
// Mounted separately in index.ts on /api/internal/users
// But defined here for clarity, will be exported separately.

export const userPhoneVerificationRoutes = new Hono<HonoEnv>();

userPhoneVerificationRoutes.get("/:id/phone-verifications", async (c) => {
  try {
    const userId = c.req.param("id");
    const user = await getUserById(c.env, userId);
    if (!user) {
      return error(c, "USER_NOT_FOUND", "User not found.", 404);
    }

    const { limit, offset } = parseLimitOffset(
      c.req.query("limit"),
      c.req.query("offset")
    );

    const data = await getUserVerificationAttempts(c.env, userId, limit, offset);

    // Never return OTP codes, Twilio secrets, or session_token_hash
    const safeAttempts = data.attempts.map((a) => ({
      id: a.id,
      userId: a.user_id,
      phoneId: a.phone_id,
      appId: a.app_id,
      tenantId: a.tenant_id,
      normalizedPhone: a.normalized_phone,
      provider: a.provider,
      status: a.status,
      channel: a.channel,
      attemptCount: a.attempt_count,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
      expiresAt: a.expires_at,
      lastCheckedAt: a.last_checked_at,
    }));

    const safeEvents = data.events.map((e) => ({
      id: e.id,
      userId: e.user_id,
      appId: e.app_id,
      tenantId: e.tenant_id,
      verificationType: e.verification_type,
      provider: e.provider,
      target: e.target,
      normalizedTarget: e.normalized_target,
      status: e.status,
      reason: e.reason,
      createdAt: e.created_at,
      updatedAt: e.updated_at,
    }));

    // App access log
    await writeAuditLog(c.env, {
      eventType: "phone_verification_status_lookup",
      userId,
    });

    return success(c, { attempts: safeAttempts, events: safeEvents });
  } catch (err) {
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── GET /users/:id/phone-verifications/status ────────────────
userPhoneVerificationRoutes.get(
  "/:id/phone-verifications/status",
  async (c) => {
    try {
      const userId = c.req.param("id");
      const phone = c.req.query("phone");

      if (!phone) {
        return error(
          c,
          "INVALID_PHONE",
          "A valid phone number is required as a query parameter.",
          400
        );
      }

      const user = await getUserById(c.env, userId);
      if (!user) {
        return error(c, "USER_NOT_FOUND", "User not found.", 404);
      }

      const normalizedPhoneDb = normalizePhone(phone);
      const status = await getPhoneVerificationStatus(
        c.env,
        userId,
        normalizedPhoneDb
      );

      if (!status) {
        return error(
          c,
          "PHONE_NOT_FOUND",
          "No phone record found for this user.",
          404
        );
      }

      // Audit
      await writeAuditLog(c.env, {
        eventType: "phone_verification_status_lookup",
        userId,
        metadata: { normalizedPhone: normalizedPhoneDb },
      });

      // App access log if appId provided
      const appId = c.req.query("appId");
      if (appId) {
        await writeAppAccessLog(c.env, {
          appId,
          userId,
          eventType: "phone_verification_status_lookup" as any,
          allowed: true,
        });
      }

      return success(c, {
        phone,
        normalizedPhone: normalizedPhoneDb,
        verified: status.verified,
        verificationStatus: status.verificationStatus,
        lastAttemptStatus: status.lastAttemptStatus,
        lastCheckedAt: status.lastCheckedAt,
      });
    } catch (err) {
      if (err instanceof ValidationError) {
        return error(c, "VALIDATION_ERROR", err.message, 400);
      }
      throw err;
    }
  }
);

export default verifications;