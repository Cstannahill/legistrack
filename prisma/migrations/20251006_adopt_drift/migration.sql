-- Adopt existing drift without destructive changes.
-- This migration brings the migration history in line with the current live development schema.
-- It assumes the following objects ALREADY EXIST in the database:
--   Tables: BillTracking, Notification, NotificationPreference
--   Columns added to User: username, passwordHash
--   Indexes listed below may already exist; we create them IF NOT EXISTS for idempotence.
-- NOTE: PostgreSQL does not support CREATE INDEX IF NOT EXISTS for UNIQUE INDEX directly prior to v9.5; we guard with DO blocks.
-- Adjust duplicate usernames before adding the unique index if necessary.

-- 1. Ensure columns exist on User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;

-- 2. Create supporting tables if missing (no-op if they already exist)
CREATE TABLE IF NOT EXISTS "NotificationPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT UNIQUE NOT NULL,
  "notifyOnStatusChange" BOOLEAN NOT NULL DEFAULT true,
  "notifyOnAllActions" BOOLEAN NOT NULL DEFAULT false,
  "emailNotifications" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BillTracking" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "billId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillTracking_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "data" JSONB,
  "read" BOOLEAN NOT NULL DEFAULT false,
  "viaEmail" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- 3. Indices (use DO blocks for unique constraints)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'Bill_billType_billNumber_idx'
  ) THEN
    CREATE INDEX "Bill_billType_billNumber_idx" ON "Bill"("billType", "billNumber");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'Bill_introducedDate_id_idx'
  ) THEN
    CREATE INDEX "Bill_introducedDate_id_idx" ON "Bill"("introducedDate", "id");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ExecutiveOrder_signingDate_id_idx'
  ) THEN
    CREATE INDEX "ExecutiveOrder_signingDate_id_idx" ON "ExecutiveOrder"("signingDate", "id");
  END IF;
END $$;

-- Notification indices
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='Notification_createdAt_idx') THEN
    CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='Notification_userId_read_idx') THEN
    CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");
  END IF;
END $$;

-- NotificationPreference index
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='NotificationPreference_userId_idx') THEN
    CREATE INDEX "NotificationPreference_userId_idx" ON "NotificationPreference"("userId");
  END IF;
END $$;

-- BillTracking indices
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='BillTracking_userId_idx') THEN
    CREATE INDEX "BillTracking_userId_idx" ON "BillTracking"("userId");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='BillTracking_billId_idx') THEN
    CREATE INDEX "BillTracking_billId_idx" ON "BillTracking"("billId");
  END IF;
END $$;

-- Unique index on (userId, billId)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='BillTracking_userId_billId_key') THEN
    CREATE UNIQUE INDEX "BillTracking_userId_billId_key" ON "BillTracking"("userId", "billId");
  END IF;
END $$;

-- 4. Foreign keys (add if not present)
-- Foreign key constraints (idempotent via DO blocks)
DO $$ BEGIN
  BEGIN
    ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
DO $$ BEGIN
  BEGIN
    ALTER TABLE "BillTracking" ADD CONSTRAINT "BillTracking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
DO $$ BEGIN
  BEGIN
    ALTER TABLE "BillTracking" ADD CONSTRAINT "BillTracking_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
DO $$ BEGIN
  BEGIN
    ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- 5. Prepare for unique username (dedupe)
-- Strategy: For any duplicates (case-insensitive), append incremental suffixes before creating unique index.
WITH ranked AS (
  SELECT "id", "username", ROW_NUMBER() OVER (PARTITION BY LOWER("username") ORDER BY "createdAt", "id") AS rn
  FROM "User"
  WHERE "username" IS NOT NULL
)
UPDATE "User" u
SET "username" = u."username" || '_' || (r.rn - 1)
FROM ranked r
WHERE u."id" = r."id" AND r.rn > 1;

-- 6. Create unique index for username if not exists (Prisma expects constraint name pattern) 
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='User_username_key') THEN
    CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
  END IF;
END $$;

-- 7. Touch updatedAt for rows changed by the username update
UPDATE "User" SET "updatedAt" = NOW() WHERE "updatedAt" < NOW() - INTERVAL '0 seconds';

-- End migration.
