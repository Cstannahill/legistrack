// Date formatting utilities (UTC-consistent across list and detail views)
import { format, formatDistanceToNow } from "date-fns";

function normalizeDateInput(date: Date | string): Date {
  if (date instanceof Date) return date;
  const trimmed = date.trim();
  // PostgreSQL `timestamp without time zone` in JSONB lacks a Z/offset; treat as UTC
  const hasTime = trimmed.includes("T") || trimmed.includes(" ");
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  if (hasTime && !hasOffset) {
    return new Date(`${trimmed.replace(" ", "T")}Z`);
  }
  return new Date(trimmed);
}

const UTC_SHORT_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDate(
  date: Date | string,
  formatStr?: string
): string {
  const dateObj = normalizeDateInput(date);
  if (Number.isNaN(dateObj.getTime())) return "—";
  if (!formatStr || formatStr === "MMM d, yyyy") {
    return UTC_SHORT_DATE.format(dateObj);
  }
  return format(dateObj, formatStr);
}

export function formatRelativeTime(date: Date | string): string {
  const dateObj = normalizeDateInput(date);
  if (Number.isNaN(dateObj.getTime())) return "—";
  return formatDistanceToNow(dateObj, { addSuffix: true });
}

export function formatDateTime(date: Date | string): string {
  const dateObj = normalizeDateInput(date);
  if (Number.isNaN(dateObj.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(dateObj);
}
