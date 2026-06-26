# TrustProof Engine — Phase 7

> Immutable, hash-verified receipt records for every significant action, event, or decision in the IDS ecosystem.

---

## Overview

The TrustProof Engine is IDS's tamper-evident audit and accountability layer. Every action that Kai, Command Center, or any IDS service executes can produce a **TrustProof receipt** — an immutable, hash-chained record that can be independently verified.

TrustProof receipts are designed to:
- Provide cryptographically verifiable proof that an action occurred.
- Be publicly verifiable via a receipt number without exposing private data.
- Be chained to prior receipts, Kai action contexts, and trust receipt envelopes.
- Support human-readable proof links (images, documents, signatures, external references).
- Serve as the foundation for Phase 8 SMS Proof Asset Hook integration.

---

## Architecture

```
Kai Action Context ──┐
                     ├──→ TrustProof Receipt (draft)
Trust Receipt        │         │
Envelope ────────────┘         │
                               ├──→ Receipt Events (timeline)
                               ├──→ Proof Links (attachments)
                               │
                               └──→ Finalize (hash locked)
                                        │
                                        └──→ Public Verify (safe response)
```

---

## Receipt Number Format

```
TP-YYYYMMDD-APPKEY-000001
│   │         │      │
│   │         │      └── 6-digit sequence (zero-padded, per app per day)
│   │         └── Source app ID (uppercase, max 12 chars)
│   └── Date of creation (UTC)
└── TrustProof prefix
```

**Examples:**
- `TP-20240115-KAI-000001` — First Kai receipt on Jan 15, 2024
- `TP-20240115-COMMANDCENT-000042` — 42nd Command Center receipt that day
- `TP-20240115-VILINIU-000007` — 7th Viliniu receipt that day

Receipt numbers are generated atomically via the `ids_trust_receipt_counters` table using D1's RETURNING clause, guaranteeing uniqueness without race conditions.

---

## Receipt Hash

The receipt hash is a **SHA-256** digest (Worker-compatible via Web Crypto) of a **canonical JSON** of the receipt's immutable core fields:

```json
{
  "receipt_number": "TP-20240115-KAI-000001",
  "receipt_type": "kai_action",
  "source_app_id": "kai",
  "source_tenant_id": null,
  "user_id": "usr_abc123",
  "actor_user_id": "usr_abc123",
  "subject_user_id": null,
  "action_key": "viliniu.dispatch.create",
  "action_type": "dispatch",
  "risk_level": "low",
  "outcome": "allowed",
  "summary": "Dispatched delivery order #42.",
  "created_at": "2024-01-15T10:30:00.000Z",
  "finalized_at": "2024-01-15T10:30:05.000Z"
}
```

**Canonical rules:**
- Keys are sorted alphabetically.
- `null` values are included explicitly.
- Dates are ISO 8601 UTC strings.
- No trailing whitespace or newlines.

The hash is recomputed on finalization using the same fields. If the stored hash and recomputed hash differ, `verification_status` is set to `tampered`.

**Public fingerprint** (safe for display):
```
SHA256:TP-20240115-KAI-000001:<first 16 hex chars of hash>
```

---

## Receipt Lifecycle

```
                 create
[draft] ─────────────────────────────────────→ [finalized]
   │                                                │
   │ cancel (draft only)                            │ void (finalized only)
   ↓                                                ↓
[canceled]                                      [voided]
```

- **draft → finalized:** Hash is locked; `finalized_at` is set; hash is recomputed and stored.
- **draft → canceled:** Receipt is canceled; audit log written.
- **finalized → voided:** Receipt is voided; public verify returns `voided`; hash is preserved.
- **No hard deletes:** All transitions are soft.

---

## Public Verification

Anyone (no auth required) can verify a receipt by its number.

### GET /api/public/trustproof/verify/:receiptNumber

**Safe response shape (no private data):**
```json
{
  "receiptNumber": "TP-20240115-KAI-000001",
  "verificationResult": "valid",
  "receiptType": "kai_action",
  "sourceAppId": "kai",
  "riskLevel": "low",
  "status": "finalized",
  "outcome": "allowed",
  "publicSummary": "Action completed successfully.",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "finalizedAt": "2024-01-15T10:30:05.000Z",
  "fingerprint": "SHA256:TP-20240115-KAI-000001:a3f1b2c4d5e6f7a8"
}
```

