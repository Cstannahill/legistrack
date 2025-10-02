// Date formatting utilities
import { format, formatDistanceToNow, parseISO } from "date-fns";

export function formatDate(
  date: Date | string,
  formatStr: string = "MMM d, yyyy"
): string {
  const dateObj = typeof date === "string" ? parseISO(date) : date;
  return format(dateObj, formatStr);
}

export function formatRelativeTime(date: Date | string): string {
  const dateObj = typeof date === "string" ? parseISO(date) : date;
  return formatDistanceToNow(dateObj, { addSuffix: true });
}

export function formatDateTime(date: Date | string): string {
  const dateObj = typeof date === "string" ? parseISO(date) : date;
  return format(dateObj, "MMM d, yyyy h:mm a");
}
