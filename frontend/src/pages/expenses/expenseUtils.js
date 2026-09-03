export const FILTERS = [
  ["all", "All"],
  ["approved", "Posted"],
  ["reversed", "Reversed"],
  ["voided", "Voided"],
];

export function monthLabel(month) {
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${month}-01T00:00:00Z`));
}

export function statusLabel(row) {
  if (row.status === "approved") return "Posted";
  if (row.status === "voided") return "Voided";
  if (row.status === "reversed") return "Reversed";
  return String(row.status || "").replace(/^./, (c) => c.toUpperCase());
}

export function statusTone(status) {
  if (status === "approved") return { bg: "var(--success-bg)", color: "var(--success-strong)", border: "var(--success-border)" };
  if (status === "pending") return { bg: "var(--warning-bg)", color: "var(--warning)", border: "var(--warning-border)" };
  return { bg: "var(--danger-bg)", color: "var(--danger)", border: "var(--danger-border)" };
}

export async function expenseMutationWithOverrides(run, payload = {}) {
  let next = { ...payload };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await run(next);
    } catch (e) {
      if (e.code === "PROJECT_BUDGET_EXCEEDED" && e.override_allowed && !next.budget_override_reason) {
        const reason = prompt(`${e.message}\n\nReason for exceeding the project budget:`);
        if (!reason || reason.trim().length < 3) throw e;
        next = { ...next, budget_override_reason: reason.trim() };
        continue;
      }
      if (e.code === "INSUFFICIENT_FUND" && e.override_allowed && !next.override_fund_limit) {
        const reason = prompt(`${e.message}\n\nSuper Admin override reason:`);
        if (!reason || reason.trim().length < 3) throw e;
        next = { ...next, override_fund_limit: true, override_reason: reason.trim() };
        continue;
      }
      throw e;
    }
  }
  throw new Error("Could not save expense");
}
