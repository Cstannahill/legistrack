-- DropForeignKey
ALTER TABLE "public"."NotificationPreference" DROP CONSTRAINT "NotificationPreference_userId_fkey";

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
