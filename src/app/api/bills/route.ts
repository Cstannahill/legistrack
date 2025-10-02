// API Route: GET /api/bills - List bills with filtering and pagination
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";

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

    // Build where clause
    const where: Record<string, unknown> = {};

    if (status) where.currentStatus = status;
    if (congress) where.congress = congress;
    if (category) {
      where.categories = {
        some: { slug: category },
      };
    }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { officialTitle: { contains: search, mode: "insensitive" } },
      ];
    }

    // Build orderBy clause
    const orderByField = sortBy === "date" ? "introducedDate" : "updatedAt";
    const orderBy = { [orderByField]: sortOrder };

    // Execute query
    const [bills, total] = await Promise.all([
      db.bill.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          sponsor: {
            select: {
              fullName: true,
              party: true,
              state: true,
            },
          },
          categories: {
            select: {
              id: true,
              name: true,
              slug: true,
              color: true,
            },
          },
          summaries: {
            where: { summaryType: "BRIEF" },
            take: 1,
          },
          _count: {
            select: {
              votes: true,
              amendments: true,
            },
          },
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
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Error fetching bills:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
