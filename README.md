# IDS — Shared Identity Service

> The central identity, app access, role, permission, session, and tenant management layer for the platform ecosystem.

IDS is a **standalone** Cloudflare Worker that serves as the single source of truth for user identity, app registration, tenant management, and membership context across all platform applications (Command Center, Kai, SMS, Carehia, Viliniu, Volau).

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
                         │
       ┌─────────────────┼─────────────────┐
       │                 │                 │
┌──────▼───────┐  ┌──────▼───────┐  ┌──────▼───────┐
│   Carehia    │  │   Viliniu    │  │    Volau     │
│              │  │              │  │              │
└──────────────┘  └──────────────┘  └──────────────┘
```

---

## Current Phase: Phase 3 — App Registry + Tenants + Memberships

### What IDS can answer after Phase 3:
- **Which app** is this request coming from? Is it registered and active?
- **Which tenant** (business, project, care team, store, organization, workspace) does the user belong to?
- **Does the user** have a membership inside that tenant?
- **What role key** does the user hold inside the tenant?
- **Is the context active and valid?** (user active + app active + tenant active + membership active)
- **Who owns** a given tenant?
- **Which users** belong to which app/tenant?

### What Phase 3 does NOT include:
- Full role-based permissions (Phase 4)
- Real login / password auth (Phase 4+)
- OAuth / SSO (Phase 5+)
- Admin UI / frontend (Phase 5+)
- External app integration (Phase 5+)
- Kai permission gate integration (Phase 5+)

---

## Phase History

| Phase | Name | Status |
|-------|------|--------|
| 1 | Foundation | ✅ Complete |
| 2 | Core User Identity + Sessions | ✅ Complete |
| 3 | App Registry + Tenants + Memberships | ✅ Complete |
| 4 | Roles + Permissions | 🔜 Next |
| 5 | Auth + SSO + OAuth | 📋 Planned |

---

## Tech Stack

- **Runtime:** Cloudflare Workers
- **Language:** TypeScript
- **Router:** Hono
- **Database:** Cloudflare D1 (SQLite)
- **Build/Deploy:** Wrangler
- **Tests:** Vitest with `@cloudflare/vitest-pool-workers`

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
| Internal routes have TODO for API key protection | Phase 4/5 will add service tokens |
| No passwords stored yet | Phase 4+ will introduce password auth |
| No stack traces in error responses | Production safety |
| No secrets in audit metadata | Defense in depth |

---

## Validation Rules

| Field | Rule |
|-------|------|
| `appId` | Lowercase snake_case (`[a-z][a-z0-9_]*`) |
| `tenantKey` | Lowercase, letters/digits/hyphens (`[a-z][a-z0-9-]*`) |
| `roleKey` | Lowercase snake_case (`[a-z][a-z0-9_]*`) |
| `metadata` | Valid JSON object or null |
| `limit` | Default 25, max 100 |
| `allowedOrigins` | Must be valid `http://` or `https://` URLs |

---

## Development

```bash
# Install dependencies
npm install

# Run locally
npx wrangler dev

# Run tests
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
