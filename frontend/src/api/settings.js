import { request } from "./client";

export const settingsApi = {
  get: () => request("/api/settings"),
  update: (data) => request("/api/settings", { method: "PATCH", body: JSON.stringify(data) }),
  admins: () => request("/api/settings/admins"),
  promoteMember: (member_id, role, custom_role_id = null) => request("/api/settings/admins/promote-member", { method: "POST", body: JSON.stringify({ member_id, role, custom_role_id }) }),
  demoteMember: (id) => request(`/api/settings/admins/${id}/demote-member`, { method: "POST" }),
  updateAdmin: (id, data) => request(`/api/settings/admins/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  roles: () => request("/api/settings/roles"),
  createRole: (data) => request("/api/settings/roles", { method: "POST", body: JSON.stringify(data) }),
  updateRole: (id, data) => request(`/api/settings/roles/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  removeRole: (id) => request(`/api/settings/roles/${id}`, { method: "DELETE" }),
  auditLog: () => request("/api/settings/audit-log"),
};
