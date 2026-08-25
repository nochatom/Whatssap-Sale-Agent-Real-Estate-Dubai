-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "campaignFollowUpEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "FollowUp" ADD COLUMN "sequenceStep" INTEGER;
