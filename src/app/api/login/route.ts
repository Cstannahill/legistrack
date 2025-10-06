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

    return NextResponse.json({ userId: user.id, authToken: token });
  } catch (err) {
    const msg =
      err && typeof err === "object" && "message" in err
        ? (err as any).message
        : String(err);
    return NextResponse.json({ error: msg ?? "Server error" }, { status: 500 });
  }
}
