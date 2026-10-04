-- CreateEnum
CREATE TYPE "ShopifySyncState" AS ENUM ('IN_SYNC', 'REVIEW_REQUIRED', 'SOURCE_DELETED');

-- AlterTable
ALTER TABLE "Order"
ADD COLUMN "shopifyLastSeenUpdatedAt" TIMESTAMP(3),
ADD COLUMN "shopifySyncState" "ShopifySyncState",
ADD COLUMN "shopifyDeletedAt" TIMESTAMP(3);

-- Backfill existing Shopify snapshots without changing operational data.
UPDATE "Order"
SET
    "shopifyLastSeenUpdatedAt" = "shopifyUpdatedAt",
    "shopifySyncState" = 'IN_SYNC'
WHERE "source" = 'SHOPIFY';

-- AlterTable
ALTER TABLE "WebhookEvent"
ADD COLUMN "shopId" TEXT,
ADD COLUMN "resourceId" TEXT,
ADD COLUMN "eventId" TEXT,
ADD COLUMN "apiVersion" TEXT,
ADD COLUMN "triggeredAt" TIMESTAMP(3),
ADD COLUMN "processingStartedAt" TIMESTAMP(3),
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN "errorCode" TEXT;

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_status_receivedAt_idx"
ON "WebhookEvent"("provider", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_shopId_resourceId_triggeredAt_idx"
ON "WebhookEvent"("shopId", "resourceId", "triggeredAt");

-- AddForeignKey
ALTER TABLE "WebhookEvent"
ADD CONSTRAINT "WebhookEvent_shopId_fkey"
FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
