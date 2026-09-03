export function adminCan(admin, permission) {
  if (!admin) return false;
  const role = admin.role === "owner" ? "super_admin" : admin.role;
  if (role === "super_admin") return true;

  if (admin.custom_role_id) {
    return Array.isArray(admin.permissions) && admin.permissions.includes(permission);
  }

  if (role === "treasurer") return permission === "read" || permission === "finance";
  if (role === "viewer") return permission === "read";
  return false;
}

export const adminRoleLabel = (admin) => {
  if (!admin) return "Member";
  if (admin.custom_role_id && admin.custom_role_name) return admin.custom_role_name;
  const role = admin.role === "owner" ? "super_admin" : admin.role;
  return role === "super_admin" ? "Super Admin" : role === "treasurer" ? "Treasurer" : "Viewer";
};
