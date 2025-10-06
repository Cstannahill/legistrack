import { verifyToken } from "./auth";
import { db } from "./db";

export async function getCurrentUserFromHeader(authHeader?: string) {
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  if (parts.length !== 2) return null;
  const token = parts[1];
  const payload = verifyToken(token);
  if (!payload || !payload.userId) return null;
  const user = await db.user.findUnique({ where: { id: payload.userId } });
  return user;
}
