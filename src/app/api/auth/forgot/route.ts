import { NextResponse } from "next/server";
import { db } from "../../../../lib/db";
import { signResetToken } from "../../../../lib/auth";
import sendMail from "../../../../lib/mailer";

// Simple in-memory rate limiter: { key -> {count, firstSeen} }
const attempts = new Map<string, { count: number; firstSeen: number }>();
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_ATTEMPTS = 5;

function isValidEmail(email: string) {
  // basic email regex (not perfect but sufficient for server-side check)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: Request) {
  const { email } = await req.json();
  if (!email || typeof email !== "string") {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (!isValidEmail(email)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const ip =
    req.headers.get("x-forwarded-for") ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const key = `${ip}:${email}`;
  const now = Date.now();
  const record = attempts.get(key);
  if (record) {
    if (now - record.firstSeen > WINDOW_MS) {
      // reset window
      attempts.set(key, { count: 1, firstSeen: now });
    } else {
      if (record.count >= MAX_ATTEMPTS) {
        return NextResponse.json(
          { ok: false, error: "Rate limit" },
          { status: 429 }
        );
      }
      record.count += 1;
    }
  } else {
    attempts.set(key, { count: 1, firstSeen: now });
  }

  const user = await db.user.findUnique({ where: { email } });
  // Always respond 200 to avoid revealing whether the email exists
  if (!user) {
    return NextResponse.json({ ok: true });
  }

  // Create a short-lived token and send a reset email
  const token = signResetToken({ userId: user.id }, "1h");
  const resetUrl = `${
    process.env.NEXTAUTH_URL ?? "http://localhost:3000"
  }/reset-password?token=${encodeURIComponent(token)}`;
  try {
    await sendMail({
      to: user.email,
      subject: "Reset your LegisTrack password",
      text: `Click the link to reset your password: ${resetUrl}`,
      html: `<p>Click the link to reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
    });
  } catch {
    // Swallow errors and still return success so we don't reveal details
  }

  return NextResponse.json({ ok: true });
}
