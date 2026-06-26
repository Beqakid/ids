# Kai ↔ IDS Integration Guide (Phase 6)

> **Scope:** IDS-side integration prep only. Kai does not change in Phase 6.
> Do not modify the Kai repo. This document describes how Kai will call IDS
> once integration is activated in a future phase.

---

## Service Client Details

| Field             | Value                      |
|-------------------|----------------------------|
| `client_id`       | `kai`                      |
| `client_type`     | `internal`                 |
| Required scopes   | `ids.platform.context.read`, `ids.kai.context.read`, `ids.kai.action.prepare`, `ids.trust_receipts.write` |

Kai's service API key is provisioned once via the bootstrap endpoint and stored securely
in Kai's Worker secrets (`IDS_SERVICE_API_KEY`). The raw key is never stored in IDS —
only the hash.

---

## Authentication

All Kai → IDS requests must include the service API key header:

```
x-ids-service-key: ids_sk_kai_...
```

---

## Core Workflow: Prepare → Evaluate → Act → Receipt

```
1. Kai receives an action request from a user
2. Kai calls IDS: POST /api/kai/action-contexts/prepare
3. IDS evaluates trust + risk → returns evaluation
4. Kai inspects evaluation.allowed / evaluation.outcome
5. If allowed: Kai executes the action (Kai-side, not IDS)
6. Kai calls IDS: POST /api/internal/trust-receipts/envelopes/:id/finalize
```

IDS **never** executes Kai actions. IDS only prepares context and issues receipts.

---

## Endpoints Available to Kai

### 1. Prepare Action Context

**`POST /api/kai/action-contexts/prepare`**

The primary Kai → IDS call. Prepares an action context record based on user trust
state, app/tenant membership, and the action's declared risk level.

```http
POST /api/kai/action-contexts/prepare
x-ids-service-key: ids_sk_kai_...
Content-Type: application/json
```

```json
{
  "userId": "usr_abc123",
  "appId": "carehia",
  "tenantId": "ten_xyz789",
  "actionKey": "patient.records.view",
  "actionLabel": "View Patient Records",
  "actionType": "read",
  "riskLevel": "low",
  "requiresConfirmation": false,
  "requiresAdminApproval": false,
  "permissionKey": "carehia.records.read",
  "metadata": {
    "requestSource": "mobile",
    "patientId": "p_123"
  }
}
```

Response — allowed:
```json
{
  "ok": true,
  "data": {
    "actionContext": {
      "id": "kac_...",
      "userId": "usr_abc123",
      "appId": "carehia",
      "tenantId": "ten_xyz789",
      "actionKey": "patient.records.view",
      "actionType": "read",
      "riskLevel": "low",
      "status": "allowed",
      "allowed": true,
      "deniedReason": null,
      "requiresConfirmation": false,
      "requiresAdminApproval": false,
      "expiresAt": "2024-01-01T01:00:00.000Z",
      "createdAt": "2024-01-01T00:00:00.000Z"
    },
    "evaluation": {
      "allowed": true,
      "outcome": "allowed",
      "deniedReason": null,
      "trustSignals": {
        "emailVerified": true,
        "phoneVerified": true,
        "activeSessions": 1,
        "hasActiveMemberships": true
      }
    },
    "receiptEnvelopeId": "tre_..."
  }
}
```

Response — denied (blocked user):
```json
{
  "ok": true,
  "data": {
    "actionContext": {
      "id": "kac_...",
      "status": "denied",
      "allowed": false,
      "deniedReason": "User is not active."
    },
    "evaluation": {
      "allowed": false,
      "outcome": "denied",
      "deniedReason": "User is not active."
    },
    "receiptEnvelopeId": "tre_..."
  }
}
```

---

### Risk Level → Outcome Mapping

| `riskLevel` | `evaluation.outcome`        | `status`                  |
|-------------|-----------------------------|---------------------------|
| `low`       | `allowed`                   | `allowed`                 |
| `medium`    | `confirmation_required`     | `confirmation_required`   |
| `high`      | `admin_approval_required`   | `admin_approval_required` |
| `blocked`   | `denied`                    | `denied`                  |

Additional denial conditions (override risk level):
- User is not `active` → `denied`
- App is not `active` → `denied`
- User has no membership in the given tenant → `denied`

---

### 2. Get Action Context by ID

**`GET /api/kai/action-contexts/:id`**

Retrieve a previously prepared action context. Kai can poll this to check status updates
(e.g., admin approval granted).

---

### 3. List Action Contexts

**`GET /api/kai/action-contexts?userId=...&appId=...&tenantId=...&status=...&riskLevel=...&limit=...&offset=...`**

List action contexts with optional filters.

---

### 4. Get Kai Context Package

**`POST /api/kai/context`**

Returns a combined context package for a user+app+tenant combination, including trust
signals, memberships, and a snapshot of recent action contexts.

---

### 5. Trust Receipt Lifecycle

After a Kai action executes:

**Finalize (success):**
```http
POST /api/internal/trust-receipts/envelopes/:id/finalize
x-ids-service-key: ids_sk_kai_...
Content-Type: application/json

{ "summary": "Patient records viewed by caregiver." }
```

**Cancel (aborted/error):**
```http
POST /api/internal/trust-receipts/envelopes/:id/cancel
x-ids-service-key: ids_sk_kai_...
Content-Type: application/json

{ "reason": "User aborted the action." }
```

---

## Action Key Format

`actionKey` must match: `^[a-z][a-z0-9._-]*$`

Examples:
- ✅ `order.approve`
- ✅ `patient.records.view`
- ✅ `file-upload`
- ❌ `Order.Approve` (uppercase)
- ❌ `order approve` (spaces)

---

## What Kai Must NOT Expect from IDS

- ❌ IDS will not execute Kai actions
- ❌ IDS will not call external app APIs
- ❌ IDS will not send real-time webhooks
- ❌ IDS will not store action results or outputs
- ❌ Full TrustProof receipt finalization with cryptographic proof links (Phase 7)

---

## Security Guarantees

- All Kai → IDS calls are logged in the IDS audit trail
- Action context records expire (default 1 hour) to prevent replay
- IDS never exposes: raw JWT, service API key, API key hash, session token,
  `session_token_hash`, Twilio secrets, or OTP codes in any response or audit event
- Stack traces never appear in responses
