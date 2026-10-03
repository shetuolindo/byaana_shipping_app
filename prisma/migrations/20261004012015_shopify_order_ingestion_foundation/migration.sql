-- AlterTable
ALTER TABLE "Address" ALTER COLUMN "name" DROP NOT NULL,
ALTER COLUMN "countryCode" DROP NOT NULL,
ALTER COLUMN "address1" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "shopifyCancelReason" TEXT,
ADD COLUMN     "shopifyCancelledAt" TIMESTAMP(3),
ADD COLUMN     "shopifyFinancialStatus" TEXT,
ADD COLUMN     "shopifyFulfillmentStatus" TEXT,
ADD COLUMN     "shopifyUpdatedAt" TIMESTAMP(3),
ALTER COLUMN "customerName" DROP NOT NULL;

-- AlterTable
ALTER TABLE "OrderItem" ALTER COLUMN "sku" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_orderId_shopifyLineItemId_key" ON "OrderItem"("orderId", "shopifyLineItemId");
