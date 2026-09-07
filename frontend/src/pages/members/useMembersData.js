import { useEffect, useRef, useState } from "react";
import { api, onDataChangeDebounced } from "../../api";
import { pageSlice } from "../../components/Pagination";

export default function useMembersData(isAdmin, sharedMonth, onMonthChange) {
  const month=sharedMonth;
  const overviewPath=`/api/members/overview?month=${month}`;
  const initialOverview=api.peekCached(overviewPath);
  const [members, setMembers] = useState(()=>initialOverview?.members || api.peekCached("/api/members") || []);
  const [monthlySummary, setMonthlySummary] = useState(()=>initialOverview?.monthly_summary || null);
  const monthOverviewCache=useRef(new Map());
  if(initialOverview && !monthOverviewCache.current.has(month)) monthOverviewCache.current.set(month,initialOverview);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [defaultMonthly, setDefaultMonthly] = useState(250);
  const [form, setForm] = useState({ name: "", phone: "", monthly_amount: "" });
  const [page, setPage] = useState(1);
  const setMonth = (value) => {
    if(!value)return;
    onMonthChange?.(value);
  };

  const applyOverview = (data) => {
    if(!data)return null;
    monthOverviewCache.current.set(month,data);
    if(Array.isArray(data.members)) setMembers(data.members);
    setMonthlySummary(data.monthly_summary || null);
    return data;
  };
  const loadOverview = () => api.members.overview(month).then(applyOverview).catch(() => null);
  const load = loadOverview;

  useEffect(() => {
    if (!isAdmin) return;
    const cached=api.peekCached(overviewPath) || monthOverviewCache.current.get(month);
    if(cached) applyOverview(cached);
    loadOverview();
  }, [isAdmin, month]);

  useEffect(() => onDataChangeDebounced(({ paths = [] }) => {
    if (!isAdmin) return;
    const membersChanged = paths.some((path) => path?.startsWith("/api/members"));
    const financeChanged = paths.some((path) =>
      path?.startsWith("/api/contributions") ||
      path?.startsWith("/api/donations") ||
      path?.startsWith("/api/expenses")
    );
    if (membersChanged || financeChanged) loadOverview();
  }, 120), [isAdmin, month]);

  const ensureDefaultMonthly = async () => {
    const cached = api.peekCached("/api/settings");
    const settings = cached || await api.settings.get();
    const value = Number(settings?.default_monthly_amount) || 250;
    setDefaultMonthly(value);
    setForm((current) => ({ ...current, monthly_amount: current.monthly_amount === "" ? String(value) : current.monthly_amount }));
    return value;
  };

  const outstandingByMember = new Map((monthlySummary?.member_statuses || monthlySummary?.outstanding?.members || []).map((member) => [Number(member.id), member]));
  const activeMembers = members.filter((member) => member.active);
  const memberJoinMonth = (member) => String(member?.joined_at || member?.created_at || "").slice(0, 7);
  const joinedAfterSelectedMonth = (member) => {
    const joined = memberJoinMonth(member);
    return /^\d{4}-\d{2}$/.test(joined) && joined > month;
  };
  const memberStatus = (member) => {
    if (!member.active) return "inactive";
    // Historical views must never mark a member as paid before they joined.
    if (joinedAfterSelectedMonth(member)) return "not_applicable";
    const row = outstandingByMember.get(Number(member.id));
    if (row?.payment_status) return row.payment_status;
    // Missing summary rows are safer treated as outstanding than incorrectly paid.
    return "unpaid";
  };
  const counts = activeMembers.reduce((result, member) => {
    const status = memberStatus(member);
    result[status] = (result[status] || 0) + 1;
    return result;
  }, { paid: 0, partial: 0, unpaid: 0, exempt: 0, not_applicable: 0 });
  const eligibleMembers = activeMembers.filter((member) => !joinedAfterSelectedMonth(member));
  const expected = Number(monthlySummary?.collection?.expected ?? eligibleMembers.reduce((sum, member) => sum + Number(member.monthly_amount || 0), 0));
  const collected = Number(monthlySummary?.collection?.collected ?? 0);
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
  useEffect(() => { setPage(1); }, [month, search, filter]);
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
    ensureDefaultMonthly,
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
