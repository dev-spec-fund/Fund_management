export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function validMonth(value: unknown): value is string {
  return typeof value === 'string' && MONTH_RE.test(value);
}
export function validDate(value: unknown): value is string {
  if (value == null || value === '') return true;
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export function money(value: unknown, max = 100000000): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > max) return null;
  return Math.round(n * 100) / 100;
}
export function boundedText(value: unknown, max: number, required = false): string | null {
  const s = String(value ?? '').trim();
  if (required && !s) return null;
  if (s.length > max) return null;
  return s;
}
export function telegramId(value: unknown): string | null {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  return /^\d{1,20}$/.test(s) ? s : null;
}
export function flag(value: unknown): 0 | 1 | null {
  return value === 0 || value === '0' || value === false ? 0 : value === 1 || value === '1' || value === true ? 1 : null;
}
