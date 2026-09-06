import { request } from "./client";

export const projectsApi = {
  list: ({ status = "", q = "" } = {}) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    const qs = params.toString();
    return request(`/api/projects${qs ? `?${qs}` : ""}`);
  },
  get: (id) => request(`/api/projects/${id}`),
  create: (data) => request("/api/projects", { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) => request(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
};
