-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "readAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "mediaId" TEXT,
ADD COLUMN     "mimeType" TEXT;
