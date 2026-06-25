import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        isolatedStorage: false,
        miniflare: {
          bindings: {
            // Test-only dummy values — never real credentials
            TWILIO_ACCOUNT_SID: "ACtest00000000000000000000000000",
            TWILIO_AUTH_TOKEN: "test_auth_token_not_real",
            TWILIO_VERIFY_SERVICE_SID: "VAtest00000000000000000000000000",
          },
        },
        wrangler: { configPath: "./wrangler.toml" },
      },
    },
  },
});
