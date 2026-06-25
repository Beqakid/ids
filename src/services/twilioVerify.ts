/**
 * Twilio Verify provider service.
 *
 * Handles communication with Twilio Verify API for phone verification.
 * Never stores, logs, or returns OTP codes or auth tokens.
 */
import type { Env } from "../types/env";
import type { PhoneVerificationChannel } from "../types/verifications";

// ── Types ────────────────────────────────────────────────────

export interface TwilioStartResult {
  provider: "twilio";
  status: string;
  channel: string;
  normalizedPhone: string;
  providerVerificationSid: string | null;
}

export interface TwilioCheckResult {
  provider: "twilio";
  status: string;
  normalizedPhone: string;
}

export class TwilioNotConfiguredError extends Error {
  constructor() {
    super("Phone verification provider is not configured.");
    this.name = "TwilioNotConfiguredError";
  }
}

export class TwilioProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwilioProviderError";
  }
}

// ── Helpers ──────────────────────────────────────────────────

export function buildTwilioAuthHeader(
  accountSid: string,
  authToken: string
): string {
  const encoded = btoa(`${accountSid}:${authToken}`);
  return `Basic ${encoded}`;
}

/**
 * Map Twilio verification status to IDS status.
 */
export function mapTwilioStatus(
  twilioStatus: string
): string {
  switch (twilioStatus) {
    case "pending":
      return "pending";
    case "approved":
      return "approved";
    case "canceled":
      return "canceled";
    case "max_attempts_reached":
      return "max_attempts_reached";
    case "expired":
      return "expired";
    default:
      return "failed";
  }
}

/**
 * Extract only safe fields from a Twilio response.
 * Never returns raw Twilio response, auth tokens, or OTP codes.
 */
export function sanitizeTwilioResponse(response: Record<string, unknown>): {
  sid: string | null;
  status: string;
  to: string | null;
  channel: string | null;
} {
  return {
    sid: typeof response.sid === "string" ? response.sid : null,
    status: typeof response.status === "string" ? response.status : "unknown",
    to: typeof response.to === "string" ? response.to : null,
    channel: typeof response.channel === "string" ? response.channel : null,
  };
}

function validateTwilioSecrets(env: Env): void {
  if (
    !env.TWILIO_ACCOUNT_SID ||
    !env.TWILIO_AUTH_TOKEN ||
    !env.TWILIO_VERIFY_SERVICE_SID
  ) {
    throw new TwilioNotConfiguredError();
  }
}

// ── Start Phone Verification ─────────────────────────────────

export async function startPhoneVerification(
  input: {
    normalizedPhone: string;
    channel?: PhoneVerificationChannel;
  },
  env: Env
): Promise<TwilioStartResult> {
  validateTwilioSecrets(env);

  const channel = input.channel || "sms";
  const url = `https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/Verifications`;

  const body = new URLSearchParams();
  body.set("To", input.normalizedPhone);
  body.set("Channel", channel);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: buildTwilioAuthHeader(
        env.TWILIO_ACCOUNT_SID,
        env.TWILIO_AUTH_TOKEN
      ),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    // Do not expose raw Twilio error details
    const errorBody = await response.text().catch(() => "");
    console.error(
      `[IDS] Twilio Verify start failed: HTTP ${response.status}`,
      // Log only status code, not auth token or full body in production
      errorBody.substring(0, 200)
    );
    throw new TwilioProviderError(
      "Phone verification could not be started."
    );
  }

  const rawJson = (await response.json()) as Record<string, unknown>;
  const safe = sanitizeTwilioResponse(rawJson);

  return {
    provider: "twilio",
    status: mapTwilioStatus(safe.status),
    channel: safe.channel || channel,
    normalizedPhone: safe.to || input.normalizedPhone,
    providerVerificationSid: safe.sid,
  };
}

// ── Check Phone Verification ─────────────────────────────────

export async function checkPhoneVerification(
  input: {
    normalizedPhone: string;
    code: string;
  },
  env: Env
): Promise<TwilioCheckResult> {
  validateTwilioSecrets(env);

  const url = `https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`;

  const body = new URLSearchParams();
  body.set("To", input.normalizedPhone);
  body.set("Code", input.code);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: buildTwilioAuthHeader(
        env.TWILIO_ACCOUNT_SID,
        env.TWILIO_AUTH_TOKEN
      ),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    console.error(
      `[IDS] Twilio Verify check failed: HTTP ${response.status}`,
      errorBody.substring(0, 200)
    );
    throw new TwilioProviderError(
      "Phone verification could not be completed."
    );
  }

  const rawJson = (await response.json()) as Record<string, unknown>;
  const safe = sanitizeTwilioResponse(rawJson);

  return {
    provider: "twilio",
    status: mapTwilioStatus(safe.status),
    normalizedPhone: safe.to || input.normalizedPhone,
  };
}