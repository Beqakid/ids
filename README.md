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

## Current Phase: Phase 4B — Twilio Phone Verification

### What IDS can answer after Phase 4B:
- **Which app** is this request coming from? Is it registered and active?
- **Which tenant** does the user belong to?
- **Does the user** have a membership inside that tenant?
- **What role key** does the user hold?
- **What permissions** does the user have (effective, with deny-overrides and risk levels)?
- **Is the phone verified?** Start and check phone verification via Twilio Verify.
- **What is the verification history?** Full audit trail of verification events and attempts.

### What Phase 4B does NOT include:
- Real login / password auth (Phase 5+)
- OAuth / SSO (Phase 5+)
- Admin UI / frontend (Phase 5+)
- Kai execution/integration (Phase 5+)
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
| 5 | Auth + SSO + OAuth | 📋 Planned |

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
