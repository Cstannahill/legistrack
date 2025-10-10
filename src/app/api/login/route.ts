import { NextResponse } from "next/server";
import { db } from "../../../lib/db";
import { verifyPassword, signToken } from "../../../lib/auth";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { username, password } = body;
    if (!username || !password) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // find by username or email
    const user = await db.user.findFirst({
      where: { OR: [{ username }, { email: username }] },
    });
    if (!user || !user.passwordHash) {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      );
    }
    const ok = await verifyPassword(password, user.passwordHash!);
    if (!ok) {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      );
    }

    const token = signToken({ userId: user.id });

    // set cookie (HttpOnly) so client JavaScript cannot read the token
    const res = NextResponse.json({ userId: user.id });
    // max-age in seconds for 7 days
    const maxAge = 60 * 60 * 24 * 7;
    const isSecure = process.env.NODE_ENV === "production";
    res.headers.set(
      "Set-Cookie",
      `legistrack_token=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${
        isSecure ? "; Secure" : ""
      }`
    );
    return res;
  } catch (err) {
    const msg =
      err && typeof err === "object" && "message" in err
        ? (err as any).message
        : String(err);
    return NextResponse.json({ error: msg ?? "Server error" }, { status: 500 });
  }
}
