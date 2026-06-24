import { Hono } from "hono";
import type { HonoEnv } from "../types/env";
import { success } from "../lib/response";

const apps = new Hono<HonoEnv>();

/**
 * Static app registry for Phase 1.
 * In later phases this will be backed by the ids_apps D1 table.
 */
const PLATFORM_APPS = [
  { appId: "command_center", name: "Command Center", status: "planned" },
  { appId: "kai", name: "Kai", status: "planned" },
  { appId: "sms", name: "Shared Media Service", status: "planned" },
  { appId: "carehia", name: "Carehia", status: "planned" },
  { appId: "viliniu", name: "Viliniu", status: "planned" },
  { appId: "volau", name: "Volau", status: "planned" },
];

apps.get("/apps", (c) => {
  return success(c, PLATFORM_APPS);
});

export default apps;
