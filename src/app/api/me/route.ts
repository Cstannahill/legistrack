import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/server";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? undefined;
  const cookie = req.headers.get("cookie") ?? undefined;
  const user = await getCurrentUser(auth, cookie);
  if (!user) {
    return NextResponse.json({ user: null }, { status: 200 });
  }
  // Only expose safe fields
  const safe = {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
  };
  return NextResponse.json({ user: safe });
}
