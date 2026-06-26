# IDS — Shared Identity Service

> The central identity, app access, role, permission, session, tenant management, and phone verification layer for the platform ecosystem.

IDS is a **standalone** Cloudflare Worker that serves as the single source of truth for user identity, app registration, tenant management, membership context, role/permission evaluation, and phone verification across all platform applications (Command Center, Kai, SMS, Carehia, Viliniu, Volau).

---

## Architecture

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Command     │  │     Kai      │  │     SMS      │
│  Center      │  │              │  │              │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       └─────────────────┼─────────────────┘
                         │
                    ┌────▼────┐
                    │   IDS   │  ← Cloudflare Worker
                    │  (D1)   │
                    └────┬────┘
                         │        ┌─────────────┐
       ┌─────────────────┼────────┤   Twilio     │
       │                 │        │   Verify     │
┌──────▼───────┐  ┌──────▼───────┐└─────────────┘
│   Carehia    │  │   Viliniu    │  ┌──────────────┐
│              │  │              │  │    Volau     │
└──────────────┘  └──────────────┘  └──────────────┘
```

---

## Current Phase: Phase 5 — JWT Token Platform & Service Auth

### What IDS can answer after Phase 5:
- **Which app** is this request coming from? Is it registered and active?
- **Which tenant** does the user belong to?
- **Does the user** have a membership inside that tenant?
- **What role key** does the user hold?
- **What permissions** does the user have (effective, with deny-overrides and risk levels)?
- **Is the phone verified?** Start and check phone verification via Twilio Verify.
- **What is the verification history?** Full audit trail of verification events and attempts.
- **Is this a valid JWT access token?** Exchange a session token for a signed JWT, verify it, revoke it.
- **Is this a registered service?** Bootstrap, manage, and authenticate machine-to-machine service clients via API keys.
- **What token events occurred?** Full audit trail of token issuance, exchange, verification, and revocation.

### What Phase 5 does NOT include:
- OAuth / SSO / Google login / external IdP (Phase 6+)
- Password authentication (Phase 6+)
- Admin UI / frontend login (Phase 6+)
- Kai execution/integration (Phase 6+)
- Marketing SMS (never — out of scope)

---

## Phase History

| Phase | Name | Status |
|-------|------|--------|
| 1 | Foundation | ✅ Complete |
| 2 | Core User Identity + Sessions | ✅ Complete |
| 3 | App Registry + Tenants + Memberships | ✅ Complete |
| 4 | Roles + Permissions | ✅ Complete |
| 4B | Twilio Phone Verification | ✅ Complete |
| 5 | JWT Token Platform + Service Auth | ✅ Complete |
| 6 | OAuth / SSO / External IdP | 📋 Planned |

---

## Tech Stack

- **Runtime:** Cloudflare Workers
- **Language:** TypeScript
- **Router:** Hono
- **Database:** Cloudflare D1 (SQLite)
- **Build/Deploy:** Wrangler
- **Tests:** Vitest with `@cloudflare/vitest-pool-workers`
- **Phone Verification:** Twilio Verify API

---

## Database Schema

### Phase 1 Tables
| Table | Purpose |
|-------|---------|
| `ids_service_metadata` | Service-level key/value config |
| `ids_apps` | Platform app registry |
| `ids_audit_logs` | Audit log for all identity events |

### Phase 2 Tables
| Table | Purpose |
|-------|---------|
| `ids_users` | Master user records |
| `ids_user_emails` | User email addresses (multiple per user) |
| `ids_user_phones` | User phone numbers (multiple per user) |
| `ids_sessions` | User sessions (hashed tokens) |
| `ids_login_events` | Login / session lifecycle events |

### Phase 3 Tables
| Table | Purpose |
|-------|---------|
| `ids_tenants` | Tenant registry (business, project, workspace, etc.) |
| `ids_memberships` | User–tenant–app memberships with role keys |
| `ids_app_access_logs` | App access and context lookup audit trail |

### Phase 4 Tables
| Table | Purpose |
|-------|---------|
| `ids_roles` | Role definitions (global, app, tenant scoped) |
| `ids_permissions` | Permission definitions with risk levels |
| `ids_role_permissions` | Role ↔ permission mappings with effects |
| `ids_user_roles` | User ↔ role assignments |
| `ids_permission_checks` | Permission evaluation audit log |

### Phase 4B Tables
| Table | Purpose |
|-------|---------|
| `ids_verification_events` | All verification events (phone, email, future types) |
| `ids_phone_verification_attempts` | Phone verification attempt log with provider details |

---

## Registered Apps

| App ID | Name | Type | Status |
|--------|------|------|--------|
| `command_center` | Command Center | admin | active |
| `kai` | Kai | ai | active |
| `sms` | Shared Media Service | media | active |
| `carehia` | Carehia | marketplace | planned |
| `viliniu` | Viliniu | marketplace | planned |
| `volau` | Volau | knowledge | planned |

---

## API Routes

### Public Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/version` | Service version + phase |
| `GET` | `/api/apps` | List registered apps |
| `GET` | `/api/apps/:appId` | Get app by app_id |
| `GET` | `/api/users/me` | Auth check (not implemented yet) |

