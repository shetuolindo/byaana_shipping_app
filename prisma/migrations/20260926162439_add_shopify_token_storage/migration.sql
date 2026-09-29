-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "shopifyAccessTokenEncrypted" TEXT,
ADD COLUMN     "shopifyConnectedAt" TIMESTAMP(3);