**Verification results:**
| Result | Meaning |
|--------|---------|
| `valid` | Receipt exists, hash matches, status is finalized |
| `invalid` | Hash mismatch or verification failed |
| `not_found` | No receipt with this number |
| `tampered` | Receipt exists but hash does not match stored value |
| `expired` | Receipt has passed its expiry date |
| `voided` | Receipt has been voided |

Every verification attempt is logged to `ids_trust_receipt_verifications`.

---

## Creating Receipts

### From scratch (protected)
```http
POST /api/trustproof/receipts
Authorization: Bearer <token> | x-ids-service-key: <key>

{
  "receiptType": "kai_action",
  "sourceAppId": "kai",
  "actionKey": "viliniu.dispatch.create",
  "actionType": "dispatch",
  "riskLevel": "low",
  "outcome": "allowed",
  "summary": "Dispatched delivery order #42.",
  "publicSummary": "Delivery action completed."
}
```

### From a Kai action context (protected)
```http
POST /api/trustproof/receipts/from-kai-action/:actionContextId
Authorization: Bearer <token> | x-ids-service-key: <key>

{
  "summary": "Kai action completed.",
  "publicSummary": "Action approved and executed."
}
```

### From a trust receipt envelope (protected)
```http
POST /api/trustproof/receipts/from-envelope/:envelopeId
Authorization: Bearer <token> | x-ids-service-key: <key>

{
  "summary": "Receipt created from envelope.",
  "publicSummary": "Document action completed."
}
```

---

## Proof Links

Proof links attach supporting evidence to a receipt (images, documents, signatures, external references).

```http
POST /api/trustproof/receipts/:id/proof-links
Authorization: Bearer <token> | x-ids-service-key: <key>

{
  "proofType": "image",
  "provider": "internal",
  "label": "Delivery photo",
  "url": "https://example.com/proof/photo.jpg",
  "contentHash": "sha256:abc123..."
}
```

Proof links are soft-removed only (never hard deleted):
```http
POST /api/trustproof/proof-links/:id/remove
{ "reason": "Uploaded in error." }
```

---

## Security Decisions

| Decision | Rationale |
|----------|-----------|
| `private_metadata` never in any response | Defense in depth — even protected routes exclude it |
| Public routes log every verification | Rate limiting is infra-level; all attempts are audited |
| Receipt hash uses Web Crypto SHA-256 | Worker-compatible; no Node-only crypto APIs |
| Canonical JSON (sorted keys, explicit nulls) | Deterministic hash regardless of field insertion order |
| Finalized receipts cannot be canceled | Prevents retroactive denial of finalized evidence |
| Draft receipts cannot be voided | Void implies there was something to void; drafts cancel |
| Receipt number format includes date + app | Human-readable, traceable, and unique |
| Counters use atomic D1 RETURNING | No race conditions in high-concurrency scenarios |
| No hard deletes anywhere | Full audit trail preserved |
| `publicSummary` validated with `isSafePublicSummary` | Heuristic guard against raw PII in public field |

---

## DB Tables

| Table | Purpose |
|-------|---------|
| `ids_trust_receipts` | Core receipt records (immutable after finalization) |
| `ids_trust_receipt_events` | Timeline events for each receipt |
| `ids_trust_receipt_proof_links` | Supporting evidence attached to receipts |
| `ids_trust_receipt_verifications` | Every public verification attempt (audit log) |
| `ids_trust_receipt_counters` | Atomic per-app-per-day sequence counters |

---

## Phase 8 Preview: SMS Proof Asset Hook

Phase 8 will add:
- `sms_future` provider proof links backed by SMS/R2 assets.
- Webhook hooks that auto-attach SMS media assets to receipts.
- Read-only customer-facing receipt status endpoint (scoped, not full verify).

No Phase 8 code is included in this phase.

---

## Related Services

- `src/services/trustReceiptEnvelopes.ts` — Phase 6 envelope service. Envelopes can be linked to full TrustProof receipts via `createTrustReceiptFromEnvelope()` in Phase 7.
- `src/services/kaiContext.ts` — Phase 6 Kai action context service. Action contexts can be linked to receipts via `createTrustReceiptFromKaiActionContext()`.