### Internal User Routes (Phase 2)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/internal/users` | Create a user |
| `GET` | `/api/internal/users` | List users (paginated) |
| `GET` | `/api/internal/users/:id` | Get user by ID |
| `PATCH` | `/api/internal/users/:id/status` | Update user status |
| `GET` | `/api/internal/users/:id/sessions` | List user sessions |
| `POST` | `/api/internal/users/:id/sessions/revoke-all` | Revoke all sessions |

### Internal Session Routes (Phase 2)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/internal/sessions` | Create session (returns one-time token) |
| `POST` | `/api/internal/sessions/:id/revoke` | Revoke a session |

### Internal App Routes (Phase 3)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/internal/apps` | Create an app |
| `PATCH` | `/api/internal/apps/:appId` | Update app fields |
| `PATCH` | `/api/internal/apps/:appId/status` | Update app status |
| `GET` | `/api/internal/apps/:appId/memberships` | List memberships for app |
| `GET` | `/api/internal/apps/:appId/tenants/:tenantKey` | Get tenant by app + key |

### Internal Tenant Routes (Phase 3)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/internal/tenants` | Create a tenant |
| `GET` | `/api/internal/tenants` | List tenants (paginated, filterable) |
| `GET` | `/api/internal/tenants/:id` | Get tenant by ID |
| `PATCH` | `/api/internal/tenants/:id` | Update tenant fields |
| `PATCH` | `/api/internal/tenants/:id/status` | Update tenant status |
| `GET` | `/api/internal/tenants/:id/memberships` | List memberships for tenant |

### Internal Membership Routes (Phase 3)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/internal/memberships` | Create a membership |
| `PATCH` | `/api/internal/memberships/:id/status` | Update membership status |
| `POST` | `/api/internal/memberships/:id/remove` | Remove membership (soft delete) |
| `GET` | `/api/internal/users/:id/memberships` | List memberships for user |

### Internal Context Routes (Phase 3)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/internal/context?userId=...&appId=...&tenantId=...` | Full user–app–tenant context |

### Internal Role/Permission Routes (Phase 4)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/internal/roles` | List roles (filterable by app/scope/status) |
| `POST` | `/api/internal/roles` | Create a role |
| `GET` | `/api/internal/roles/:id` | Get role by ID |
| `PATCH` | `/api/internal/roles/:id` | Update a role |
| `GET` | `/api/internal/permissions` | List permissions (filterable) |
| `POST` | `/api/internal/permissions` | Create a permission |
| `GET` | `/api/internal/permissions/:id` | Get permission by ID |
| `PATCH` | `/api/internal/permissions/:id` | Update a permission |
| `POST` | `/api/internal/roles/:id/permissions` | Assign permission to role |
| `DELETE` | `/api/internal/roles/:id/permissions/:permissionId` | Remove permission from role |
| `GET` | `/api/internal/roles/:id/permissions` | List permissions for a role |
| `POST` | `/api/internal/users/:id/roles` | Assign role to user |
| `DELETE` | `/api/internal/users/:id/roles/:roleId` | Remove role from user |
| `GET` | `/api/internal/users/:id/roles` | List roles for a user |
| `GET` | `/api/internal/users/:id/effective-permissions` | Get effective permissions |
| `POST` | `/api/internal/users/:id/check-permission` | Check a specific permission |

