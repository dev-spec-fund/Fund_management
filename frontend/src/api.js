import {
  onDataChange,
  onDataChangeDebounced,
  peekCached,
  refreshCached,
  performanceSnapshot,
  reportClientError,
  prefetchTabData,
} from "./api/client";
import { memberApi, membersApi } from "./api/members";
import { expensesApi, donationsApi } from "./api/expenses";
import { projectsApi } from "./api/projects";
import { reportsApi } from "./api/reports";
import { settingsApi } from "./api/settings";
import { governanceApi } from "./api/governance";
import { electionsApi } from "./api/elections";
import { adminApi } from "./api/admin";

export {
  API_BASE,
  onDataChange,
  onDataChangeDebounced,
  peekCached,
  refreshCached,
  performanceSnapshot,
} from "./api/client";

export const api = {
  ...memberApi,
  reportClientError,
  prefetchTabData,
  peekCached,
  refreshCached,
  performanceSnapshot,
  members: membersApi,
  expenses: expensesApi,
  projects: projectsApi,
  donations: donationsApi,
  reports: reportsApi,
  settings: settingsApi,
  governance: governanceApi,
  elections: electionsApi,
  admin: adminApi,
};
