import type { AuthContext } from "./auth";

export interface Env {
  /** Cloudflare D1 database binding for IDS */
  IDS_DB: D1Database;
  /** Current deployment environment (development | staging | production) */
  ENVIRONMENT: string;
  /** Service version string */
  SERVICE_VERSION: string;
  /** Comma-separated list of allowed CORS origins */
  ALLOWED_ORIGINS: string;

  // ── Twilio Verify (set via `wrangler secret put`) ────────────
  /** Twilio Account SID — set via `wrangler secret put TWILIO_ACCOUNT_SID` */
  TWILIO_ACCOUNT_SID: string;
  /** Twilio Auth Token — set via `wrangler secret put TWILIO_AUTH_TOKEN` */
  TWILIO_AUTH_TOKEN: string;
  /** Twilio Verify Service SID — set via `wrangler secret put TWILIO_VERIFY_SERVICE_SID` */
  TWILIO_VERIFY_SERVICE_SID: string;

  // ── Phase 5 secrets (set via `wrangler secret put`) ──────────
  /**
   * HS256 JWT signing secret — must be at least 32 characters.
   * Set via: npx wrangler secret put IDS_JWT_SECRET
   * Never commit. Never log. Never expose in responses.
   */
  IDS_JWT_SECRET: string;
  /**
   * Bootstrap API key — used only to create the first trusted service client.
   * Set via: npx wrangler secret put IDS_BOOTSTRAP_API_KEY
   * Never commit. Never log. Never expose in responses.
   */
  IDS_BOOTSTRAP_API_KEY: string;
  /**
   * Optional pepper for HMAC-SHA-256 API key hashing.
   * Set via: npx wrangler secret put IDS_API_KEY_PEPPER
   * Never commit. Never log. Never expose in responses.
   */
  IDS_API_KEY_PEPPER?: string;
}

/** Variables stored on the Hono context */
export interface HonoVariables {
  requestId: string;
  /** Auth context populated by the auth middleware. */
  authContext?: AuthContext;
}

/** Full Hono environment type */
export interface HonoEnv {
  Bindings: Env;
  Variables: HonoVariables;
}