### Internal Verification Routes (Phase 4B)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/internal/verifications/phone/start` | Start phone verification via Twilio |
| `POST` | `/api/internal/verifications/phone/check` | Check verification code |
| `GET` | `/api/internal/users/:id/phone-verifications` | List verification attempts + events |
| `GET` | `/api/internal/users/:id/phone-verifications/status?phone=...` | Get phone verification status |

### Phase 5 — Auth + Token Routes (`/api/auth`)

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/auth/token/exchange` | Exchange session token for a signed JWT access token |
| `POST` | `/api/auth/token/verify` | Verify a JWT access token (returns claims) |
| `POST` | `/api/auth/token/revoke` | Revoke a JWT access token |
| `GET` | `/api/auth/context` | Get token context (user, app, tenant, roles, permissions) |

### Phase 5 — Service Client Routes (`/api/internal/service-clients`)

> **Protected by service API key** (except `/bootstrap` which uses the bootstrap key).

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/internal/service-clients/bootstrap` | Bootstrap a service client (idempotent; bootstrap key only) |
| `POST` | `/api/internal/service-clients` | Create service client |
| `GET` | `/api/internal/service-clients` | List service clients |
| `GET` | `/api/internal/service-clients/:id` | Get service client |
| `PATCH` | `/api/internal/service-clients/:id/status` | Update service client status |
| `POST` | `/api/internal/service-clients/:id/api-keys` | Create API key for service client |
| `GET` | `/api/internal/service-clients/:id/api-keys` | List API keys (no secrets returned) |
| `POST` | `/api/internal/service-clients/api-keys/:keyId/revoke` | Revoke an API key |

### Phase 5 — Token Event Routes (`/api/internal/token-events`)

