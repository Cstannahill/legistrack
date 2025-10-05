// API Route: GET /api/bills - List bills with filtering and pagination
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";

// Dual-path implementation:
// 1. Simple (unfiltered) case: delegate to get_bills SQL function for consistency with server components
// 2. Filtered / advanced sorting: fallback to Prisma until SQL function is parameterized
//
// TODO (functions/filters): Planned signature evolution
//   CREATE OR REPLACE FUNCTION get_bills(
//     offset_val INT DEFAULT 0,
//     limit_val INT DEFAULT 50,
//     p_status public."BillStatus" DEFAULT NULL,
//     p_category_slug TEXT DEFAULT NULL,
//     p_congress INT DEFAULT NULL,
//     p_search TEXT DEFAULT NULL,
//     p_sort_field TEXT DEFAULT 'introducedDate',
//     p_sort_dir TEXT DEFAULT 'desc'
//   ) ...
// Filtering approach:
//   WHERE (p_status IS NULL OR b."currentStatus" = p_status)
//     AND (p_congress IS NULL OR b."congress" = p_congress)
//     AND (p_category_slug IS NULL OR EXISTS (
//          SELECT 1 FROM public."_BillCategories" bc JOIN public."Category" c ON c.id = bc."B"
//          WHERE bc."A" = b.id AND c.slug = p_category_slug))
//     AND (p_search IS NULL OR (
//          b.title ILIKE '%' || p_search || '%' OR b."officialTitle" ILIKE '%' || p_search || '%'))
// Dynamic ordering (safe list):
//   ORDER BY CASE WHEN p_sort_field = 'updatedAt' THEN b."updatedAt" ELSE b."introducedDate" END
//            || (tie-break) , b.id
// When implemented: remove Prisma fallback path below and unify metadata source to 'function:get_bills'.

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.string().optional(),
  category: z.string().optional(),
  congress: z.coerce.number().optional(),
  search: z.string().optional(),
  sortBy: z.enum(["date", "relevance", "status"]).default("date"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

interface FunctionRow {
  id: string;
  kind: string; // 'bill'
  billType: string;
  billNumber: string;
  congress: number;
  title: string;
  currentStatus: string | null;
  sort_date: string | null;
  presidentName: string | null;
  categories: unknown; // JSONB array
  sponsor: unknown; // JSONB object
  total_count: bigint; // window count
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const params = querySchema.parse(Object.fromEntries(searchParams));

    const {
      page,
      limit,
      status,
      category,
      congress,
      search,
      sortBy,
      sortOrder,
    } = params;
    const skip = (page - 1) * limit;

    const isSimplePath =
      !status &&
      !category &&
      !congress &&
      !search &&
      sortBy === "date" &&
      sortOrder === "desc";

    if (isSimplePath) {
      // SQL function path
      try {
        const rows = await db.$queryRaw<
          FunctionRow[]
        >`SELECT * FROM get_bills(${skip}::int, ${limit}::int)`;
        const total = rows[0]?.total_count ? Number(rows[0].total_count) : 0;
        // Map rows (already lean) to legacy list shape (keeping field names aligned with prior Prisma response where feasible)
        const data = rows.map((r) => ({
          id: r.id,
          billType: r.billType,
          billNumber: r.billNumber,
          congress: r.congress,
          title: r.title,
          currentStatus: r.currentStatus,
          introducedDate: r.sort_date,
          sponsor: r.sponsor ? r.sponsor : null,
          categories: r.categories ? r.categories : [],
          // Summaries intentionally omitted (was limited to 1 BRIEF previously) to stay consistent with new lean list approach
        }));
        return NextResponse.json({
          data,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
          meta: { source: "function:get_bills" },
        });
      } catch (fnErr) {
        console.warn(
          "[api/bills] get_bills function failed, falling back to Prisma:",
          (fnErr as Error).message
        );
        // fall through to Prisma path
      }
    }

    // Prisma fallback (filtered or function error)
    const where: Record<string, unknown> = {};
    if (status) where.currentStatus = status;
    if (congress) where.congress = congress;
    if (category) {
      where.categories = { some: { slug: category } };
    }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { officialTitle: { contains: search, mode: "insensitive" } },
      ];
    }

    const orderByField = sortBy === "date" ? "introducedDate" : "updatedAt";
    const orderBy = { [orderByField]: sortOrder } as const;

    const [bills, total] = await Promise.all([
      db.bill.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          sponsor: {
            select: { fullName: true, party: true, state: true },
          },
          categories: {
            select: { id: true, name: true, slug: true, color: true },
          },
          summaries: { where: { summaryType: "BRIEF" }, take: 1 },
          _count: { select: { votes: true, amendments: true } },
        },
      }),
      db.bill.count({ where }),
    ]);

    return NextResponse.json({
      data: bills,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      meta: { source: "prisma:fallback" },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: error.issues },
        { status: 400 }
      );
    }
    console.error("[api/bills] Error fetching bills:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
