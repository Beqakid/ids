/**
 * Phase 4B — Twilio Phone Verification tests.
 *
 * All Twilio fetch calls are mocked via cloudflare:test fetchMock.
 * No real Twilio credentials needed. No OTP codes stored.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import { SELF, fetchMock } from "cloudflare:test";
import { env } from "cloudflare:test";
import { ensureMigrations, serviceRequest } from "./setup";

// ── Test Data ────────────────────────────────────────────────

let testUserId: string;
let suspendedUserId: string;
const TEST_PHONE = "+15555555555";

async function createTestUser(
  body: Record<string, unknown> = {}
): Promise<string> {
  const res = await SELF.fetch(
    serviceRequest("/api/internal/users", "POST", {
      displayName: "Verification Test User",
      email: `verif-${crypto.randomUUID()}@test.com`,
      ...body,
    })
  );
  const json = (await res.json()) as any;
  return json.data.user.id;
}

// ── Twilio Mock Helpers ──────────────────────────────────────

function mockTwilioStartPending() {
  fetchMock
    .get("https://verify.twilio.com")
    .intercept({
      path: /\/v2\/Services\/.*\/Verifications$/,
      method: "POST",
    })
    .reply(200, {
      sid: "VE_test_sid_123",
      status: "pending",
      to: TEST_PHONE,
      channel: "sms",
      valid: false,
    });
}

function mockTwilioCheckApproved(phone = TEST_PHONE) {
  fetchMock
    .get("https://verify.twilio.com")
    .intercept({
      path: /\/v2\/Services\/.*\/VerificationCheck$/,
      method: "POST",
    })
    .reply(200, {
      sid: "VE_test_sid_123",
      status: "approved",
      to: phone,
      channel: "sms",
      valid: true,
    });
}

function mockTwilioCheckFailed(status = "failed") {
  fetchMock
    .get("https://verify.twilio.com")
    .intercept({
      path: /\/v2\/Services\/.*\/VerificationCheck$/,
      method: "POST",
    })
    .reply(200, {
      sid: "VE_test_sid_123",
      status,
      to: TEST_PHONE,
      channel: "sms",
      valid: false,
    });
}

function mockTwilioStartError(statusCode = 500) {
  fetchMock
    .get("https://verify.twilio.com")
    .intercept({
      path: /\/v2\/Services\/.*\/Verifications$/,
      method: "POST",
    })
    .reply(statusCode, { message: "Provider error" });
}

function mockTwilioCheckError(statusCode = 500) {
  fetchMock
    .get("https://verify.twilio.com")
    .intercept({
      path: /\/v2\/Services\/.*\/VerificationCheck$/,
      method: "POST",
    })
    .reply(statusCode, { message: "Provider error" });
}

// Full start+check flow helper
function mockTwilioStartAndCheckApproved(phone = TEST_PHONE) {
  mockTwilioStartPending();
  mockTwilioCheckApproved(phone);
}

// ── Setup ────────────────────────────────────────────────────

beforeAll(async () => {
  await ensureMigrations();
  testUserId = await createTestUser();
  suspendedUserId = await createTestUser();
  await SELF.fetch(
    serviceRequest(`/api/internal/users/${suspendedUserId}/status`, "PATCH", {
      status: "suspended",
    })
  );
});

beforeEach(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.deactivate();
});

// ── Configuration Tests ──────────────────────────────────────

describe("Phase 4B: Configuration", () => {
  it("never returns Twilio secrets in any endpoint response", async () => {
    const endpoints = [
      `/api/internal/users/${testUserId}`,
      `/api/internal/users/${testUserId}/phone-verifications`,
      `/api/internal/users/${testUserId}/phone-verifications/status?phone=${encodeURIComponent(TEST_PHONE)}`,
      "/api/health",
    ];

    for (const path of endpoints) {
      const res = await SELF.fetch(serviceRequest(path));
      const text = await res.text();
      expect(text).not.toContain("TWILIO_ACCOUNT_SID");
      expect(text).not.toContain("TWILIO_AUTH_TOKEN");
      expect(text).not.toContain("TWILIO_VERIFY_SERVICE_SID");
      expect(text).not.toContain("session_token_hash");
    }
  });
});

// ── Start Verification Tests ─────────────────────────────────

describe("Phase 4B: Start Phone Verification", () => {
  it("starts verification for valid user + phone", async () => {
    mockTwilioStartPending();

    const res = await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId: testUserId,
        phone: TEST_PHONE,
      })
    );
    const json = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.status).toBe("pending");
    expect(json.data.provider).toBe("twilio");
    expect(json.data.channel).toBe("sms");
    expect(json.data.normalizedPhone).toBe(TEST_PHONE);
    expect(json.data.message).toBe("Verification code sent.");
    expect(json.requestId).toBeDefined();

    // Ensure auth token is NOT in the response
    const responseText = JSON.stringify(json);
    expect(responseText).not.toContain("test_auth_token");
  });

  it("rejects invalid user", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId: "nonexistent-user-id",
        phone: TEST_PHONE,
      })
    );
    const json = (await res.json()) as any;
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("USER_NOT_FOUND");
  });

  it("rejects suspended user", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId: suspendedUserId,
        phone: TEST_PHONE,
      })
    );
    const json = (await res.json()) as any;
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("USER_NOT_ELIGIBLE");
  });

  it("rejects missing phone", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId: testUserId,
      })
    );
    const json = (await res.json()) as any;
    expect(json.ok).toBe(false);
  });

  it("rejects invalid phone", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId: testUserId,
        phone: "abc",
      })
    );
    const json = (await res.json()) as any;
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("INVALID_PHONE");
  });

  it("rejects unsupported channel", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId: testUserId,
        phone: TEST_PHONE,
        channel: "pigeon",
      })
    );
    const json = (await res.json()) as any;
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("INVALID_CHANNEL");
  });

  it("creates ids_user_phones record if missing", async () => {
    const newUserId = await createTestUser();
    const newPhone = "+15559998888";

    mockTwilioStartPending();
    await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId: newUserId,
        phone: newPhone,
      })
    );

    const db = (env as any).IDS_DB;
    const phoneRow = await db
      .prepare(
        "SELECT * FROM ids_user_phones WHERE user_id = ? AND normalized_phone = ?"
      )
      .bind(newUserId, "15559998888")
      .first();
    expect(phoneRow).not.toBeNull();
    expect(phoneRow.verified).toBe(0);
    expect(phoneRow.verification_status).toBe("unverified");
  });

  it("does not mark phone verified on start", async () => {
    const newUserId = await createTestUser();

    mockTwilioStartPending();
    await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId: newUserId,
        phone: "+15551112222",
      })
    );

    const db = (env as any).IDS_DB;
    const user = await db
      .prepare("SELECT phone_verified FROM ids_users WHERE id = ?")
      .bind(newUserId)
      .first();
    expect(user.phone_verified).toBe(0);
  });

  it("writes ids_phone_verification_attempts", async () => {
    const newUserId = await createTestUser();

    mockTwilioStartPending();
    await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId: newUserId,
        phone: "+15553334444",
      })
    );

    const db = (env as any).IDS_DB;
    const attempt = await db
      .prepare(
        "SELECT * FROM ids_phone_verification_attempts WHERE user_id = ?"
      )
      .bind(newUserId)
      .first();
    expect(attempt).not.toBeNull();
    expect(attempt.status).toBe("pending");
    expect(attempt.provider).toBe("twilio");
    expect(attempt.channel).toBe("sms");
  });

  it("writes ids_verification_events", async () => {
    const newUserId = await createTestUser();

    mockTwilioStartPending();
    await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId: newUserId,
        phone: "+15554445555",
      })
    );

    const db = (env as any).IDS_DB;
    const event = await db
      .prepare(
        "SELECT * FROM ids_verification_events WHERE user_id = ?"
      )
      .bind(newUserId)
      .first();
    expect(event).not.toBeNull();
    expect(event.status).toBe("pending");
    expect(event.verification_type).toBe("phone");
    expect(event.provider).toBe("twilio");
  });

  it("writes audit log", async () => {
    const newUserId = await createTestUser();

    mockTwilioStartPending();
    await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId: newUserId,
        phone: "+15556667777",
      })
    );

    const db = (env as any).IDS_DB;
    const audit = await db
      .prepare(
        "SELECT * FROM ids_audit_logs WHERE user_id = ? AND event_type = 'phone_verification_started'"
      )
      .bind(newUserId)
      .first();
    expect(audit).not.toBeNull();
    const meta = JSON.parse(audit.metadata);
    expect(meta).not.toHaveProperty("code");
    expect(meta).not.toHaveProperty("otp");
    expect(meta.provider).toBe("twilio");
  });

  it("does not store OTP code in the database", async () => {
    const newUserId = await createTestUser();

    mockTwilioStartPending();
    await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId: newUserId,
        phone: "+15557778888",
      })
    );

    const db = (env as any).IDS_DB;
    const attempt = await db
      .prepare("SELECT * FROM ids_phone_verification_attempts WHERE user_id = ?")
      .bind(newUserId)
      .first();
    const fullRow = JSON.stringify(attempt);
    expect(fullRow).not.toContain('"code"');

    const event = await db
      .prepare("SELECT * FROM ids_verification_events WHERE user_id = ?")
      .bind(newUserId)
      .first();
    const eventStr = JSON.stringify(event);
    expect(eventStr).not.toContain('"code"');
  });

  it("handles Twilio provider error gracefully", async () => {
    mockTwilioStartError(500);

    const res = await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId: testUserId,
        phone: TEST_PHONE,
      })
    );
    const json = (await res.json()) as any;
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("VERIFICATION_PROVIDER_ERROR");
    expect(json.error.message).not.toContain("twilio.com");
    expect(json.error.message).not.toContain("ACtest");
  });
});

// ── Check Verification Tests ─────────────────────────────────

describe("Phase 4B: Check Phone Verification", () => {
  it("approved Twilio response marks phone verified", async () => {
    const checkUserId = await createTestUser();
    const checkPhone = "+15551000001";

    mockTwilioStartPending();
    await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId: checkUserId,
        phone: checkPhone,
      })
    );

    mockTwilioCheckApproved(checkPhone);
    const res = await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/check", "POST", {
        userId: checkUserId,
        phone: checkPhone,
        code: "123456",
      })
    );
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.data.verified).toBe(true);
    expect(json.data.status).toBe("approved");
    expect(json.data.message).toBe("Phone verified successfully.");
  });

  it("approved response updates ids_users.phone_verified", async () => {
    const userId = await createTestUser();
    const phone = "+15551000002";

    mockTwilioStartPending();
    await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId,
        phone,
      })
    );

    mockTwilioCheckApproved(phone);
    await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/check", "POST", {
        userId,
        phone,
        code: "123456",
      })
    );

    const db = (env as any).IDS_DB;
    const user = await db
      .prepare("SELECT phone_verified FROM ids_users WHERE id = ?")
      .bind(userId)
      .first();
    expect(user.phone_verified).toBe(1);
  });

  it("approved response sets primary phone if empty", async () => {
    const userId = await createTestUser();
    const phone = "+15551000003";

    const db = (env as any).IDS_DB;
    await db
      .prepare("UPDATE ids_users SET primary_phone = NULL WHERE id = ?")
      .bind(userId)
      .run();

    mockTwilioStartPending();
    await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId,
        phone,
      })
    );

    mockTwilioCheckApproved(phone);
    await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/check", "POST", {
        userId,
        phone,
        code: "123456",
      })
    );

    const user = await db
      .prepare("SELECT primary_phone FROM ids_users WHERE id = ?")
      .bind(userId)
      .first();
    expect(user.primary_phone).toBe(phone);
  });

  it("failed Twilio response does not mark phone verified", async () => {
    const userId = await createTestUser();
    const phone = "+15551000004";

    mockTwilioStartPending();
    await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId,
        phone,
      })
    );

    mockTwilioCheckFailed("failed");
    const res = await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/check", "POST", {
        userId,
        phone,
        code: "wrong-code",
      })
    );
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.data.verified).toBe(false);
    expect(json.data.status).toBe("failed");

    const db = (env as any).IDS_DB;
    const user = await db
      .prepare("SELECT phone_verified FROM ids_users WHERE id = ?")
      .bind(userId)
      .first();
    expect(user.phone_verified).toBe(0);
  });

  it("expired Twilio response does not mark phone verified", async () => {
    const userId = await createTestUser();
    const phone = "+15551000005";

    mockTwilioStartPending();
    await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId,
        phone,
      })
    );

    mockTwilioCheckFailed("expired");
    const res = await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/check", "POST", {
        userId,
        phone,
        code: "123456",
      })
    );
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.data.verified).toBe(false);
  });

  it("max_attempts_reached does not mark phone verified", async () => {
    const userId = await createTestUser();
    const phone = "+15551000006";

    mockTwilioStartPending();
    await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId,
        phone,
      })
    );

    mockTwilioCheckFailed("max_attempts_reached");
    const res = await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/check", "POST", {
        userId,
        phone,
        code: "123456",
      })
    );
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.data.verified).toBe(false);
    expect(json.data.status).toBe("max_attempts_reached");
  });

  it("rejects missing code", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/check", "POST", {
        userId: testUserId,
        phone: TEST_PHONE,
      })
    );
    const json = (await res.json()) as any;
    expect(json.ok).toBe(false);
  });

  it("code is not stored in database after check", async () => {
    const userId = await createTestUser();
    const phone = "+15551000007";
    const code = "987654";

    mockTwilioStartPending();
    await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId,
        phone,
      })
    );

    mockTwilioCheckApproved(phone);
    await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/check", "POST", {
        userId,
        phone,
        code,
      })
    );

    const db = (env as any).IDS_DB;
    const attempts = await db
      .prepare("SELECT * FROM ids_phone_verification_attempts WHERE user_id = ?")
      .bind(userId)
      .all();
    for (const row of attempts.results || []) {
      expect(JSON.stringify(row)).not.toContain(code);
    }

    const events = await db
      .prepare("SELECT * FROM ids_verification_events WHERE user_id = ?")
      .bind(userId)
      .all();
    for (const row of events.results || []) {
      expect(JSON.stringify(row)).not.toContain(code);
    }

    const audits = await db
      .prepare("SELECT * FROM ids_audit_logs WHERE user_id = ?")
      .bind(userId)
      .all();
    for (const row of audits.results || []) {
      expect(JSON.stringify(row)).not.toContain(code);
    }
  });

  it("writes verification attempt update on check", async () => {
    const userId = await createTestUser();
    const phone = "+15551000008";

    mockTwilioStartPending();
    await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId,
        phone,
      })
    );

    mockTwilioCheckApproved(phone);
    await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/check", "POST", {
        userId,
        phone,
        code: "123456",
      })
    );

    const db = (env as any).IDS_DB;
    const attempt = await db
      .prepare(
        "SELECT * FROM ids_phone_verification_attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT 1"
      )
      .bind(userId)
      .first();
    expect(attempt).not.toBeNull();
    expect(attempt.status).toBe("approved");
    expect(attempt.last_checked_at).not.toBeNull();
  });

  it("writes audit log for approved check", async () => {
    const userId = await createTestUser();
    const phone = "+15551000009";

    mockTwilioStartPending();
    await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId,
        phone,
      })
    );

    mockTwilioCheckApproved(phone);
    await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/check", "POST", {
        userId,
        phone,
        code: "123456",
      })
    );

    const db = (env as any).IDS_DB;
    const audit = await db
      .prepare(
        "SELECT * FROM ids_audit_logs WHERE user_id = ? AND event_type = 'phone_verification_approved'"
      )
      .bind(userId)
      .first();
    expect(audit).not.toBeNull();
  });
});

// ── Status / History Tests ───────────────────────────────────

describe("Phase 4B: Status Endpoints", () => {
  it("user phone verification status endpoint works", async () => {
    const userId = await createTestUser();
    const phone = "+15552000001";

    mockTwilioStartPending();
    await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId,
        phone,
      })
    );

    mockTwilioCheckApproved(phone);
    await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/check", "POST", {
        userId,
        phone,
        code: "123456",
      })
    );

    const res = await SELF.fetch(
      serviceRequest(
        `/api/internal/users/${userId}/phone-verifications/status?phone=${encodeURIComponent(phone)}`
      )
    );
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.data.verified).toBe(true);
    expect(json.data.verificationStatus).toBe("verified");
    expect(json.data.lastAttemptStatus).toBe("approved");
  });

  it("returns 404 for non-existent phone", async () => {
    const userId = await createTestUser();
    const res = await SELF.fetch(
      serviceRequest(
        `/api/internal/users/${userId}/phone-verifications/status?phone=${encodeURIComponent("+19999999999")}`
      )
    );
    const json = (await res.json()) as any;
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("PHONE_NOT_FOUND");
  });

  it("returns 400 when phone query param missing", async () => {
    const userId = await createTestUser();
    const res = await SELF.fetch(
      serviceRequest(`/api/internal/users/${userId}/phone-verifications/status`)
    );
    const json = (await res.json()) as any;
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("INVALID_PHONE");
  });

  it("recent attempts endpoint works", async () => {
    const userId = await createTestUser();
    const phone = "+15552000002";

    mockTwilioStartPending();
    await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId,
        phone,
      })
    );

    const res = await SELF.fetch(
      serviceRequest(`/api/internal/users/${userId}/phone-verifications`)
    );
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.data.attempts.length).toBeGreaterThan(0);
    expect(json.data.events.length).toBeGreaterThan(0);

    // Verify no OTP codes or secrets
    const text = JSON.stringify(json.data);
    expect(text).not.toContain('"code"');
    expect(text).not.toContain("session_token_hash");
    expect(text).not.toContain("TWILIO_AUTH_TOKEN");
  });

  it("no OTP codes returned in status response", async () => {
    const userId = await createTestUser();
    const phone = "+15552000003";

    mockTwilioStartPending();
    await SELF.fetch(
      serviceRequest("/api/internal/verifications/phone/start", "POST", {
        userId,
        phone,
      })
    );

    const res = await SELF.fetch(
      serviceRequest(`/api/internal/users/${userId}/phone-verifications`)
    );
    const text = await res.text();
    expect(text).not.toContain("TWILIO_AUTH_TOKEN");
    expect(text).not.toContain("session_token_hash");
  });

  it("returns 404 for non-existent user", async () => {
    const res = await SELF.fetch(
      serviceRequest(`/api/internal/users/fake-user-id/phone-verifications`)
    );
    const json = (await res.json()) as any;
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("USER_NOT_FOUND");
  });
});

// ── Regression Tests ─────────────────────────────────────────

describe("Phase 4B: Regression", () => {
  it("Phase 1 health endpoint still works", async () => {
    const res = await SELF.fetch(serviceRequest("/api/health"));
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.data.service).toBe("ids");
  });

  it("Phase 1 version endpoint still works", async () => {
    const res = await SELF.fetch(serviceRequest("/api/version"));
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.data.version).toBeDefined();
  });

  it("Phase 2 user creation still works", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/internal/users", "POST", {
        displayName: "Regression Test",
        email: `regression-${crypto.randomUUID()}@test.com`,
      })
    );
    const json = (await res.json()) as any;
    expect(res.status).toBe(201);
    expect(json.data.user.id).toBeDefined();
  });

  it("Phase 2 sessions work", async () => {
    const userId = await createTestUser();
    const res = await SELF.fetch(
      serviceRequest("/api/internal/sessions", "POST", {
        userId,
      })
    );
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.data.session.id).toBeDefined();
    const text = JSON.stringify(json);
    expect(text).not.toContain("session_token_hash");
  });

  it("Phase 4 roles list still works", async () => {
    const res = await SELF.fetch(
      serviceRequest("/api/internal/roles?appId=command_center")
    );
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
  });

  it("GET /api/users/me still returns authenticated false", async () => {
    const res = await SELF.fetch(serviceRequest("/api/users/me"));
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.data.authenticated).toBe(false);
  });
});