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

Phase 1 establishes the **API skeleton, database foundation, and project structure**. It is intentionally minimal.

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

### What Phase 1 Does NOT Include

- ❌ Real authentication or login flows
- ❌ External app connections
- ❌ Admin UI
- ❌ Role or permission logic
- ❌ Multi-tenancy
- ❌ Session management
- ❌ Secrets or tokens

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
│   ├── index.ts                    # Worker entry point
│   ├── routes/
│   │   ├── health.ts               # GET /api/health, /api/version
│   │   ├── apps.ts                 # GET /api/apps
│   │   └── users.ts                # GET /api/users/me
│   ├── middleware/
│   │   ├── requestId.ts            # x-request-id generation
│   │   ├── cors.ts                 # Origin-aware CORS
│   │   └── errorHandler.ts         # Global error handler
│   ├── lib/
│   │   ├── response.ts             # success() / error() helpers
│   │   ├── env.ts                  # Environment helpers
│   │   └── db.ts                   # D1 accessor
│   └── types/
│       └── env.ts                  # Env + HonoEnv types
├── migrations/
│   └── 0001_initial_ids_foundation.sql
├── test/
│   ├── health.test.ts
│   ├── apps.test.ts
│   └── users.test.ts
├── wrangler.toml
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

---

## API Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Service health check |
| `GET` | `/api/version` | Service version and phase |
| `GET` | `/api/apps` | List of platform apps |
| `GET` | `/api/users/me` | Current user placeholder |

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

### Tables Created

| Table | Purpose |
|---|---|
| `ids_service_metadata` | Key/value service configuration |
| `ids_apps` | Platform app registry |
| `ids_audit_logs` | Audit trail for identity events |

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
| **Phase 2** | User registration, authentication (email/password, OAuth) |
| **Phase 3** | Role-based access control (RBAC), permissions |
| **Phase 4** | Multi-tenancy (businesses, projects, teams) |
| **Phase 5** | Session management, trust scoring, MFA |
| **Phase 6** | App-to-app service tokens, API keys |
| **Phase 7** | Admin UI, audit dashboard |

---

## License

Private — Beqakid Platform
