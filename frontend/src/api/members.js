import { request, downloadBlob } from "./client";

export const memberApi = {
  me: () => request("/api/me"),
  branding: () => request("/api/branding"),
  myDashboard: () => request("/api/me/dashboard"),
  myContributions: () => request("/api/me/contributions"),
  myMeetings: () => request("/api/me/meetings"),
  myProjects: () => request("/api/me/projects"),
  myActions: () => request("/api/me/actions"),
  myGovernanceArchive: () => request("/api/me/governance-archive"),
  rsvpMeeting: (id, response) => request(`/api/me/meetings/${id}/rsvp`, { method: "POST", body: JSON.stringify({ response }) }),
  completeMyAction: (id) => request(`/api/me/actions/${id}/done`, { method: "POST" }),
};

export const membersApi = {
  list: () => request("/api/members"),
  overview: (month) => request(`/api/members/overview${month ? `?month=${month}` : ""}`),
  create: (data) => request("/api/members", { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) => request(`/api/members/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  statement: (id) => request(`/api/members/${id}/statement`),
  contributionSlip: (memberId, contributionId) => downloadBlob(`/api/members/${memberId}/contributions/${contributionId}/slip/file`),
  sendContributionSlipToTelegram: (memberId, contributionId) => request(`/api/members/${memberId}/contributions/${contributionId}/slip/send-to-telegram`, { method: "POST" }),
};
