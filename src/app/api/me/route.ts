import { NextResponse } from "next/server";
import { getCurrentUserFromHeader } from "../../../lib/server";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? undefined;
  const user = await getCurrentUserFromHeader(auth);
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
