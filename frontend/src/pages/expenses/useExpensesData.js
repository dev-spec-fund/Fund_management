import { useCallback, useEffect, useMemo, useState } from "react";
import { api, onDataChange } from "../../api";
import { currentMonthValue } from "../../utils/date";

export default function useExpensesData() {
  const [month, setMonth] = useState(currentMonthValue());
  const [filter, setFilter] = useState("all");
  const [documentsFilter, setDocumentsFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [rows, setRows] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await api.expenses.list({
        month,
        status: filter === "all" ? "" : filter,
        q: debouncedQuery,
        documents: documentsFilter === "all" ? "" : documentsFilter,
      });
      setRows(data);
    } catch (e) {
      setError(e.message || "Could not load expenses");
      setRows([]);
    }
  }, [month, filter, debouncedQuery, documentsFilter]);

  useEffect(() => {
    setRows(null);
    setPage(1);
    load();
  }, [load]);

  useEffect(() => onDataChange(({ path }) => {
    if (path?.startsWith("/api/expenses") || path?.startsWith("/api/governance/reverse") || path?.startsWith("/api/projects")) load();
  }), [load]);

  const totals = useMemo(() => {
    const base = rows || [];
    return {
      total: base.reduce((sum, row) => sum + (row.status === "approved" ? Number(row.amount || 0) : 0), 0),
      count: base.length,
    };
  }, [rows]);

  const saved = useCallback(async (text = "Expense saved") => {
    setMessage(text);
    await load();
  }, [load]);

  return {
    month, setMonth,
    filter, setFilter,
    documentsFilter, setDocumentsFilter,
    query, setQuery,
    rows,
    message, setMessage,
    error,
    page, setPage,
    totals,
    load,
    saved,
  };
}
