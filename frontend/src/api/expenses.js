import { request, upload, downloadBlob } from "./client";

export const expensesApi = {
  list: ({ month = "", status = "", q = "", documents = "" } = {}) => {
    const params = new URLSearchParams();
    if (month) params.set("month", month);
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    if (documents) params.set("documents", documents);
    const query = params.toString();
    return request(`/api/expenses${query ? `?${query}` : ""}`);
  },
  create: (data) => request("/api/expenses", { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) => request(`/api/expenses/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id, reason) => request(`/api/expenses/${id}`, { method: "DELETE", body: JSON.stringify({ reason }) }),
  documents: (id) => request(`/api/expenses/${id}/documents`),
  uploadDocument: (id, file, documentType = "") => {
    const form = new FormData();
    form.append("file", file, file.name || "document");
    if (documentType) form.append("document_type", documentType);
    return upload(`/api/expenses/${id}/documents`, form);
  },
  downloadDocument: (expenseId, documentId) => downloadBlob(`/api/expenses/${expenseId}/documents/${documentId}/file`),
  sendDocumentToTelegram: (expenseId, documentId) => request(`/api/expenses/${expenseId}/documents/${documentId}/send-to-telegram`, { method: "POST" }),
  updateDocument: (expenseId, documentId, data) => request(`/api/expenses/${expenseId}/documents/${documentId}`, { method: "PATCH", body: JSON.stringify(data) }),
  removeDocument: (expenseId, documentId, reason) => request(`/api/expenses/${expenseId}/documents/${documentId}`, { method: "DELETE", body: JSON.stringify({ reason }) }),
  categories: () => request("/api/expenses/categories"),
  addCategory: (name) => request("/api/expenses/categories", { method: "POST", body: JSON.stringify({ name }) }),
  updateCategory: (id, data) => request(`/api/expenses/categories/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  removeCategory: (id) => request(`/api/expenses/categories/${id}`, { method: "DELETE" }),
};

export const donationsApi = {
  list: ({ month = "", status = "", q = "", documents = "" } = {}) => {
    const params = new URLSearchParams();
    if (month) params.set("month", month);
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    if (documents) params.set("documents", documents);
    const qs = params.toString();
    return request(`/api/donations${qs ? `?${qs}` : ""}`);
  },
  get: (id) => request(`/api/donations/${id}`),
  create: (data) => request("/api/donations", { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) => request(`/api/donations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id, reason) => request(`/api/donations/${id}`, { method: "DELETE", body: JSON.stringify({ reason }) }),
  documents: (id) => request(`/api/donations/${id}/documents`),
  uploadDocument: (id, file, documentType = "") => {
    const form = new FormData();
    form.append("file", file, file.name || "document");
    if (documentType) form.append("document_type", documentType);
    return upload(`/api/donations/${id}/documents`, form);
  },
  downloadDocument: (donationId, documentId) => downloadBlob(`/api/donations/${donationId}/documents/${documentId}/file`),
  sendDocumentToTelegram: (donationId, documentId) => request(`/api/donations/${donationId}/documents/${documentId}/send-to-telegram`, { method: "POST" }),
  updateDocument: (donationId, documentId, data) => request(`/api/donations/${donationId}/documents/${documentId}`, { method: "PATCH", body: JSON.stringify(data) }),
  removeDocument: (donationId, documentId, reason) => request(`/api/donations/${donationId}/documents/${documentId}`, { method: "DELETE", body: JSON.stringify({ reason }) }),
};
