import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "./db";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret";
const JWT_EXPIRES_IN = "7d";

export async function hashPassword(password: string) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: object) {
  return (jwt.sign as any)(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function signResetToken(payload: object, expiresIn = "1h") {
  return (jwt.sign as any)(payload, JWT_SECRET, { expiresIn });
}

export function verifyToken(token: string) {
  try {
    return (jwt.verify as any)(token, JWT_SECRET) as any;
  } catch (e) {
    return null;
  }
}

export async function createUser({
  username,
  email,
  password,
}: {
  username: string;
  email: string;
  password: string;
}) {
  const passwordHash = await hashPassword(password);
  const user = await db.user.create({
    data: { username, email, passwordHash },
  });
  return user;
}
