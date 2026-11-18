import Link from "next/link";
import { getCategoryBySlug, type CategorySlug } from "@/lib/utils/category-helper";
import { cn } from "@/lib/utils";

interface CategoryBadgeProps {
  category: {
    id: string;
    name: string;
    slug: string;
    color?: string | null;
  };
  linked?: boolean;
  className?: string;
}

/**
 * Consistent category chip with a subtle colored indicator dot on neutral pill styling.
 */
export function CategoryBadge({
  category,
  linked = false,
  className,
}: CategoryBadgeProps) {
  const helperData = getCategoryBySlug(category.slug as CategorySlug);
  const dotColor = helperData?.color || category.color || undefined;

  const classes = cn(
    "inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-secondary/60 px-2.5 py-0.5 text-xs font-medium text-secondary-foreground whitespace-nowrap transition-colors",
    linked && "hover:border-foreground/25 hover:bg-secondary",
    className
  );

  const inner = (
    <>
      {dotColor && (
        <span
          className="h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: dotColor }}
          aria-hidden="true"
        />
      )}
      <span>{category.name}</span>
    </>
  );

  if (linked) {
    return (
      <Link
        href={`/bills?category=${encodeURIComponent(category.slug)}`}
        className={classes}
      >
        {inner}
      </Link>
    );
  }

  return <span className={classes}>{inner}</span>;
}
