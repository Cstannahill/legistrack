// API Route: GET /api/bills/[id] - Get bill details
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const bill = await db.bill.findUnique({
      where: { id },
      include: {
        sponsor: true,
        cosponsors: {
          take: 10,
        },
        summaries: {
          orderBy: { createdAt: "desc" },
        },
        categories: true,
        votes: {
          orderBy: { voteDate: "desc" },
          include: {
            individualVotes: {
              include: {
                member: true,
              },
              take: 10,
            },
          },
        },
        amendments: {
          orderBy: { proposedDate: "desc" },
        },
        actions: {
          orderBy: { actionDate: "desc" },
          take: 50,
        },
      },
    });

    if (!bill) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }

    return NextResponse.json({ data: bill });
  } catch (error) {
    console.error("Error fetching bill:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