> **Protected by service API key.**

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/internal/token-events` | List token events (audit trail) |

---

## Authentication

Phase 5 introduces three authentication methods for IDS:

| Method | Header | Used By |
|--------|--------|---------|
| JWT Bearer token | `Authorization: Bearer <token>` | End-user authenticated requests |
| Service API key | `x-ids-service-key: <key>` | Machine-to-machine service clients |
| Bootstrap key | `x-ids-bootstrap-key: <key>` | One-time service client setup only |

### Public routes (no auth required)
- `GET /api/health`
- `GET /api/apps`
- `POST /api/auth/token/exchange`
- `POST /api/auth/token/verify`
- `POST /api/auth/token/revoke`
- `GET /api/auth/context`
- `GET /api/users/me` _(optional auth — returns enriched context if token present)_

### Bootstrap route (bootstrap key only)
- `POST /api/internal/service-clients/bootstrap`

### All other `/api/internal/*` routes (service API key required)

---

## Security Decisions

| Decision | Rationale |
|----------|-----------|
| Session tokens hashed with SHA-256 | Worker-compatible, no external deps |
| Raw session token returned only at creation | One-time retrieval prevents leakage |
| `session_token_hash` never exposed in responses | Explicit field mapping |
| Duplicate email prevention via normalized lookup | Case-insensitive uniqueness |
| Auto-revoke sessions on user suspend/block/delete | Immediate access termination |
| Soft-delete for memberships | Audit trail preserved |
| Internal routes have TODO for API key protection | Phase 5 will add service tokens |
| No passwords stored yet | Phase 5+ will introduce password auth |
| No stack traces in error responses | Production safety |
| No secrets in audit metadata | Defense in depth |
| OTP codes are never stored or logged | Twilio handles code lifecycle |
| Twilio secrets stored as Worker secrets only | Never in code, wrangler.toml, or README |
| Twilio raw responses never exposed | Only safe sanitized fields used |
| `blocked` risk permissions always deny | Cannot be overridden by role |
| JWTs signed with HS256 (`IDS_JWT_SECRET`) | Standard claims: `iss`, `sub`, `aud`, `sid`, `jti`, `iat`, `nbf`, `exp` |
| JWT access tokens expire in 15 minutes | Short-lived; revocation list for early invalidation |
| Raw service API keys returned once only at creation | Only prefix + hash stored; never re-exposed |
| Service API keys hashed with HMAC-SHA256 + pepper | Prevents brute-force from DB reads |
| Bootstrap endpoint is idempotent | Repeated calls issue new API keys, never 409 |
| All `/api/internal/*` routes require service auth | Except the bootstrap route (bootstrap key) |
| `/api/users/me` accepts optional Bearer auth | Unauthenticated requests return `{ authenticated: false }` |
| Token events logged for all auth operations | Full audit trail: exchange, verify, revoke, bootstrap |
| Revoked JWTs tracked in `ids_revoked_tokens` | Checked on every verify request |

---

## Validation Rules

| Field | Rule |
|-------|------|
| `appId` | Lowercase snake_case (`[a-z][a-z0-9_]*`) |
| `tenantKey` | Lowercase, letters/digits/hyphens (`[a-z][a-z0-9-]*`) |
| `roleKey` | Lowercase snake_case (`[a-z][a-z0-9_]*`) |
| `permissionKey` | Lowercase dot notation with at least one dot |
| `phone` | E.164-style format (`+` prefix, 7–15 digits) |
| `channel` | `sms`, `call`, or `whatsapp` |
| `metadata` | Valid JSON object or null |
| `limit` | Default 25, max 100 |
| `allowedOrigins` | Must be valid `http://` or `https://` URLs |

---

## Environment & Secrets

### wrangler.toml `[vars]` (committed, non-sensitive)
| Variable | Description |
|----------|-------------|
| `ENVIRONMENT` | `development` or `production` |
| `SERVICE_VERSION` | Semantic version string |
| `ALLOWED_ORIGINS` | Comma-separated allowed CORS origins |

### Worker Secrets (Cloudflare dashboard only, never committed)
| Secret | Description |
|--------|-------------|
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_VERIFY_SERVICE_SID` | Twilio Verify service SID |
| `IDS_JWT_SECRET` | HS256 signing secret for JWT access tokens (32+ chars) |
| `IDS_BOOTSTRAP_API_KEY` | One-time key for bootstrapping service clients |
| `IDS_API_KEY_PEPPER` | Optional HMAC pepper for service API key hashing |

> **Setting Phase 5 secrets:**
> ```bash
> npx wrangler secret put IDS_JWT_SECRET
> npx wrangler secret put IDS_BOOTSTRAP_API_KEY
> npx wrangler secret put IDS_API_KEY_PEPPER   # optional
> ```

---

## Development

```bash
# Install dependencies
npm install

# Run locally (create .dev.vars with Twilio test secrets for local dev)
npx wrangler dev

# Run tests (Twilio is mocked — no real credentials needed)
npx vitest run

# Type check
npx tsc --noEmit

# Deploy
npx wrangler deploy
```

---

## Migrations

```bash
# Apply all migrations
npx wrangler d1 migrations apply ids-db

# List migrations
npx wrangler d1 migrations list ids-db
```

| Migration | Description |
|-----------|-------------|
| `0001_initial_ids_foundation.sql` | Service metadata, app registry, audit logs |
| `0002_core_identity_sessions.sql` | Users, emails, phones, sessions, login events |
| `0003_app_registry_tenants_memberships.sql` | Tenants, memberships, app access logs, app upgrades |
| `0004_roles_permissions.sql` | Roles, permissions, role-permissions, user-roles, permission checks |
| `0004b_twilio_phone_verification.sql` | Verification events, phone verification attempts |
| `0005_token_route_protection.sql` | Service clients, API keys, token events, revoked tokens |
| `0006_command_center_kai_context.sql` | Platform context requests, Kai action contexts, trust receipt envelopes |

---

## Phase 6 — Command Center + Kai Integration Prep

> Phase 6 is IDS-side only. No changes to Command Center, Kai, Carehia, Viliniu, Volau, or SMS.

### New Tables (Migration 0006)

| Table | Purpose |
|-------|---------|
| `ids_platform_context_requests` | Audit log of every platform context lookup |
| `ids_kai_action_contexts` | Kai action context records (prepare → evaluate → receipt) |
| `ids_trust_receipt_envelopes` | Draft trust receipt envelopes (Phase 7 adds full TrustProof) |

### New Routes

#### Platform Context (`/api/platform`)
All routes require service auth (service API key or Bearer JWT).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/platform/me` | Bearer JWT only | Authenticated user's safe platform summary |
| `GET` | `/api/platform/users/:id/summary` | Service/JWT | User summary (identity, trust signals, memberships) |
| `GET` | `/api/platform/users/:id/apps` | Service/JWT | Apps user has active memberships in |
| `GET` | `/api/platform/users/:id/tenants` | Service/JWT | Tenants user belongs to (optionally filtered by `?appId=`) |
| `GET` | `/api/platform/context` | Service/JWT | Combined context package (user + app + tenant) |

#### Kai Context (`/api/kai`)
All routes require service auth.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/kai/action-contexts/prepare` | Service/JWT | Prepare a Kai action context; evaluates trust+risk |
| `GET` | `/api/kai/action-contexts/:id` | Service/JWT | Get action context by ID |
| `GET` | `/api/kai/action-contexts` | Service/JWT | List action contexts (filterable) |
| `POST` | `/api/kai/context` | Service/JWT | Combined Kai context package |

#### Trust Receipt Envelopes (`/api/internal/trust-receipts`)
All routes require service auth.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/internal/trust-receipts/envelopes` | Service/JWT | Create a draft trust receipt envelope |
| `GET` | `/api/internal/trust-receipts/envelopes/:id` | Service/JWT | Get envelope by ID |
| `GET` | `/api/internal/trust-receipts/envelopes` | Service/JWT | List envelopes (filterable) |
| `POST` | `/api/internal/trust-receipts/envelopes/:id/finalize` | Service/JWT | Finalize an envelope |
| `POST` | `/api/internal/trust-receipts/envelopes/:id/cancel` | Service/JWT | Cancel a draft envelope |

### Risk Level → Kai Action Outcome

| `riskLevel` | `outcome` | `status` |
|-------------|-----------|---------|
| `low` | `allowed` | `allowed` |
| `medium` | `confirmation_required` | `confirmation_required` |
| `high` | `admin_approval_required` | `admin_approval_required` |
| `blocked` | `denied` | `denied` |

### Phase 6 Audit Events

| Event | Trigger |
|-------|---------|
| `platform_context_requested` | Any `/api/platform/*` context fetch |
| `kai_context_requested` | `POST /api/kai/context` |
| `kai_action_context_prepared` | Successful action context prepare |
| `kai_action_context_denied` | Prepare denied (blocked user/app/risk) |
| `trust_receipt_envelope_created` | Envelope created |
| `trust_receipt_envelope_finalized` | Envelope finalized |
| `trust_receipt_envelope_canceled` | Envelope canceled |

### Integration Guides
- `docs/command-center-ids-integration.md` — Command Center service client setup and endpoint reference
- `docs/kai-ids-integration.md` — Kai service client setup, prepare→act→receipt workflow, risk mapping

### Phase 6 Security Decisions
- All new routes protected with `requireServiceAuth()` (accepts Bearer JWT or service API key); `/api/platform/me` additionally requires user JWT via `requireUserAuth()`
- No raw JWT, service key, API key hash, session token, `session_token_hash`, Twilio secrets, or OTP codes ever appear in responses or audit events
- Stack traces never exposed in API responses
- Action contexts expire after 1 hour to prevent replay
- Kai action execution is not performed by IDS — IDS issues context and receipts only
- Trust receipt envelopes are `draft`-only this phase; full TrustProof engine deferred to Phase 7
