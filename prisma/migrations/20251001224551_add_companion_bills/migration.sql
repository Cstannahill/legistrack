-- CreateEnum
CREATE TYPE "CompanionType" AS ENUM ('IDENTICAL', 'RELATED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "CompanionBill" (
    "id" TEXT NOT NULL,
    "sourceBillId" TEXT NOT NULL,
    "companionBillId" TEXT NOT NULL,
    "relationshipType" "CompanionType" NOT NULL DEFAULT 'IDENTICAL',
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanionBill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanionBill_sourceBillId_idx" ON "CompanionBill"("sourceBillId");

-- CreateIndex
CREATE INDEX "CompanionBill_companionBillId_idx" ON "CompanionBill"("companionBillId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanionBill_sourceBillId_companionBillId_key" ON "CompanionBill"("sourceBillId", "companionBillId");

-- AddForeignKey
ALTER TABLE "CompanionBill" ADD CONSTRAINT "CompanionBill_sourceBillId_fkey" FOREIGN KEY ("sourceBillId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanionBill" ADD CONSTRAINT "CompanionBill_companionBillId_fkey" FOREIGN KEY ("companionBillId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
