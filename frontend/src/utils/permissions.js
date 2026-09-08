const GRANULAR_PERMISSIONS = new Set([
  "members_view","members_manage","approvals_manage",
  "expenses_view","expenses_manage","donations_view","donations_manage",
  "reports_view","reports_export","projects_view","projects_manage",
  "meetings_view","meetings_manage","elections_view","elections_manage","elections_certify",
  "settings_view","settings_manage","audit_view","financial_reversals","close_month","manage_admins","backup"
]);

const BUILTIN = {
  president: new Set([
    "read","members_view","members_manage","approvals_manage",
    "expenses_view","expenses_manage","donations_view","donations_manage",
    "reports_view","reports_export","projects_view","projects_manage",
    "meetings_view","meetings_manage","elections_view","elections_manage","elections_certify",
    "settings_view","settings_manage","audit_view","financial_reversals","close_month"
  ]),
  treasurer: new Set([
    "read","finance","members_view","members_manage","approvals_manage",
    "expenses_view","expenses_manage","donations_view","donations_manage",
    "reports_view","reports_export","projects_view","projects_manage","meetings_view","meetings_manage",
    "settings_view","settings_manage","audit_view","financial_reversals"
  ]),
  secretary: new Set([
    "read","members_view","reports_view","projects_view","projects_manage",
    "meetings_view","meetings_manage","elections_view","settings_view"
  ]),
  viewer: new Set([
    "read","members_view","expenses_view","donations_view","reports_view",
    "projects_view","meetings_view","elections_view","settings_view","audit_view"
  ])
};

export function adminCan(admin, permission) {
  if (!admin) return false;
  const role = admin.role === "owner" ? "super_admin" : admin.role;
  if (role === "super_admin") return true;

  if (admin.custom_role_id) {
    const permissions = Array.isArray(admin.permissions) ? admin.permissions.map(String) : [];
    const hasGranular = permissions.some(p => GRANULAR_PERMISSIONS.has(p));
    if (hasGranular) {
      if (permissions.includes(permission)) return true;
      if (permission.endsWith("_view") && permissions.includes(permission.replace(/_view$/, "_manage"))) return true;
      if (permission === "elections_view" && (permissions.includes("elections_manage") || permissions.includes("elections_certify"))) return true;
      if (permission === "reports_view" && permissions.includes("reports_export")) return true;
      return permission === "read";
    }
    if (permissions.includes(permission)) return true;
    if (permissions.includes("finance")) {
      return new Set(["read","finance","members_view","members_manage","approvals_manage","expenses_view","expenses_manage","donations_view","donations_manage","reports_view","reports_export","projects_view","projects_manage","meetings_view","meetings_manage","settings_view","settings_manage","audit_view"]).has(permission);
    }
    return permission === "read" && permissions.includes("read");
  }

  return BUILTIN[role]?.has(permission) || false;
}
