import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/server";
import { db } from "../../../../lib/db";

// Dev-only route to delete the currently authenticated user. Only allowed in non-production.
export async function DELETE(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const user = await getCurrentUser(
    req.headers.get("authorization") ?? undefined,
    req.headers.get("cookie") ?? undefined
  );
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // delete user-related data first (cascade constraints may handle some)
  await db.notification.deleteMany({ where: { userId: user.id } });
  await db.notificationPreference.deleteMany({ where: { userId: user.id } });
  await db.billTracking.deleteMany({ where: { userId: user.id } });

  await db.user.delete({ where: { id: user.id } });

  return NextResponse.json({ deleted: true });
}
