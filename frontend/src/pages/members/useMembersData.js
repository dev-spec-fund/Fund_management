import { useEffect, useState } from "react";
import { api, onDataChange } from "../../api";
import { currentMonthValue } from "../../utils/date";
import { getAdminReportMonth, saveAdminReportMonth } from "../../utils/adminReportMonth";
import { pageSlice } from "../../components/Pagination";

export default function useMembersData(isAdmin) {
  const [members, setMembers] = useState([]);
  const [month, setMonthState] = useState(getAdminReportMonth());
  const [monthlySummary, setMonthlySummary] = useState(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [defaultMonthly, setDefaultMonthly] = useState(250);
  const [form, setForm] = useState({ name: "", phone: "", monthly_amount: "" });
  const [page, setPage] = useState(1);
  const setMonth = (value) => {
    if(!value)return;
    saveAdminReportMonth(value);
    setMonthState(value);
  };

  const load = () => Promise.all([
    api.members.list().then(setMembers),
    api.reports.summary(month).then(setMonthlySummary),
  ]).catch(() => {});

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, month]);
  useEffect(() => onDataChange(() => { if (isAdmin) load(); }), [isAdmin, month]);
  useEffect(() => {
    if (!isAdmin) return;
    api.settings.get().then((settings) => {
      const value = Number(settings.default_monthly_amount) || 250;
      setDefaultMonthly(value);
      setForm((current) => ({ ...current, monthly_amount: current.monthly_amount === "" ? String(value) : current.monthly_amount }));
    }).catch(() => {});
  }, [isAdmin]);

  const outstandingByMember = new Map((monthlySummary?.outstanding?.members || []).map((member) => [Number(member.id), member]));
  const activeMembers = members.filter((member) => member.active);
  const memberStatus = (member) => {
    if (!member.active) return "inactive";
    return outstandingByMember.get(Number(member.id))?.payment_status || "paid";
  };
  const counts = activeMembers.reduce((result, member) => {
    const status = memberStatus(member);
    result[status] = (result[status] || 0) + 1;
    return result;
  }, { paid: 0, partial: 0, unpaid: 0, exempt: 0 });
  const expected = activeMembers.reduce((sum, member) => sum + Number(member.monthly_amount || 0), 0);
  const dueTotal = Number(monthlySummary?.outstanding?.total || 0);
  const collected = Math.max(0, expected - dueTotal);
  const percent = expected > 0 ? Math.min(100, Math.round((collected / expected) * 100)) : 0;
  const filtered = members.filter((member) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query
      || member.name.toLowerCase().includes(query)
      || String(member.member_code || "").toLowerCase().includes(query)
      || String(member.phone || "").includes(query);
    const status = memberStatus(member);
    const matchesFilter = filter === "all" || (filter === "outstanding" ? status === "partial" || status === "unpaid" : status === filter);
    return matchesSearch && matchesFilter;
  });
  const memberPage = pageSlice(filtered, page);

  const shiftMonth = (delta) => {
    const [year, monthNumber] = month.split("-").map(Number);
    const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
    setMonth(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  const monthLabel = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));

  return {
    members,
    month,
    setMonth,
    search,
    setSearch,
    filter,
    setFilter,
    defaultMonthly,
    form,
    setForm,
    page,
    setPage,
    load,
    outstandingByMember,
    activeMembers,
    memberStatus,
    counts,
    expected,
    collected,
    percent,
    filtered,
    memberPage,
    shiftMonth,
    monthLabel,
  };
}
