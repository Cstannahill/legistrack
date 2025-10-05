// API Route: GET /api/bills/[id] - Get bill details via SQL function
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Minimal interface representing the shape returned by get_bill_by_id.
// (Kept broad; if central type exists elsewhere, we can import later.)
interface BillJSON {
  id: string;
  billType: string;
  billNumber: string;
  congress: number;
  title: string;
  shortTitle: string | null;
  officialTitle: string | null;
  currentStatus: string | null;
  statusDate: string | null;
  introducedDate: string | null;
  lawNumber: string | null;
  fullText: string | null;
  fullTextUrl: string | null;
  sponsor: unknown;
  categories: unknown[];
  summaries: unknown[];
  actions: unknown[];
  cosponsors: unknown[];
  companionBills: unknown[];
  companionOf: unknown[];
}

// This route now delegates to the database function get_bill_by_id which returns a JSONB payload
// containing the bill plus nested related data trimmed/limited per function definition.
// This keeps API and server component detail view aligned.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Call SQL function. It returns a single JSONB row or null.
    const rows = await db.$queryRaw<
      { bill: BillJSON | null }[]
    >`SELECT get_bill_by_id(${id}::text) AS bill`;
    const bill = rows?.[0]?.bill ?? null;

    if (!bill || bill === null) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }

    return NextResponse.json({ data: bill });
  } catch (error) {
    console.error("Error fetching bill via get_bill_by_id:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// TODO (functions/filters): Once we add a companion function to fetch votes/amendments in a
// consistent JSON shape (or extend get_bill_by_id), evaluate whether this endpoint should
// support optional query params to include heavier collections or keep them trimmed by default.
