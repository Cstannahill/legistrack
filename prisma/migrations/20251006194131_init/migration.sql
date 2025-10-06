-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('INTRODUCED', 'REFERRED_TO_COMMITTEE', 'REPORTED_BY_COMMITTEE', 'PASSED_HOUSE', 'PASSED_SENATE', 'RESOLVING_DIFFERENCES', 'PRESENTED_TO_PRESIDENT', 'BECAME_LAW', 'VETOED', 'FAILED');

-- CreateEnum
CREATE TYPE "CompanionType" AS ENUM ('IDENTICAL', 'RELATED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ExecutiveOrderType" AS ENUM ('EXECUTIVE_ORDER', 'PRESIDENTIAL_MEMORANDUM', 'PROCLAMATION', 'DETERMINATION');

-- CreateEnum
CREATE TYPE "SummaryType" AS ENUM ('BRIEF', 'STANDARD', 'DETAILED', 'ELI5', 'KEY_CHANGES');

-- CreateEnum
CREATE TYPE "Chamber" AS ENUM ('HOUSE', 'SENATE');

-- CreateEnum
CREATE TYPE "VotePosition" AS ENUM ('YEA', 'NAY', 'PRESENT', 'NOT_VOTING');

-- CreateEnum
CREATE TYPE "SubscriptionType" AS ENUM ('ALL_BILLS', 'SPECIFIC_CATEGORIES', 'KEYWORD_MATCH', 'MEMBER_ACTIVITY', 'EXECUTIVE_ORDERS');

-- CreateEnum
CREATE TYPE "NotificationFrequency" AS ENUM ('INSTANT', 'DAILY_DIGEST', 'WEEKLY_DIGEST');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Bill" (
    "id" TEXT NOT NULL,
    "billType" TEXT NOT NULL,
    "billNumber" INTEGER NOT NULL,
    "congress" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "officialTitle" TEXT,
    "shortTitle" TEXT,
    "introducedDate" TIMESTAMP(3) NOT NULL,
    "currentStatus" "BillStatus" NOT NULL,
    "statusDate" TIMESTAMP(3) NOT NULL,
    "lawNumber" TEXT,
    "fullText" TEXT,
    "fullTextUrl" TEXT,
    "sponsorId" TEXT,
    "sourceUrl" TEXT,
    "lastFetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "ExecutiveOrder" (
    "id" TEXT NOT NULL,
    "orderNumber" INTEGER NOT NULL,
    "executiveOrderType" "ExecutiveOrderType" NOT NULL,
    "title" TEXT NOT NULL,
    "signingDate" TIMESTAMP(3) NOT NULL,
    "publicationDate" TIMESTAMP(3),
    "fullText" TEXT,
    "fullTextUrl" TEXT,
    "federalRegisterUrl" TEXT,
    "presidentName" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "lastFetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecutiveOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Summary" (
    "id" TEXT NOT NULL,
    "billId" TEXT,
    "executiveOrderId" TEXT,
    "summaryType" "SummaryType" NOT NULL,
    "content" TEXT NOT NULL,
    "keyPoints" TEXT[],
    "impactAreas" TEXT[],
    "aiModel" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Summary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "color" TEXT,
    "icon" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "bioguideId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "chamber" "Chamber" NOT NULL,
    "state" TEXT NOT NULL,
    "district" INTEGER,
    "party" TEXT NOT NULL,
    "termStart" TIMESTAMP(3) NOT NULL,
    "termEnd" TIMESTAMP(3),
    "imageUrl" TEXT,
    "websiteUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "rollCallNumber" INTEGER NOT NULL,
    "chamber" "Chamber" NOT NULL,
    "congress" INTEGER NOT NULL,
    "session" INTEGER NOT NULL,
    "voteDate" TIMESTAMP(3) NOT NULL,
    "voteQuestion" TEXT NOT NULL,
    "voteResult" TEXT NOT NULL,
    "yesVotes" INTEGER NOT NULL,
    "noVotes" INTEGER NOT NULL,
    "presentVotes" INTEGER NOT NULL,
    "notVotingCount" INTEGER NOT NULL,
    "billId" TEXT,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberVote" (
    "id" TEXT NOT NULL,
    "voteId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "position" "VotePosition" NOT NULL,

    CONSTRAINT "MemberVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Amendment" (
    "id" TEXT NOT NULL,
    "amendmentNumber" TEXT NOT NULL,
    "amendmentType" TEXT NOT NULL,
    "congress" INTEGER NOT NULL,
    "purpose" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL,
    "statusDate" TIMESTAMP(3),
    "billId" TEXT NOT NULL,
    "sponsorId" TEXT,
    "proposedDate" TIMESTAMP(3) NOT NULL,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Amendment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "actionDate" TIMESTAMP(3) NOT NULL,
    "actionCode" TEXT,
    "actionType" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "passwordHash" TEXT,
    "name" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "notificationPreferences" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notifyOnStatusChange" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnAllActions" BOOLEAN NOT NULL DEFAULT false,
    "emailNotifications" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillTracking" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillTracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
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

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscriptionType" "SubscriptionType" NOT NULL,
    "categoryIds" TEXT[],
    "keywords" TEXT[],
    "memberIds" TEXT[],
    "frequency" "NotificationFrequency" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "itemsFailed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "metadata" JSONB,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_BillCategories" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_BillCategories_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_Cosponsored" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_Cosponsored_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ExecutiveOrderCategories" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ExecutiveOrderCategories_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "Bill_billType_billNumber_idx" ON "Bill"("billType", "billNumber");

-- CreateIndex
CREATE INDEX "Bill_currentStatus_idx" ON "Bill"("currentStatus");

-- CreateIndex
CREATE INDEX "Bill_introducedDate_idx" ON "Bill"("introducedDate");

-- CreateIndex
CREATE INDEX "Bill_introducedDate_id_idx" ON "Bill"("introducedDate", "id");

-- CreateIndex
CREATE INDEX "Bill_congress_idx" ON "Bill"("congress");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_congress_billType_billNumber_key" ON "Bill"("congress", "billType", "billNumber");

-- CreateIndex
CREATE INDEX "CompanionBill_sourceBillId_idx" ON "CompanionBill"("sourceBillId");

-- CreateIndex
CREATE INDEX "CompanionBill_companionBillId_idx" ON "CompanionBill"("companionBillId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanionBill_sourceBillId_companionBillId_key" ON "CompanionBill"("sourceBillId", "companionBillId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutiveOrder_orderNumber_key" ON "ExecutiveOrder"("orderNumber");

-- CreateIndex
CREATE INDEX "ExecutiveOrder_signingDate_idx" ON "ExecutiveOrder"("signingDate");

-- CreateIndex
CREATE INDEX "ExecutiveOrder_signingDate_id_idx" ON "ExecutiveOrder"("signingDate", "id");

-- CreateIndex
CREATE INDEX "Summary_billId_idx" ON "Summary"("billId");

-- CreateIndex
CREATE INDEX "Summary_executiveOrderId_idx" ON "Summary"("executiveOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Member_bioguideId_key" ON "Member"("bioguideId");

-- CreateIndex
CREATE INDEX "Member_bioguideId_idx" ON "Member"("bioguideId");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_congress_chamber_rollCallNumber_key" ON "Vote"("congress", "chamber", "rollCallNumber");

-- CreateIndex
CREATE UNIQUE INDEX "MemberVote_voteId_memberId_key" ON "MemberVote"("voteId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "Amendment_congress_amendmentType_amendmentNumber_key" ON "Amendment"("congress", "amendmentType", "amendmentNumber");

-- CreateIndex
CREATE INDEX "Action_billId_actionDate_idx" ON "Action"("billId", "actionDate");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE INDEX "NotificationPreference_userId_idx" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE INDEX "BillTracking_userId_idx" ON "BillTracking"("userId");

-- CreateIndex
CREATE INDEX "BillTracking_billId_idx" ON "BillTracking"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "BillTracking_userId_billId_key" ON "BillTracking"("userId", "billId");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Subscription_userId_idx" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "JobRun_jobName_startedAt_idx" ON "JobRun"("jobName", "startedAt");

-- CreateIndex
CREATE INDEX "_BillCategories_B_index" ON "_BillCategories"("B");

-- CreateIndex
CREATE INDEX "_Cosponsored_B_index" ON "_Cosponsored"("B");

-- CreateIndex
CREATE INDEX "_ExecutiveOrderCategories_B_index" ON "_ExecutiveOrderCategories"("B");

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanionBill" ADD CONSTRAINT "CompanionBill_companionBillId_fkey" FOREIGN KEY ("companionBillId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanionBill" ADD CONSTRAINT "CompanionBill_sourceBillId_fkey" FOREIGN KEY ("sourceBillId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Summary" ADD CONSTRAINT "Summary_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Summary" ADD CONSTRAINT "Summary_executiveOrderId_fkey" FOREIGN KEY ("executiveOrderId") REFERENCES "ExecutiveOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberVote" ADD CONSTRAINT "MemberVote_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberVote" ADD CONSTRAINT "MemberVote_voteId_fkey" FOREIGN KEY ("voteId") REFERENCES "Vote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Amendment" ADD CONSTRAINT "Amendment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillTracking" ADD CONSTRAINT "BillTracking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillTracking" ADD CONSTRAINT "BillTracking_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BillCategories" ADD CONSTRAINT "_BillCategories_A_fkey" FOREIGN KEY ("A") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BillCategories" ADD CONSTRAINT "_BillCategories_B_fkey" FOREIGN KEY ("B") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_Cosponsored" ADD CONSTRAINT "_Cosponsored_A_fkey" FOREIGN KEY ("A") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_Cosponsored" ADD CONSTRAINT "_Cosponsored_B_fkey" FOREIGN KEY ("B") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ExecutiveOrderCategories" ADD CONSTRAINT "_ExecutiveOrderCategories_A_fkey" FOREIGN KEY ("A") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ExecutiveOrderCategories" ADD CONSTRAINT "_ExecutiveOrderCategories_B_fkey" FOREIGN KEY ("B") REFERENCES "ExecutiveOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
