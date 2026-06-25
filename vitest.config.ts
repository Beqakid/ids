import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        isolatedStorage: false,
        miniflare: {
          bindings: {
            // Test-only dummy values — never real credentials

            // Twilio (Phase 4B)
            TWILIO_ACCOUNT_SID: "ACtest00000000000000000000000000",
            TWILIO_AUTH_TOKEN: "test_auth_token_not_real",
            TWILIO_VERIFY_SERVICE_SID: "VAtest00000000000000000000000000",

            // Phase 5 — JWT, bootstrap, and API key pepper
            // These are test-only values. Never use real secrets here.
            IDS_JWT_SECRET: "test-jwt-secret-32-chars-minimum-00",
            IDS_BOOTSTRAP_API_KEY: "test-bootstrap-key-not-real",
            IDS_API_KEY_PEPPER: "test-pepper-not-real",
          },
        },
        wrangler: { configPath: "./wrangler.toml" },
      },
    },
  },
});
