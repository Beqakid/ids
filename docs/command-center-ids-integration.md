# Command Center ↔ IDS Integration Guide (Phase 6)

> **Scope:** IDS-side integration prep only. Command Center does not change in Phase 6.
> Do not modify the Command Center repo. This document describes how Command Center
> will call IDS once integration is activated in a future phase.

---

## Service Client Details

| Field             | Value                      |
|-------------------|----------------------------|
| `client_id`       | `command_center`           |
| `client_type`     | `internal`                 |
| Required scopes   | `ids.platform.context.read`, `ids.kai.context.prepare`, `ids.trust_receipts.write` |

Command Center's service API key is provisioned once via the bootstrap endpoint and stored
securely in Command Center's Worker secrets (`IDS_SERVICE_API_KEY`). The raw key is never
stored in IDS — only the hash.

---

## Authentication

All Command Center → IDS requests must include the service API key header:

```
x-ids-service-key: ids_sk_command_center_...
```

Alternatively, an authorized Bearer JWT is accepted for user-scoped requests.

---

## Endpoints Available to Command Center

### 1. Platform User Summary

**`GET /api/platform/users/:id/summary`**

Returns a sanitized, safe summary of a user's IDS state: identity, verification status,
trust signals, active app memberships, and session count.

```http
GET /api/platform/users/usr_abc123/summary
x-ids-service-key: ids_sk_command_center_...
```

Response:
```json
{
  "ok": true,
  "data": {
    "user": {
      "id": "usr_abc123",
      "displayName": "John Doe",
      "status": "active",
      "emailVerified": true,
      "phoneVerified": true,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    },
    "trustSignals": {
      "emailVerified": true,
      "phoneVerified": true,
      "activeSessions": 2,
      "hasActiveMemberships": true
    },
    "apps": [
      {
        "appId": "viliniu",
        "role": "vendor_owner",
        "membershipStatus": "active",
        "joinedAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "sessionCount": 2,
    "verificationCount": 1
  }
}
```

**Security:** Never includes `session_token_hash`, API key hashes, raw tokens, Twilio
secrets, or OTP codes.

---

### 2. User App Context

**`GET /api/platform/users/:id/apps`**

Returns all apps this user has active memberships in.

```http
GET /api/platform/users/usr_abc123/apps
x-ids-service-key: ids_sk_command_center_...
```

---

### 3. User Tenant Context

**`GET /api/platform/users/:id/tenants?appId=viliniu`**

Returns all tenants this user belongs to within the specified app.

---

### 4. Platform Context Package

**`GET /api/platform/context?userId=...&appId=...&tenantId=...`**

Returns a combined context package with user summary, app-specific memberships,
tenant-specific access, and trust signals. Writes a platform context request log entry
for auditing.

---

### 5. Prepare Kai Action Context

**`POST /api/kai/action-contexts/prepare`**

Prepares an action context record for a Kai action. Returns whether the action is
allowed, requires confirmation, requires admin approval, or is denied — based on risk
level and the user's current trust state.

```json
{
  "userId": "usr_abc123",
  "appId": "viliniu",
  "tenantId": "ten_xyz789",
  "actionKey": "order.approve",
  "actionLabel": "Approve Order",
  "actionType": "write",
  "riskLevel": "medium",
  "requiresConfirmation": false,
  "requiresAdminApproval": false,
  "permissionKey": "viliniu.orders.approve",
  "metadata": {}
}
```

Risk level rules:
| Risk    | Outcome                 |
|---------|-------------------------|
| `low`   | `allowed`               |
| `medium`| `confirmation_required` |
| `high`  | `admin_approval_required`|
| `blocked`| `denied`              |

A **draft trust receipt envelope** is automatically created for every prepared action.

---

### 6. Trust Receipt Envelopes

**`POST /api/internal/trust-receipts/envelopes`**
**`GET /api/internal/trust-receipts/envelopes/:id`**
**`GET /api/internal/trust-receipts/envelopes`**
**`POST /api/internal/trust-receipts/envelopes/:id/finalize`**
**`POST /api/internal/trust-receipts/envelopes/:id/cancel`**

Command Center can create, read, finalize, and cancel trust receipt envelopes.
In Phase 6, all envelopes stay in `draft` status (full TrustProof engine ships in Phase 7).

---

## Audit Trail

Every Command Center → IDS call writes an audit event:

| Event                              | When                                   |
|------------------------------------|----------------------------------------|
| `platform_context_requested`       | `GET /api/platform/*` calls            |
| `kai_action_context_prepared`      | Successful `prepare`                   |
| `kai_action_context_denied`        | Prepare denied (blocked user/app/risk) |
| `trust_receipt_envelope_created`   | Envelope created                       |
| `trust_receipt_envelope_finalized` | Envelope finalized                     |
| `trust_receipt_envelope_canceled`  | Envelope canceled                      |

Audit events never include: raw JWT, service API key, API key hash, session token,
`session_token_hash`, Twilio secrets, or OTP codes.

---

## What Is NOT Available in Phase 6

- ❌ Kai action **execution** — IDS prepares context only; Command Center executes actions
- ❌ Real-time event webhooks
- ❌ Admin user impersonation
- ❌ OAuth or SSO flows
- ❌ SMS or media asset integration
- ❌ External app API calls from IDS

These are deferred to Phase 7+.
