import type { Env } from "../types/env";

export const SERVICE_NAME = "ids";
export const SERVICE_DISPLAY_NAME = "Shared Identity Service";

export function getVersion(env: Env): string {
  return env.SERVICE_VERSION || "0.1.0";
}

export function getEnvironment(env: Env): string {
  return env.ENVIRONMENT || "development";
}

export function getAllowedOrigins(env: Env): string[] {
  const configured = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(",")
        .map((o) => o.trim())
        .filter(Boolean)
    : [];

  const defaults = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8787",
  ];

  const all = new Set([...defaults, ...configured]);
  return Array.from(all);
}
