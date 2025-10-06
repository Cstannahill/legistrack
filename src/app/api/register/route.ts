import { NextResponse } from "next/server";
import { db } from "../../../lib/db";
import { hashPassword, signToken } from "../../../lib/auth";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { username, password, email } = body;
    if (!username || !password || !email) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // basic email validation
    const emailRegex = /\S+@\S+\.\S+/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 }
      );
    }

    // check existing
    const existing = await db.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });
    if (existing) {
      return NextResponse.json(
        { error: "User with that email or username already exists" },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);
    const user = await db.user.create({
      data: { username, email, passwordHash },
    });

    const token = signToken({ userId: user.id });
    const res = NextResponse.json({
      userId: user.id,
      message: "Registration successful",
    });
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
