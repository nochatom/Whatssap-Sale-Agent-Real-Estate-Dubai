-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "followUpDelayMinutes" INTEGER;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "senderPhoneNumberId" TEXT;
