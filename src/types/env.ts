export interface Env {
  /** Cloudflare D1 database binding for IDS */
  IDS_DB: D1Database;
  /** Current deployment environment (development | staging | production) */
  ENVIRONMENT: string;
  /** Service version string */
  SERVICE_VERSION: string;
  /** Comma-separated list of allowed CORS origins */
  ALLOWED_ORIGINS: string;

  // ── Twilio Verify (added as Cloudflare Worker secrets) ─────
  /** Twilio Account SID — set via `wrangler secret put` */
  TWILIO_ACCOUNT_SID: string;
  /** Twilio Auth Token — set via `wrangler secret put` */
  TWILIO_AUTH_TOKEN: string;
  /** Twilio Verify Service SID — set via `wrangler secret put` */
  TWILIO_VERIFY_SERVICE_SID: string;
}

/** Variables stored on the Hono context */
export interface HonoVariables {
  requestId: string;
}

/** Full Hono environment type */
export interface HonoEnv {
  Bindings: Env;
  Variables: HonoVariables;
}
