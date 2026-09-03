import { Hono } from "hono";
import type { AppEnv } from "../types";
import { registerPendingAdminRoutes } from "./admin/pending";
import { registerMeetingAdminRoutes } from "./admin/meetings";
import { registerSystemAdminRoutes } from "./admin/system";

export const adminRoute = new Hono<AppEnv>();

registerPendingAdminRoutes(adminRoute);
registerMeetingAdminRoutes(adminRoute);
registerSystemAdminRoutes(adminRoute);
