import { useEffect, useMemo, useRef, useState } from "react";
import { api, onDataChange } from "../../api";
import { shiftMonthValue } from "../../utils/date";

export function useReportsData({ month, onMonthChange }) {
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [annualYear, setAnnualYear] = useState(String(new Date().getFullYear()));
  const [annual, setAnnual] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [annualBusy, setAnnualBusy] = useState(false);
  const monthlyRequestRef = useRef(0);
  const annualRequestRef = useRef(0);

  const loadMonthly = async () => {
    const requestId=++monthlyRequestRef.current;
    const data=await api.reports.summary(month);
    if(requestId===monthlyRequestRef.current)setSummary(data);
    return data;
  };

  useEffect(() => {
    const requestId=++monthlyRequestRef.current;
    setSummary(null);
    Promise.all([
      api.reports.summary(month),
      api.reports.trend(month),
    ]).then(([nextSummary,nextTrend])=>{
      if(requestId!==monthlyRequestRef.current)return;
      setSummary(nextSummary);
      setTrend(nextTrend);
    }).catch(() => {});
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
    const requestId=++annualRequestRef.current;
    setAnnualBusy(true);
    try {
      const [a, x] = await Promise.all([
        api.governance.annual(annualYear),
        api.governance.analytics(annualYear),
      ]);
      if(requestId!==annualRequestRef.current)return;
      setAnnual(a);
      setAnalytics(x);
    } finally {
      if(requestId===annualRequestRef.current)setAnnualBusy(false);
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
    shiftMonth: (delta) => onMonthChange?.(shiftMonthValue(month, delta)),
    loadMonthly,
    loadAnnual,
  };
}
