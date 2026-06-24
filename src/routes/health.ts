import { Hono } from "hono";
import type { HonoEnv } from "../types/env";
import { success } from "../lib/response";
import {
  SERVICE_NAME,
  SERVICE_DISPLAY_NAME,
  getVersion,
  getEnvironment,
} from "../lib/env";

const health = new Hono<HonoEnv>();

health.get("/health", (c) => {
  return success(c, {
    ok: true,
    service: SERVICE_NAME,
    name: SERVICE_DISPLAY_NAME,
    version: getVersion(c.env),
    environment: getEnvironment(c.env),
  });
});

health.get("/version", (c) => {
  return success(c, {
    service: SERVICE_NAME,
    version: getVersion(c.env),
    phase: "phase_2_core_identity",
  });
});

export default health;
