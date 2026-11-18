import { cn } from "@/lib/utils";

interface BrandMarkProps {
  className?: string;
}

/**
 * Geometric civic-editorial emblem for LegisTrack.
 */
export function BrandMark({ className }: BrandMarkProps) {
  return (
    <span
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary",
        className
      )}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4.5 w-4.5"
      >
        <path d="M12 3v18" />
        <path d="M7 21h10" />
        <path d="M4 7h16" />
        <path d="M4 7l-1.5 6a3 3 0 0 0 6 0L7 7" />
        <path d="M17 7l-1.5 6a3 3 0 0 0 6 0L20 7" />
      </svg>
    </span>
  );
}
