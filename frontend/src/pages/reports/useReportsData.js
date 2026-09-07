import { useEffect, useMemo, useRef, useState } from "react";
import { api, onDataChangeDebounced } from "../../api";
import { shiftMonthValue } from "../../utils/date";

export function useReportsData(sharedMonth, onMonthChange, { enabled = true } = {}) {
  const month=sharedMonth;
  const summaryPath=`/api/reports/summary?month=${month}`;
  const trendPath=`/api/reports/trend?month=${month}`;
  const [summary, setSummary] = useState(()=>api.peekCached(summaryPath));
  const [trend, setTrend] = useState(()=>api.peekCached(trendPath)||[]);
  const monthCache=useRef(new Map());
  if(summary && !monthCache.current.has(month)) monthCache.current.set(month,{summary,trend});
  const [annualYear, setAnnualYear] = useState(String(new Date().getFullYear()));
  const [annual, setAnnual] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [annualBusy, setAnnualBusy] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const local=monthCache.current.get(month)||{};
    const cachedSummary=api.peekCached(summaryPath) || local.summary;
    const cachedTrend=api.peekCached(trendPath) || local.trend;
    setSummary(cachedSummary || null);
    if(cachedTrend) setTrend(cachedTrend);
    Promise.all([
      api.reports.summary(month).then(value=>{const prev=monthCache.current.get(month)||{};monthCache.current.set(month,{...prev,summary:value});setSummary(value)}),
      api.reports.trend(month).then(value=>{const prev=monthCache.current.get(month)||{};monthCache.current.set(month,{...prev,trend:value});setTrend(value)}),
    ]).catch(() => {});
  }, [enabled, month]);

  useEffect(() => onDataChangeDebounced(({ paths = [] }) => {
    if (!enabled) return;
    const relevant = paths.some((path) =>
      path?.startsWith("/api/contributions") ||
      path?.startsWith("/api/donations") ||
      path?.startsWith("/api/expenses") ||
      path?.startsWith("/api/projects") ||
      path?.startsWith("/api/members")
    );
    if (!relevant) return;
    Promise.all([
      api.reports.summary(month).then(value=>{const prev=monthCache.current.get(month)||{};monthCache.current.set(month,{...prev,summary:value});setSummary(value)}),
      api.reports.trend(month).then(value=>{const prev=monthCache.current.get(month)||{};monthCache.current.set(month,{...prev,trend:value});setTrend(value)}),
    ]).catch(() => {});
    if (annual || analytics) {
      Promise.all([
        api.governance.annual(annualYear).then(setAnnual),
        api.governance.analytics(annualYear).then(setAnalytics),
      ]).catch(() => {});
    }
  }, 140), [enabled, month, annualYear, Boolean(annual), Boolean(analytics)]);

  const loadAnnual = async () => {
    if (!enabled) return;
    setAnnualBusy(true);
    try {
      const [a, x] = await Promise.all([
        api.governance.annual(annualYear),
        api.governance.analytics(annualYear),
      ]);
      setAnnual(a);
      setAnalytics(x);
    } finally {
      setAnnualBusy(false);
    }
  };

  const monthLabel = useMemo(() => new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`)), [month]);

  return {
    month,
    monthLabel,
    summary,
    trend,
    annualYear,
    setAnnualYear,
    annual,
    analytics,
    annualBusy,
    shiftMonth: (delta) => onMonthChange?.(shiftMonthValue(month,delta)),
    loadAnnual,
  };
}
