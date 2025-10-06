import { NextResponse } from "next/server";
import { db } from "../../../../lib/db";
import { getCurrentUser } from "../../../../lib/server";

export async function POST(req: Request) {
  const user = await getCurrentUser(
    req.headers.get("authorization") ?? undefined,
    req.headers.get("cookie") ?? undefined
  );
  if (!user)
    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTH" },
      { status: 401 }
    );

  const body = await req.json();
  const { billId } = body;
  if (!billId)
    return NextResponse.json(
      { error: "Missing billId", code: "MISSING_BILLID" },
      { status: 400 }
    );

  // ensure bill exists
  const bill = await db.bill.findUnique({ where: { id: billId } });
  if (!bill)
    return NextResponse.json(
      { error: "Bill not found", code: "NOT_FOUND" },
      { status: 404 }
    );
  const tracking = await db.billTracking.upsert({
    where: { userId_billId: { userId: user.id, billId } },
    update: {},
    create: { userId: user.id, billId },
  });

  return NextResponse.json({ tracking: true, billId: tracking.billId });
}
