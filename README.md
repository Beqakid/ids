# IDS — Shared Identity Service

> The central identity, app access, role, permission, session, trust, and audit service for the Beqakid platform.

IDS is a **standalone shared service** — it does **not** live inside Carehia, Viliniu, Volau, SMS, Kai, or Command Center. All platform apps will integrate with IDS as their single source of truth for identity and access.

## What IDS Answers (Future Phases)

| Question | Example |
|---|---|
| Who is this user? | Authentication, profile |
| Which app are they in? | App registry, session context |
| Which tenant/business/project/team? | Multi-tenancy |
| What role do they have? | Role management |
| What are they allowed to do? | Permissions, policies |
| How trusted are they? | Trust scores, MFA status |
| Was the action recorded? | Audit logging |

---

## Phase 1 — Foundation

Phase 1 established the **API skeleton, database foundation, and project structure**.

### What Phase 1 Includes

- ✅ Cloudflare Worker API with Hono router
- ✅ Health and version endpoints
- ✅ Static platform app registry endpoint
- ✅ Placeholder user endpoint (no auth)
- ✅ D1 database migration with foundational tables
- ✅ CORS middleware (safe, origin-aware)
- ✅ Request ID middleware (`x-request-id` on every response)
- ✅ Global error handler with consistent JSON errors
- ✅ Standardised success/error response helpers
- ✅ Full test suite (Vitest + Cloudflare Workers pool)

---

## Phase 2 — Core User Identity + Sessions

Phase 2 introduces the **real identity data model** and **internal API foundation**.

### What Phase 2 Includes

- ✅ Master user records (`ids_users`)
- ✅ User emails with normalisation (`ids_user_emails`)
- ✅ User phones with normalisation (`ids_user_phones`)
- ✅ Session management with hashed tokens (`ids_sessions`)
- ✅ Login event tracking (`ids_login_events`)
- ✅ Audit logging for all identity actions
- ✅ Internal user CRUD endpoints
- ✅ Internal session create/revoke endpoints
- ✅ Duplicate email prevention
- ✅ User status lifecycle (active → suspended → blocked → deleted)
- ✅ Automatic session revocation on user suspension/block/deletion
- ✅ Session tokens stored as SHA-256 hashes only
- ✅ Raw session token returned only once at creation
- ✅ 25 passing tests

### What Phase 2 Does NOT Include

- ❌ Real login / authentication flows
- ❌ Password authentication
- ❌ OAuth / SSO
- ❌ App integrations
- ❌ Admin UI
- ❌ Kai integration
- ❌ Role or permission logic
- ❌ Multi-tenancy

---

## Tech Stack

| Tool | Purpose |
|---|---|
| Cloudflare Workers | Runtime |
| TypeScript | Language |
| Hono | Lightweight router |
| Cloudflare D1 | SQL database |
| Wrangler | CLI / dev server |
| Vitest | Testing (with `@cloudflare/vitest-pool-workers`) |

---

## Project Structure

