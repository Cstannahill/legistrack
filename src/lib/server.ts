import { verifyToken } from "./auth";
import { db } from "./db";

/**
 * Get the current user from either an Authorization header value or an HttpOnly cookie.
 * If `authHeaderOrCookie` is provided and looks like 'Bearer <token>' it will be used.
 * Otherwise, if `cookieHeader` is provided and contains a cookie named 'legistrack_token' that value will be used.
 */
export async function getCurrentUser(
  authHeader?: string,
  cookieHeader?: string
) {
  let token: string | undefined | null = undefined;

  if (authHeader) {
    const parts = authHeader.split(" ");
    if (parts.length === 2 && parts[0] === "Bearer") token = parts[1];
  }

  if (!token && cookieHeader) {
    // parse cookie header for legistrack_token
    const cookies = cookieHeader.split(";").map((c) => c.trim());
    for (const c of cookies) {
      if (c.startsWith("legistrack_token=")) {
        token = c.substring("legistrack_token=".length);
        break;
      }
    }
  }

  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload || !payload.userId) return null;
  const user = await db.user.findUnique({ where: { id: payload.userId } });
  return user;
}
