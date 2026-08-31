export const FUND_TIMEZONE = "Indian/Maldives";

export function currentMonthValue() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUND_TIMEZONE, year: "numeric", month: "2-digit" }).format(new Date());
}

export function todayValue() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUND_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function shiftMonthValue(month, delta) {
  const [year, mon] = String(month).split("-").map(Number);
  const total = year * 12 + (mon - 1) + delta;
  const nextYear = Math.floor(total / 12);
  const nextMonth = ((total % 12) + 12) % 12 + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}