```
ids/
├── src/
│   ├── index.ts                        # Worker entry point
│   ├── routes/
│   │   ├── health.ts                   # GET /api/health, /api/version
│   │   ├── apps.ts                     # GET /api/apps
│   │   ├── users.ts                    # GET /api/users/me
│   │   ├── internalUsers.ts            # Internal user CRUD + session mgmt
│   │   └── internalSessions.ts         # Internal session create/revoke
│   ├── services/
│   │   ├── users.ts                    # User service (create, read, status)
│   │   ├── sessions.ts                 # Session service (create, revoke, hash)
│   │   └── audit.ts                    # Audit log writer
│   ├── middleware/
│   │   ├── requestId.ts                # x-request-id generation
│   │   ├── cors.ts                     # Origin-aware CORS
│   │   └── errorHandler.ts             # Global error handler
│   ├── lib/
│   │   ├── response.ts                 # success() / error() helpers
│   │   ├── env.ts                      # Environment helpers
│   │   ├── db.ts                       # D1 accessor
│   │   └── validation.ts               # Lightweight validation helpers
│   └── types/
│       ├── env.ts                      # Env + HonoEnv types
│       └── identity.ts                 # User, Session, Event types
├── migrations/
│   ├── 0001_initial_ids_foundation.sql  # Phase 1 tables
│   └── 0002_core_identity_sessions.sql  # Phase 2 tables
├── test/
│   ├── setup.ts                        # Test migrations + helpers
│   ├── health.test.ts
│   ├── apps.test.ts
│   ├── users.test.ts
│   ├── sessions.test.ts
│   └── audit.test.ts
├── wrangler.toml
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

---

## API Routes

### Public Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Service health check |
| `GET` | `/api/version` | Service version and phase |
| `GET` | `/api/apps` | List of platform apps |
| `GET` | `/api/users/me` | Current user (unauthenticated placeholder) |

### Internal Routes (Phase 2)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/internal/users` | Create a user |
| `GET` | `/api/internal/users` | List users (paginated) |
| `GET` | `/api/internal/users/:id` | Get user by ID |
| `PATCH` | `/api/internal/users/:id/status` | Update user status |
| `GET` | `/api/internal/users/:id/sessions` | List user's sessions |
| `POST` | `/api/internal/users/:id/sessions/revoke-all` | Revoke all active sessions |
| `POST` | `/api/internal/sessions` | Create a session |
| `POST` | `/api/internal/sessions/:id/revoke` | Revoke a session |

### Response Format

All responses follow a consistent envelope:

**Success:**
```json
{
  "ok": true,
  "data": { ... },
  "requestId": "uuid"
}
```

**Error:**
```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message."
  },
  "requestId": "uuid"
}
```

---

## Security Notes (Phase 2)

- **Session tokens** are hashed with SHA-256 before storage. The raw token is returned only once at session creation and never again.
- **No endpoint** returns `session_token_hash`, internal stack traces, or secret env values.
- **Duplicate emails** are prevented via normalised email lookups.
- **User suspension/block/deletion** automatically revokes all active sessions.
- **Internal routes** are not yet protected by API keys (TODO for Phase 3/4).

---

## Local Development

### Prerequisites

- Node.js 18+
- npm or pnpm
- Wrangler CLI (`npm install -g wrangler`)

### Install

```bash
npm install
```

### Start Dev Server

```bash
npm run dev
# or
wrangler dev
```

The API will be available at `http://localhost:8787`.

### Type Check

```bash
npm run typecheck
```

### Run Tests

```bash
npm test
```

---

## D1 Database

### Create the Database (First Time)

```bash
wrangler d1 create ids-db
```

Copy the `database_id` from the output into `wrangler.toml`.

### Run Migrations Locally

```bash
npm run db:migrate:local
```

### Run Migrations on Cloudflare

```bash
npm run db:migrate:remote
```

### Tables

| Table | Phase | Purpose |
|---|---|---|
| `ids_service_metadata` | 1 | Key/value service configuration |
| `ids_apps` | 1 | Platform app registry |
| `ids_audit_logs` | 1 | Audit trail for identity events |
| `ids_users` | 2 | Master user records |
| `ids_user_emails` | 2 | User email addresses |
| `ids_user_phones` | 2 | User phone numbers |
| `ids_sessions` | 2 | User sessions (hashed tokens) |
| `ids_login_events` | 2 | Login / session lifecycle events |

---

## Deployment

```bash
npm run deploy
# or
wrangler deploy
```

The worker deploys as `ids-api` on Cloudflare Workers.

---

## Future Phases

| Phase | Focus |
|---|---|
| ~~Phase 1~~ | ~~Foundation — API skeleton, health, apps, D1~~ ✅ |
| ~~Phase 2~~ | ~~Core identity — users, emails, phones, sessions, audit~~ ✅ |
| **Phase 3** | Authentication — login flows, password auth, email verification |
| **Phase 4** | OAuth / SSO — external identity providers |
| **Phase 5** | RBAC — roles, permissions, policies |
| **Phase 6** | Multi-tenancy — businesses, projects, teams |
| **Phase 7** | Trust & security — MFA, trust scoring, rate limiting |
| **Phase 8** | Service tokens — app-to-app auth, API keys |
| **Phase 9** | Admin UI — user management dashboard |

---

## License

Private — Beqakid Platform
