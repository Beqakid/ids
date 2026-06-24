export interface Env {
  /** Cloudflare D1 database binding for IDS */
  IDS_DB: D1Database;
  /** Current deployment environment (development | staging | production) */
  ENVIRONMENT: string;
  /** Service version string */
  SERVICE_VERSION: string;
  /** Comma-separated list of allowed CORS origins */
  ALLOWED_ORIGINS: string;
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
