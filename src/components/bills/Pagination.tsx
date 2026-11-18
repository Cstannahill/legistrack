import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  searchParams: Record<string, string | undefined>;
  basePath?: string;
  className?: string;
}

function buildPageHref(
  basePath: string,
  searchParams: Record<string, string | undefined>,
  page: number
) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v !== undefined && v !== "" && k !== "page") {
      next.set(k, v);
    }
  }
  if (page > 1) {
    next.set("page", String(page));
  }
  const qs = next.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

function getVisiblePages(current: number, total: number): Array<number | "ellipsis"> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: Array<number | "ellipsis"> = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);

  if (left > 2) pages.push("ellipsis");
  for (let p = left; p <= right; p++) {
    pages.push(p);
  }
  if (right < total - 1) pages.push("ellipsis");
  pages.push(total);
  return pages;
}

/**
 * Accessible SPA pagination bar using Next.js Links while preserving active filter params.
 */
export function Pagination({
  currentPage,
  totalPages,
  searchParams,
  basePath = "/bills",
  className,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = getVisiblePages(currentPage, totalPages);
  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  return (
    <nav
      aria-label="Pagination"
      className={cn("flex items-center justify-center gap-1.5 flex-wrap", className)}
    >
      {hasPrev ? (
        <Link
          href={buildPageHref(basePath, searchParams, currentPage - 1)}
          className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Previous</span>
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className="inline-flex h-9 items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-3 text-sm font-medium text-muted-foreground opacity-60 cursor-not-allowed"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Previous</span>
        </span>
      )}

      <div className="flex items-center gap-1">
        {pages.map((item, idx) =>
          item === "ellipsis" ? (
            <span
              key={`ellipsis-${idx}`}
              className="px-2 text-sm text-muted-foreground select-none"
              aria-hidden="true"
            >
              …
            </span>
          ) : item === currentPage ? (
            <span
              key={item}
              aria-current="page"
              className="inline-flex h-9 min-w-9 items-center justify-center rounded-md bg-primary px-2.5 font-mono text-sm font-semibold text-primary-foreground tabular-nums"
            >
              {item}
            </span>
          ) : (
            <Link
              key={item}
              href={buildPageHref(basePath, searchParams, item)}
              className="inline-flex h-9 min-w-9 items-center justify-center rounded-md border border-transparent px-2.5 font-mono text-sm text-foreground/80 tabular-nums transition-colors hover:border-border hover:bg-muted hover:text-foreground"
            >
              {item}
            </Link>
          )
        )}
      </div>

      {hasNext ? (
        <Link
          href={buildPageHref(basePath, searchParams, currentPage + 1)}
          className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          aria-label="Next page"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className="inline-flex h-9 items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-3 text-sm font-medium text-muted-foreground opacity-60 cursor-not-allowed"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </span>
      )}
    </nav>
  );
}
