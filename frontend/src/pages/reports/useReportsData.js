import { useEffect, useMemo, useState } from "react";
import { api, onDataChange } from "../../api";
import { shiftMonthValue } from "../../utils/date";

export function useReportsData(sharedMonth, onMonthChange) {
  const month=sharedMonth;
  const summaryPath=`/api/reports/summary?month=${month}`;
  const trendPath=`/api/reports/trend?month=${month}`;
  const [summary, setSummary] = useState(()=>api.peekCached(summaryPath));
  const [trend, setTrend] = useState(()=>api.peekCached(trendPath)||[]);
  const [annualYear, setAnnualYear] = useState(String(new Date().getFullYear()));
  const [annual, setAnnual] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [annualBusy, setAnnualBusy] = useState(false);

  const loadMonthly = () => api.reports.summary(month).then(setSummary);

  useEffect(() => {
    const cachedSummary=api.peekCached(summaryPath);
    const cachedTrend=api.peekCached(trendPath);
    setSummary(cachedSummary || null);
    if(cachedTrend) setTrend(cachedTrend);
    Promise.all([
      api.reports.summary(month).then(setSummary),
      api.reports.trend(month).then(setTrend),
    ]).catch(() => {});
  }, [month]);

  useEffect(() => onDataChange(() => {
    Promise.all([
      api.reports.summary(month).then(setSummary),
      api.reports.trend(month).then(setTrend),
    ]).catch(() => {});
    if (annual || analytics) {
      Promise.all([
        api.governance.annual(annualYear).then(setAnnual),
        api.governance.analytics(annualYear).then(setAnalytics),
      ]).catch(() => {});
    }
  }), [month, annualYear, Boolean(annual), Boolean(analytics)]);

  const loadAnnual = async () => {
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
    loadMonthly,
    loadAnnual,
  };
}
