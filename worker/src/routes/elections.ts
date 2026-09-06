import { Hono } from "hono";
import type { AppEnv } from "../types";
import { registerElectionOverviewRoutes } from "./elections/overview";
import { registerElectionExcoRoutes } from "./elections/exco";
import { registerElectionManagementRoutes } from "./elections/management";
import { registerElectionApplicationRoutes } from "./elections/applications";
import { registerElectionVotingRoutes } from "./elections/voting";

export const electionsRoute = new Hono<AppEnv>();

registerElectionExcoRoutes(electionsRoute);
registerElectionOverviewRoutes(electionsRoute);
registerElectionManagementRoutes(electionsRoute);
registerElectionApplicationRoutes(electionsRoute);
registerElectionVotingRoutes(electionsRoute);
