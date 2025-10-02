// API Route: GET /api/search - Search across bills and executive orders
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");
  const type = searchParams.get("type") || "all"; // 'bills', 'executive-orders', 'all'

  if (!query || query.length < 2) {
    return NextResponse.json(
      { error: "Query must be at least 2 characters" },
      { status: 400 }
    );
  }

  try {
    const results: {
      bills: unknown[];
      executiveOrders: unknown[];
    } = {
      bills: [],
      executiveOrders: [],
    };

    if (type === "bills" || type === "all") {
      // Check if query is wrapped in quotes for exact word matching
      const quotedMatch = query.match(/^["'](.+)["']$/);
      const isExactWordMatch = !!quotedMatch;
      const searchTerm = quotedMatch ? quotedMatch[1] : query;

      // Parse potential bill number from query (e.g., "HR 4398", "S 2309")
      const billNumberMatch = searchTerm.match(/^([A-Z]+)\s*(\d+)$/i);
      let billTypeQuery: string | undefined;
      let billNumberQuery: number | undefined;

      if (billNumberMatch) {
        billTypeQuery = billNumberMatch[1].toUpperCase();
        billNumberQuery = parseInt(billNumberMatch[2], 10);
      }

      const searchConditions: Array<{
        title?: {
          contains?: string;
          startsWith?: string;
          endsWith?: string;
          mode: "insensitive";
        };
        officialTitle?: {
          contains?: string;
          startsWith?: string;
          endsWith?: string;
          mode: "insensitive";
        };
        shortTitle?: {
          contains?: string;
          startsWith?: string;
          endsWith?: string;
          mode: "insensitive";
        };
        AND?: Array<{
          billType?: { equals: string; mode: "insensitive" };
          billNumber?: number;
        }>;
      }> = [];

      // If exact word match (quoted), use regex with word boundaries
      if (isExactWordMatch) {
        // For exact word matching, search for word with spaces/punctuation boundaries
        // This approximates word boundary matching in Prisma
        searchConditions.push(
          { title: { contains: ` ${searchTerm} `, mode: "insensitive" } },
          { title: { startsWith: `${searchTerm} `, mode: "insensitive" } },
          { title: { endsWith: ` ${searchTerm}`, mode: "insensitive" } },
          {
            officialTitle: { contains: ` ${searchTerm} `, mode: "insensitive" },
          },
          {
            officialTitle: {
              startsWith: `${searchTerm} `,
              mode: "insensitive",
            },
          },
          {
            officialTitle: { endsWith: ` ${searchTerm}`, mode: "insensitive" },
          },
          { shortTitle: { contains: ` ${searchTerm} `, mode: "insensitive" } },
          { shortTitle: { startsWith: `${searchTerm} `, mode: "insensitive" } },
          { shortTitle: { endsWith: ` ${searchTerm}`, mode: "insensitive" } }
        );
      } else {
        // Regular contains search
        searchConditions.push(
          { title: { contains: searchTerm, mode: "insensitive" } },
          { officialTitle: { contains: searchTerm, mode: "insensitive" } },
          { shortTitle: { contains: searchTerm, mode: "insensitive" } }
        );
      }

      // If query matches bill number format, add exact bill number search
      if (billTypeQuery && billNumberQuery) {
        searchConditions.push({
          AND: [
            { billType: { equals: billTypeQuery, mode: "insensitive" } },
            { billNumber: billNumberQuery },
          ],
        });
      }

      results.bills = await db.bill.findMany({
        where: {
          OR: searchConditions,
        },
        take: 10,
        include: {
          sponsor: true,
          categories: true,
          summaries: {
            where: { summaryType: "BRIEF" },
            take: 1,
          },
        },
        orderBy: { introducedDate: "desc" },
      });
    }

    if (type === "executive-orders" || type === "all") {
      results.executiveOrders = await db.executiveOrder.findMany({
        where: {
          title: { contains: query, mode: "insensitive" },
        },
        take: 10,
        include: {
          categories: true,
          summaries: {
            where: { summaryType: "BRIEF" },
            take: 1,
          },
        },
        orderBy: { signingDate: "desc" },
      });
    }

    return NextResponse.json({
      query,
      results,
      totalResults: results.bills.length + results.executiveOrders.length,
    });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
