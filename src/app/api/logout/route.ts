import { NextResponse } from "next/server";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  // Clear the cookie by setting Max-Age=0
  const isSecure = process.env.NODE_ENV === "production";
  res.headers.set(
    "Set-Cookie",
    `legistrack_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${
      isSecure ? "; Secure" : ""
    }`
  );
  return res;
}
