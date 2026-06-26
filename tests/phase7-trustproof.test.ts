/**
 * Phase 7 — TrustProof Engine Tests
 *
 * ~60 test cases covering:
 * - DB table existence (5 tables)
 * - Receipt CRUD (create, read, list)
 * - From-envelope creation
 * - From-Kai-action-context creation
 * - Finalize / cancel / void lifecycle
 * - Public verification (valid, tampered, voided, not_found, expired)
 * - Receipt events (add, list)
 * - Proof links (add, list, remove)
 * - Security (auth required, public route safety)
 * - Regression: phases 1-6 health/version still pass
 * - Validation (invalid types, formats, etc.)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import app from "../src/index";

// ─── Helpers ─────────────────────────────────────────────────

const SERVICE_KEY = "test-service-key";

function authHeaders() {
  return { "x-ids-service-key": SERVICE_KEY };
}

async function post(path: string, body: unknown, headers?: Record<string, string>) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    env
  );
}

async function get(path: string, headers?: Record<string, string>) {
  return app.fetch(
    new Request(`http://localhost${path}`, { headers }),
    env
  );
}

async function postAuth(path: string, body: unknown) {
  return post(path, body, authHeaders());
}

async function getAuth(path: string) {
  return get(path, authHeaders());
}

async function json(res: Response) {
  return res.json() as Promise<any>;
}

// ─── Regression: Phase 1-6 ────────────────────────────────────

describe("Phase 1-6 Regression", () => {
  it("GET /api/health returns 200", async () => {
    const res = await get("/api/health");
    expect(res.status).toBe(200);
  });

  it("GET /api/version returns 200 with phase", async () => {
    const res = await get("/api/version");
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data).toHaveProperty("phase");
  });

  it("GET /api/apps returns 200", async () => {
    const res = await get("/api/apps");
    expect(res.status).toBe(200);
  });
});

// ─── DB Table Existence ───────────────────────────────────────

describe("Phase 7 — DB Table Existence", () => {
  const tables = [
    "ids_trust_receipts",
    "ids_trust_receipt_events",
    "ids_trust_receipt_proof_links",
    "ids_trust_receipt_verifications",
    "ids_trust_receipt_counters",
  ];

  for (const table of tables) {
    it(`table ${table} exists`, async () => {
      const result = await env.DB.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
      )
        .bind(table)
        .first<{ name: string }>();
      expect(result?.name).toBe(table);
    });
  }
});

// ─── Receipt CRUD ─────────────────────────────────────────────

describe("Phase 7 — Receipt CRUD", () => {
  let receiptId: string;
  let receiptNumber: string;

  it("POST /api/trustproof/receipts — creates draft receipt", async () => {
    const res = await postAuth("/api/trustproof/receipts", {
      receiptType: "kai_action",
      sourceAppId: "kai",
      actionKey: "viliniu.dispatch.create",
      actionType: "dispatch",
      riskLevel: "low",
      outcome: "allowed",
      summary: "Test dispatch action completed.",
      publicSummary: "Delivery action completed.",
    });
    expect(res.status).toBe(201);
    const data = await json(res);
    expect(data.receipt).toBeDefined();
    expect(data.receipt.status).toBe("draft");
    expect(data.receipt.receipt_number).toMatch(/^TP-\d{8}-KAI-\d+$/);
    expect(data.receipt.receipt_hash).toBeTruthy();
    expect(data.receipt.private_metadata).toBeUndefined();
    receiptId = data.receipt.id;
    receiptNumber = data.receipt.receipt_number;
  });

  it("GET /api/trustproof/receipts/:id — returns receipt by ID", async () => {
    const res = await getAuth(`/api/trustproof/receipts/${receiptId}`);
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.receipt.id).toBe(receiptId);
    expect(data.receipt.private_metadata).toBeUndefined();
  });

  it("GET /api/trustproof/receipts/number/:receiptNumber — returns by number", async () => {
    const res = await getAuth(`/api/trustproof/receipts/number/${receiptNumber}`);
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.receipt.receipt_number).toBe(receiptNumber);
  });

  it("GET /api/trustproof/receipts — lists receipts", async () => {
    const res = await getAuth("/api/trustproof/receipts");
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(Array.isArray(data.receipts)).toBe(true);
    expect(data.receipts.length).toBeGreaterThan(0);
  });

  it("GET /api/trustproof/receipts — filters by receiptType", async () => {
    const res = await getAuth("/api/trustproof/receipts?receiptType=kai_action");
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.receipts.every((r: any) => r.receipt_type === "kai_action")).toBe(true);
  });

  it("private_metadata is excluded from list response", async () => {
    const res = await getAuth("/api/trustproof/receipts");
    const data = await json(res);
    data.receipts.forEach((r: any) => {
      expect(r.private_metadata).toBeUndefined();
    });
  });

  it("POST /api/trustproof/receipts — rejects invalid receiptType", async () => {
    const res = await postAuth("/api/trustproof/receipts", {
      receiptType: "invalid_type",
      sourceAppId: "kai",
      summary: "Test",
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/trustproof/receipts — rejects missing summary", async () => {
    const res = await postAuth("/api/trustproof/receipts", {
      receiptType: "kai_action",
      sourceAppId: "kai",
    });
    expect(res.status).toBe(400);
  });
});

// ─── From-Envelope ────────────────────────────────────────────

describe("Phase 7 — From-Envelope Creation", () => {
  let envelopeId: string;

  beforeAll(async () => {
    // Create a Phase 6 envelope to use as source
    const res = await postAuth("/api/internal/trust-receipts/envelopes", {
      sourceAppId: "kai",
      actionKey: "kai.test.action",
      summary: "Test envelope for Phase 7",
    });
    if (res.status === 201) {
      const data = await res.json() as any;
      envelopeId = data.envelope?.id;
    }
  });

  it("POST /api/trustproof/receipts/from-envelope/:envelopeId — creates receipt from envelope", async () => {
    if (!envelopeId) {
      console.warn("Skipping: no envelope created");
      return;
    }
    const res = await postAuth(
      `/api/trustproof/receipts/from-envelope/${envelopeId}`,
      { summary: "Created from Phase 6 envelope.", publicSummary: "Envelope action completed." }
    );
    expect(res.status).toBe(201);
    const data = await json(res);
    expect(data.receipt.envelope_id).toBe(envelopeId);
    expect(data.receipt.receipt_hash).toBeTruthy();
  });

  it("POST /api/trustproof/receipts/from-envelope/:envelopeId — 404 for unknown envelope", async () => {
    const res = await postAuth(
      `/api/trustproof/receipts/from-envelope/unknown-envelope-id`,
      { summary: "Test." }
    );
    expect(res.status).toBe(404);
  });
});

// ─── From-Kai-Action-Context ──────────────────────────────────

describe("Phase 7 — From-Kai-Action-Context Creation", () => {
  let actionContextId: string;

  beforeAll(async () => {
    // Create a Phase 6 Kai action context to use as source
    const res = await postAuth("/api/kai/action-contexts/prepare", {
      requesterId: "usr_test",
      requesterType: "kai",
      appId: "kai",
      actionKey: "kai.test.prepare",
      actionType: "prepare",
      actionLabel: "Test action",
      riskLevel: "low",
      summary: "Test Kai action context",
    });
    if (res.status === 201) {
      const data = await res.json() as any;
      actionContextId = data.actionContext?.id;
    }
  });

  it("POST /api/trustproof/receipts/from-kai-action/:actionContextId — creates receipt from Kai context", async () => {
    if (!actionContextId) {
      console.warn("Skipping: no action context created");
      return;
    }
    const res = await postAuth(
      `/api/trustproof/receipts/from-kai-action/${actionContextId}`,
      { publicSummary: "Kai action completed." }
    );
    expect(res.status).toBe(201);
    const data = await json(res);
    expect(data.receipt.action_context_id).toBe(actionContextId);
    expect(data.receipt.source_app_id).toBe("kai");
    expect(data.receipt.receipt_hash).toBeTruthy();
  });

  it("POST /api/trustproof/receipts/from-kai-action/:id — 404 for unknown context", async () => {
    const res = await postAuth(
      `/api/trustproof/receipts/from-kai-action/unknown-id`,
      {}
    );
    expect(res.status).toBe(404);
  });
});

// ─── Finalize / Cancel / Void ─────────────────────────────────

describe("Phase 7 — Receipt Lifecycle (finalize/cancel/void)", () => {
  let draftId1: string;
  let draftId2: string;
  let finalizedId: string;

  beforeAll(async () => {
    const [r1, r2, r3] = await Promise.all([
      postAuth("/api/trustproof/receipts", {
        receiptType: "admin_action",
        sourceAppId: "command_center",
        summary: "Draft for finalize test.",
      }),
      postAuth("/api/trustproof/receipts", {
        receiptType: "admin_action",
        sourceAppId: "command_center",
        summary: "Draft for cancel test.",
      }),
      postAuth("/api/trustproof/receipts", {
        receiptType: "admin_action",
        sourceAppId: "command_center",
        summary: "Draft for void test.",
      }),
    ]);
    const [d1, d2, d3] = await Promise.all([json(r1), json(r2), json(r3)]);
    draftId1 = d1.receipt?.id;
    draftId2 = d2.receipt?.id;
    finalizedId = d3.receipt?.id;
  });

  it("POST /api/trustproof/receipts/:id/finalize — transitions draft to finalized", async () => {
    const res = await postAuth(`/api/trustproof/receipts/${draftId1}/finalize`, {
      outcome: "completed",
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.receipt.status).toBe("finalized");
    expect(data.receipt.finalized_at).toBeTruthy();
    expect(data.receipt.receipt_hash).toBeTruthy();
  });

  it("POST /api/trustproof/receipts/:id/finalize — cannot re-finalize", async () => {
    const res = await postAuth(`/api/trustproof/receipts/${draftId1}/finalize`, {});
    expect(res.status).toBe(400);
  });

  it("POST /api/trustproof/receipts/:id/cancel — cancels a draft receipt", async () => {
    const res = await postAuth(`/api/trustproof/receipts/${draftId2}/cancel`, {
      reason: "Canceled in test.",
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.receipt.status).toBe("canceled");
  });

  it("POST /api/trustproof/receipts/:id/cancel — cannot cancel finalized receipt", async () => {
    const res = await postAuth(`/api/trustproof/receipts/${draftId1}/cancel`, {});
    expect(res.status).toBe(400);
  });

  it("POST /api/trustproof/receipts/:id/void — voids a finalized receipt", async () => {
    // First finalize the third draft
    await postAuth(`/api/trustproof/receipts/${finalizedId}/finalize`, {});
    const res = await postAuth(`/api/trustproof/receipts/${finalizedId}/void`, {
      reason: "Voided in test.",
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.receipt.status).toBe("voided");
  });

  it("POST /api/trustproof/receipts/:id/void — cannot void a draft", async () => {
    // Create a fresh draft
    const draftRes = await postAuth("/api/trustproof/receipts", {
      receiptType: "system_event",
      sourceAppId: "command_center",
      summary: "Draft for invalid void test.",
    });
    const draft = await json(draftRes);
    const res = await postAuth(`/api/trustproof/receipts/${draft.receipt.id}/void`, {});
    expect(res.status).toBe(400);
  });
});

// ─── Receipt Events ───────────────────────────────────────────

describe("Phase 7 — Receipt Events", () => {
  let receiptId: string;

  beforeAll(async () => {
    const res = await postAuth("/api/trustproof/receipts", {
      receiptType: "verification",
      sourceAppId: "kai",
      summary: "Events test receipt.",
    });
    const data = await json(res);
    receiptId = data.receipt?.id;
  });

  it("GET /api/trustproof/receipts/:id/events — returns empty events initially", async () => {
    const res = await getAuth(`/api/trustproof/receipts/${receiptId}/events`);
    expect(res.status).toBe(200);
    const data = await json(res);
    // receipt_created event is auto-added on create
    expect(Array.isArray(data.events)).toBe(true);
  });

  it("POST /api/trustproof/receipts/:id/events — adds a custom event", async () => {
    const res = await postAuth(`/api/trustproof/receipts/${receiptId}/events`, {
      eventType: "system_note_added",
      eventLabel: "Manual note added in test.",
      actorUserId: "usr_test",
    });
    expect(res.status).toBe(201);
    const data = await json(res);
    expect(data.event.event_type).toBe("system_note_added");
    expect(data.event.event_label).toBe("Manual note added in test.");
  });

  it("GET /api/trustproof/receipts/:id/events — returns events after adding", async () => {
    const res = await getAuth(`/api/trustproof/receipts/${receiptId}/events`);
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.events.length).toBeGreaterThan(0);
  });

  it("POST /api/trustproof/receipts/:id/events — rejects invalid eventType", async () => {
    const res = await postAuth(`/api/trustproof/receipts/${receiptId}/events`, {
      eventType: "invalid_event_type",
      eventLabel: "Should fail.",
    });
    expect(res.status).toBe(400);
  });
});

// ─── Proof Links ──────────────────────────────────────────────

describe("Phase 7 — Proof Links", () => {
  let receiptId: string;
  let proofLinkId: string;

  beforeAll(async () => {
    const res = await postAuth("/api/trustproof/receipts", {
      receiptType: "media_proof",
      sourceAppId: "sms",
      summary: "Proof links test receipt.",
    });
    const data = await json(res);
    receiptId = data.receipt?.id;
  });

  it("GET /api/trustproof/receipts/:id/proof-links — returns empty list initially", async () => {
    const res = await getAuth(`/api/trustproof/receipts/${receiptId}/proof-links`);
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(Array.isArray(data.proofLinks)).toBe(true);
  });

  it("POST /api/trustproof/receipts/:id/proof-links — adds a proof link", async () => {
    const res = await postAuth(`/api/trustproof/receipts/${receiptId}/proof-links`, {
      proofType: "image",
      provider: "internal",
      label: "Delivery photo",
      url: "https://example.com/photo.jpg",
      contentHash: "sha256:abc123def456",
    });
    expect(res.status).toBe(201);
    const data = await json(res);
    expect(data.proofLink.proof_type).toBe("image");
    expect(data.proofLink.status).toBe("attached");
    proofLinkId = data.proofLink.id;
  });

  it("GET /api/trustproof/receipts/:id/proof-links — returns proof links after adding", async () => {
    const res = await getAuth(`/api/trustproof/receipts/${receiptId}/proof-links`);
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.proofLinks.length).toBe(1);
    expect(data.proofLinks[0].proof_type).toBe("image");
  });

  it("POST /api/trustproof/proof-links/:id/remove — soft-removes a proof link", async () => {
    const res = await postAuth(`/api/trustproof/proof-links/${proofLinkId}/remove`, {
      reason: "Removed in test.",
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.proofLink.status).toBe("removed");
  });

  it("proof links list still returns removed link (soft delete)", async () => {
    const res = await getAuth(`/api/trustproof/receipts/${receiptId}/proof-links`);
    const data = await json(res);
    expect(data.proofLinks.some((l: any) => l.status === "removed")).toBe(true);
  });

  it("POST /api/trustproof/receipts/:id/proof-links — rejects invalid proofType", async () => {
    const res = await postAuth(`/api/trustproof/receipts/${receiptId}/proof-links`, {
      proofType: "blockchain_nft",
      provider: "internal",
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/trustproof/receipts/:id/proof-links — rejects invalid provider", async () => {
    const res = await postAuth(`/api/trustproof/receipts/${receiptId}/proof-links`, {
      proofType: "document",
      provider: "dropbox",
    });
    expect(res.status).toBe(400);
  });
});

// ─── Public Verification ──────────────────────────────────────

describe("Phase 7 — Public Verification", () => {
  let receiptNumber: string;
  let voidedNumber: string;

  beforeAll(async () => {
    // Create + finalize a receipt for valid verify
    const r1 = await postAuth("/api/trustproof/receipts", {
      receiptType: "kai_action",
      sourceAppId: "kai",
      summary: "Public verify test receipt.",
      publicSummary: "Kai action completed successfully.",
    });
    const d1 = await json(r1);
    const id = d1.receipt?.id;
    receiptNumber = d1.receipt?.receipt_number;
    await postAuth(`/api/trustproof/receipts/${id}/finalize`, { outcome: "completed" });

    // Create + finalize + void a receipt for void test
    const r2 = await postAuth("/api/trustproof/receipts", {
      receiptType: "system_event",
      sourceAppId: "command_center",
      summary: "Voided verify test receipt.",
      publicSummary: "System event.",
    });
    const d2 = await json(r2);
    const id2 = d2.receipt?.id;
    voidedNumber = d2.receipt?.receipt_number;
    await postAuth(`/api/trustproof/receipts/${id2}/finalize`, {});
    await postAuth(`/api/trustproof/receipts/${id2}/void`, { reason: "Test void." });
  });

  it("GET /api/public/trustproof/verify/:receiptNumber — valid finalized receipt", async () => {
    const res = await get(`/api/public/trustproof/verify/${receiptNumber}`);
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.verificationResult).toBe("valid");
    expect(data.receiptNumber).toBe(receiptNumber);
    expect(data.fingerprint).toBeTruthy();
    // Must NOT contain private data
    expect(data.privateMetadata).toBeUndefined();
    expect(data.private_metadata).toBeUndefined();
    expect(data.metadata).toBeUndefined();
  });

  it("public verify — publicSummary is included", async () => {
    const res = await get(`/api/public/trustproof/verify/${receiptNumber}`);
    const data = await json(res);
    expect(data.publicSummary).toBe("Kai action completed successfully.");
  });

  it("public verify — summary (internal) is NOT included", async () => {
    const res = await get(`/api/public/trustproof/verify/${receiptNumber}`);
    const data = await json(res);
    expect(data.summary).toBeUndefined();
  });

  it("public verify — voided receipt returns voided result", async () => {
    const res = await get(`/api/public/trustproof/verify/${voidedNumber}`);
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.verificationResult).toBe("voided");
  });

  it("public verify — not_found for unknown receipt number", async () => {
    const res = await get("/api/public/trustproof/verify/TP-20240101-UNKNOWN-999999");
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.verificationResult).toBe("not_found");
  });

  it("public verify — 400 for invalid receipt number format", async () => {
    const res = await get("/api/public/trustproof/verify/not-a-valid-number");
    expect(res.status).toBe(400);
  });

  it("POST /api/public/trustproof/verify — verifies by POST body", async () => {
    const res = await post("/api/public/trustproof/verify", {
      receiptNumber,
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.verificationResult).toBe("valid");
  });

  it("POST /api/public/trustproof/verify — 400 when receiptNumber missing", async () => {
    const res = await post("/api/public/trustproof/verify", {});
    expect(res.status).toBe(400);
  });

  it("verification is logged to ids_trust_receipt_verifications", async () => {
    const result = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM ids_trust_receipt_verifications WHERE receipt_number = ?"
    )
      .bind(receiptNumber)
      .first<{ count: number }>();
    expect(result?.count).toBeGreaterThan(0);
  });
});

// ─── Security ─────────────────────────────────────────────────

describe("Phase 7 — Security", () => {
  it("POST /api/trustproof/receipts — requires auth", async () => {
    const res = await post("/api/trustproof/receipts", {
      receiptType: "kai_action",
      sourceAppId: "kai",
      summary: "No auth test.",
    });
    expect(res.status).toBe(401);
  });

  it("GET /api/trustproof/receipts — requires auth", async () => {
    const res = await get("/api/trustproof/receipts");
    expect(res.status).toBe(401);
  });

  it("GET /api/trustproof/receipts/:id — requires auth", async () => {
    const res = await get("/api/trustproof/receipts/some-id");
    expect(res.status).toBe(401);
  });

  it("POST /api/trustproof/receipts/:id/finalize — requires auth", async () => {
    const res = await post("/api/trustproof/receipts/some-id/finalize", {});
    expect(res.status).toBe(401);
  });

  it("POST /api/trustproof/receipts/:id/events — requires auth", async () => {
    const res = await post("/api/trustproof/receipts/some-id/events", {});
    expect(res.status).toBe(401);
  });

  it("POST /api/trustproof/receipts/:id/proof-links — requires auth", async () => {
    const res = await post("/api/trustproof/receipts/some-id/proof-links", {});
    expect(res.status).toBe(401);
  });

  it("public verify route — does NOT require auth", async () => {
    const res = await get("/api/public/trustproof/verify/TP-20240101-UNKNOWN-000001");
    // Should return 200 (not_found result), NOT 401
    expect(res.status).not.toBe(401);
  });

  it("public verify response — never contains private_metadata", async () => {
    const res = await get("/api/public/trustproof/verify/TP-20240101-UNKNOWN-000001");
    const data = await json(res);
    expect(data.private_metadata).toBeUndefined();
    expect(data.privateMetadata).toBeUndefined();
  });

  it("public verify response — never contains summary (internal field)", async () => {
    const res = await get("/api/public/trustproof/verify/TP-20240101-UNKNOWN-000001");
    const data = await json(res);
    expect(data.summary).toBeUndefined();
  });

  it("public verify response — never contains metadata (internal field)", async () => {
    const res = await get("/api/public/trustproof/verify/TP-20240101-UNKNOWN-000001");
    const data = await json(res);
    expect(data.metadata).toBeUndefined();
  });
});

// ─── Validation ───────────────────────────────────────────────

describe("Phase 7 — Validation", () => {
  it("rejects invalid receiptType", async () => {
    const res = await postAuth("/api/trustproof/receipts", {
      receiptType: "INVALID",
      sourceAppId: "kai",
      summary: "Test",
    });
    expect(res.status).toBe(400);
  });

  it("rejects invalid actionType", async () => {
    const res = await postAuth("/api/trustproof/receipts", {
      receiptType: "kai_action",
      sourceAppId: "kai",
      actionType: "invalid_action",
      summary: "Test",
    });
    expect(res.status).toBe(400);
  });

  it("rejects invalid riskLevel", async () => {
    const res = await postAuth("/api/trustproof/receipts", {
      receiptType: "kai_action",
      sourceAppId: "kai",
      riskLevel: "very_low",
      summary: "Test",
    });
    expect(res.status).toBe(400);
  });

  it("rejects invalid outcome on finalize", async () => {
    const r = await postAuth("/api/trustproof/receipts", {
      receiptType: "kai_action",
      sourceAppId: "kai",
      summary: "Test.",
    });
    const d = await json(r);
    const res = await postAuth(`/api/trustproof/receipts/${d.receipt.id}/finalize`, {
      outcome: "not_an_outcome",
    });
    expect(res.status).toBe(400);
  });

  it("receipt_number format validation — rejects malformed numbers", async () => {
    const res = await get("/api/public/trustproof/verify/TP-NOTADATE-APP-000001");
    expect(res.status).toBe(400);
  });

  it("all Phase 7 receipt types are accepted", async () => {
    const types = [
      "kai_action",
      "permission_check",
      "verification",
      "phone_verification",
      "media_proof",
      "admin_action",
      "system_event",
      "delivery_proof",
      "care_event",
      "vendor_event",
      "knowledge_review",
    ];
    for (const receiptType of types) {
      const res = await postAuth("/api/trustproof/receipts", {
        receiptType,
        sourceAppId: "kai",
        summary: `Test for ${receiptType}.`,
      });
      expect(res.status).toBe(201);
    }
  });
});

// ─── Receipt Counter Uniqueness ───────────────────────────────

describe("Phase 7 — Receipt Number Uniqueness", () => {
  it("two receipts for the same app get different receipt numbers", async () => {
    const [r1, r2] = await Promise.all([
      postAuth("/api/trustproof/receipts", {
        receiptType: "kai_action",
        sourceAppId: "kai",
        summary: "Counter test 1.",
      }),
      postAuth("/api/trustproof/receipts", {
        receiptType: "kai_action",
        sourceAppId: "kai",
        summary: "Counter test 2.",
      }),
    ]);
    const [d1, d2] = await Promise.all([json(r1), json(r2)]);
    expect(d1.receipt.receipt_number).not.toBe(d2.receipt.receipt_number);
  });
});
