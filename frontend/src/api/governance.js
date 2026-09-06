import { request } from "./client";

export const governanceApi = {
  monthClosures: () => request("/api/governance/month-close"),
  monthCloseCheck: (month) => request(`/api/governance/month-close/${month}/check`),
  closeMonth: (month, note = "") => request(`/api/governance/month-close/${month}`, { method: "POST", body: JSON.stringify({ note }) }),
  reopenMonth: (month) => request(`/api/governance/month-close/${month}`, { method: "DELETE" }),
  reverse: (entity_type, entity_id, reason) => request("/api/governance/reverse", { method: "POST", body: JSON.stringify({ entity_type, entity_id, reason }) }),
  meetingMinutes: (id) => request(`/api/governance/meetings/${id}/minutes`),
  saveMeetingMinutes: (id, data) => request(`/api/governance/meetings/${id}/minutes`, { method: "PUT", body: JSON.stringify(data) }),
  addMeetingResolution: (id, data) => request(`/api/governance/meetings/${id}/resolutions`, { method: "POST", body: JSON.stringify(data) }),
  updateMeetingResolution: (id, data) => request(`/api/governance/meeting-resolutions/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  meetingResolutionHistory: (id) => request(`/api/governance/meeting-resolutions/${id}/history`),
  addMeetingAction: (id, data) => request(`/api/governance/meetings/${id}/actions`, { method: "POST", body: JSON.stringify(data) }),
  updateMeetingAction: (id, data) => request(`/api/governance/meeting-actions/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  annual: (year) => request(`/api/governance/annual/${year}`),
  analytics: (year) => request(`/api/governance/analytics/${year}`),
};
