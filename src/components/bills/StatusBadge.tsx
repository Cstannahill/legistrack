// StatusBadge Component - Display bill status with semantic dot and bordered pill
import {
  BILL_STATUS_COLORS,
  BILL_STATUS_LABELS,
  BILL_STATUS_TONES,
  SEMANTIC_TONE_DOT_CLASSES,
} from "@/lib/constants";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const key = status as keyof typeof BILL_STATUS_LABELS;
  const badgeClass = BILL_STATUS_COLORS[key] || BILL_STATUS_COLORS.INTRODUCED;
  const tone = BILL_STATUS_TONES[key] || "neutral";
  const dotClass = SEMANTIC_TONE_DOT_CLASSES[tone];
  const label = BILL_STATUS_LABELS[key] || status;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        badgeClass,
        className
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotClass)}
        aria-hidden="true"
      />
      <span>{label}</span>
    </span>
  );
}
