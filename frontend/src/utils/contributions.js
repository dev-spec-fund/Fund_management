export function approvedContributionSummary(rows = []) {
  const approved = (rows || []).filter((row) => String(row?.status || "").toLowerCase() === "approved");
  const total = approved.reduce((sum, row) => sum + Number(row?.amount || 0), 0);
  return { approved, total };
}
