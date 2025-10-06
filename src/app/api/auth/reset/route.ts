import { NextResponse } from "next/server";
import { verifyToken, hashPassword, signToken } from "../../../../lib/auth";
import { db } from "../../../../lib/db";

export async function POST(req: Request) {
  const { token, newPassword } = await req.json();
  if (
    !token ||
    typeof token !== "string" ||
    !newPassword ||
    typeof newPassword !== "string"
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const payload = verifyToken(token);
  if (!payload || !payload.userId) {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 }
    );
  }

  const user = await db.user.findUnique({ where: { id: payload.userId } });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const newHash = await hashPassword(newPassword);
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash },
  });

  // Sign a fresh auth token so the user is logged in after reset
  const authToken = signToken({ userId: user.id });
  return NextResponse.json({ authToken, userId: user.id });
}
