// Prisma client singleton pattern
// Prevents multiple instances in development

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const maybePatchPoolerUrl = (url?: string) => {
  if (!url) return url;
  if (!/pooler\.supabase\.com/.test(url) || url.includes("pgbouncer=true")) {
    return url;
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}pgbouncer=true&connection_limit=1`;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
    datasources: {
      db: {
        url: maybePatchPoolerUrl(process.env.DATABASE_URL),
      },
    },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
