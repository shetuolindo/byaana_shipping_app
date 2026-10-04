import {
  OrderSource,
  OrderStatus,
  Prisma,
  ShopifySyncState,
  type PrismaClient,
} from "@prisma/client";
import {
  type NormalizedShopifyOrder,
  type PersistedShopifyOrderSnapshot,
  type ShopifyOrderPersistence,
  type ShopifySnapshotChangeCategory,
  type ShopifyWebhookSyncPersistence,
} from "./order-ingestion.ts";

function incompatibleExistingSnapshot(existing: {
  id: string;
  shopId: string | null;
  source: string;
  internalStatus: string;
}): PersistedShopifyOrderSnapshot {
  return {
    id: existing.id,
    shopId: existing.shopId,
    source: "INCOMPATIBLE",
    internalStatus: existing.internalStatus,
  } as PersistedShopifyOrderSnapshot;
}

export function createPrismaShopifyOrderPersistence(
  client: PrismaClient,
): ShopifyOrderPersistence & ShopifyWebhookSyncPersistence {
  return {
    transaction: (operation) => client.$transaction(async (tx) => operation({
      async findByShopifyOrderId(shopifyOrderId): Promise<PersistedShopifyOrderSnapshot | null> {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "Order"
          WHERE "shopifyOrderId" = ${shopifyOrderId}
          FOR UPDATE
        `);
        const existing = await tx.order.findUnique({
          where: { shopifyOrderId },
          select: {
            id: true,
            shopId: true,
            source: true,
            internalStatus: true,
            shopifyOrderId: true,
            orderNumber: true,
            shopifyOrderNumber: true,
            externalCreatedAt: true,
            shopifyUpdatedAt: true,
            shopifyLastSeenUpdatedAt: true,
            shopifySyncState: true,
            shopifyDeletedAt: true,
            shopifyFinancialStatus: true,
            shopifyFulfillmentStatus: true,
            shopifyCancelledAt: true,
            shopifyCancelReason: true,
            customerName: true,
            customerEmail: true,
            customerPhone: true,
            currency: true,
            subtotal: true,
            shippingAmount: true,
            taxAmount: true,
            totalAmount: true,
            address: {
              select: {
                name: true,
                company: true,
                phone: true,
                email: true,
                countryCode: true,
                province: true,
                city: true,
                district: true,
                address1: true,
                address2: true,
                postalCode: true,
              },
            },
            items: {
              select: {
                shopifyLineItemId: true,
                sku: true,
                name: true,
                quantity: true,
                unitPrice: true,
              },
            },
            _count: { select: { shipments: true } },
          },
        });
        if (!existing || !existing.shopifyOrderId || !existing.shopifyOrderNumber || !existing.externalCreatedAt
          || !existing.shopifyUpdatedAt || !existing.shopifyFulfillmentStatus
          || !existing.currency || !existing.subtotal || !existing.shippingAmount || !existing.taxAmount
          || !existing.totalAmount || !existing.address
          || existing.items.some((item) => !item.shopifyLineItemId || !item.unitPrice)) {
          return existing ? incompatibleExistingSnapshot(existing) : null;
        }
        return {
          id: existing.id,
          shopId: existing.shopId,
          source: existing.source,
          internalStatus: existing.internalStatus,
          shopifyOrderId: existing.shopifyOrderId,
          orderNumber: existing.orderNumber,
          shopifyOrderNumber: existing.shopifyOrderNumber,
          externalCreatedAt: existing.externalCreatedAt.toISOString(),
          shopifyUpdatedAt: existing.shopifyUpdatedAt.toISOString(),
          shopifyLastSeenUpdatedAt: existing.shopifyLastSeenUpdatedAt?.toISOString() ?? null,
          shopifySyncState: existing.shopifySyncState,
          shopifyDeletedAt: existing.shopifyDeletedAt?.toISOString() ?? null,
          shopifyFinancialStatus: existing.shopifyFinancialStatus,
          shopifyFulfillmentStatus: existing.shopifyFulfillmentStatus,
          shopifyCancelledAt: existing.shopifyCancelledAt?.toISOString() ?? null,
          shopifyCancelReason: existing.shopifyCancelReason,
          customerName: existing.customerName,
          customerEmail: existing.customerEmail,
          customerPhone: existing.customerPhone,
          currency: existing.currency,
          subtotal: existing.subtotal.toFixed(2),
          shippingAmount: existing.shippingAmount.toFixed(2),
          taxAmount: existing.taxAmount.toFixed(2),
          totalAmount: existing.totalAmount.toFixed(2),
          address: existing.address,
          items: existing.items.map((item) => ({
            shopifyLineItemId: item.shopifyLineItemId!,
            sku: item.sku,
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice!.toFixed(2),
          })),
          hasShipments: existing._count.shipments > 0,
        };
      },

      async createShopifyOrder(order: NormalizedShopifyOrder, shopId: string) {
        const sourceUpdatedAt = new Date(order.shopifyUpdatedAt);
        const created = await tx.order.create({
          data: {
            orderNumber: order.orderNumber,
            shopId,
            source: OrderSource.SHOPIFY,
            internalStatus: OrderStatus.NEW,
            shopifyOrderId: order.shopifyOrderId,
            shopifyOrderNumber: order.shopifyOrderNumber,
            externalCreatedAt: new Date(order.externalCreatedAt),
            shopifyUpdatedAt: sourceUpdatedAt,
            shopifyLastSeenUpdatedAt: sourceUpdatedAt,
            shopifySyncState: ShopifySyncState.IN_SYNC,
            shopifyFinancialStatus: order.shopifyFinancialStatus,
            shopifyFulfillmentStatus: order.shopifyFulfillmentStatus,
            shopifyCancelledAt: order.shopifyCancelledAt ? new Date(order.shopifyCancelledAt) : null,
            shopifyCancelReason: order.shopifyCancelReason,
            customerName: order.customerName,
            customerEmail: order.customerEmail,
            customerPhone: order.customerPhone,
            currency: order.currency,
            subtotal: new Prisma.Decimal(order.subtotal),
            shippingAmount: new Prisma.Decimal(order.shippingAmount),
            taxAmount: new Prisma.Decimal(order.taxAmount),
            totalAmount: new Prisma.Decimal(order.totalAmount),
            address: { create: order.address },
            items: {
              create: order.items.map((item) => ({
                shopifyLineItemId: item.shopifyLineItemId,
                sku: item.sku,
                name: item.name,
                quantity: item.quantity,
                unitPrice: new Prisma.Decimal(item.unitPrice),
              })),
            },
            statusHistory: {
              create: {
                toStatus: OrderStatus.NEW,
                reason: "Shopify order imported",
              },
            },
          },
          select: { id: true },
        });
        await tx.auditLog.create({
          data: {
            action: "SHOPIFY_ORDER_IMPORTED",
            entityType: "Order",
            entityId: created.id,
            metadata: { source: "SHOPIFY", shopifyOrderId: order.shopifyOrderId },
          },
        });
        return created;
      },

      async recordShopifyObservation(orderId: string, order: NormalizedShopifyOrder) {
        await tx.order.update({
          where: { id: orderId },
          data: { shopifyLastSeenUpdatedAt: new Date(order.shopifyUpdatedAt) },
        });
      },

      async applyShopifySnapshot(
        orderId: string,
        order: NormalizedShopifyOrder,
        changedCategories: ShopifySnapshotChangeCategory[],
      ) {
        const sourceUpdatedAt = new Date(order.shopifyUpdatedAt);
        await tx.order.update({
          where: { id: orderId },
          data: {
            shopifyOrderNumber: order.shopifyOrderNumber,
            externalCreatedAt: new Date(order.externalCreatedAt),
            shopifyUpdatedAt: sourceUpdatedAt,
            shopifyLastSeenUpdatedAt: sourceUpdatedAt,
            shopifySyncState: ShopifySyncState.IN_SYNC,
            shopifyDeletedAt: null,
            shopifyFinancialStatus: order.shopifyFinancialStatus,
            shopifyFulfillmentStatus: order.shopifyFulfillmentStatus,
            shopifyCancelledAt: order.shopifyCancelledAt ? new Date(order.shopifyCancelledAt) : null,
            shopifyCancelReason: order.shopifyCancelReason,
            customerName: order.customerName,
            customerEmail: order.customerEmail,
            customerPhone: order.customerPhone,
            currency: order.currency,
            subtotal: new Prisma.Decimal(order.subtotal),
            shippingAmount: new Prisma.Decimal(order.shippingAmount),
            taxAmount: new Prisma.Decimal(order.taxAmount),
            totalAmount: new Prisma.Decimal(order.totalAmount),
          },
        });
        await tx.address.upsert({
          where: { orderId },
          update: order.address,
          create: { orderId, ...order.address },
        });

        const incomingIds = order.items.map((item) => item.shopifyLineItemId);
        await tx.orderItem.deleteMany({
          where: {
            orderId,
            shopifyLineItemId: { not: null, notIn: incomingIds },
          },
        });
        for (const item of order.items) {
          await tx.orderItem.upsert({
            where: {
              orderId_shopifyLineItemId: { orderId, shopifyLineItemId: item.shopifyLineItemId },
            },
            update: {
              sku: item.sku,
              name: item.name,
              quantity: item.quantity,
              unitPrice: new Prisma.Decimal(item.unitPrice),
            },
            create: {
              orderId,
              shopifyLineItemId: item.shopifyLineItemId,
              sku: item.sku,
              name: item.name,
              quantity: item.quantity,
              unitPrice: new Prisma.Decimal(item.unitPrice),
              sgsSku: null,
            },
          });
        }
        await createSyncAudit(tx, orderId, "SHOPIFY_ORDER_SYNCED", changedCategories);
      },

      async recordShopifyReview(
        orderId: string,
        order: NormalizedShopifyOrder,
        changedCategories: ShopifySnapshotChangeCategory[],
      ) {
        await tx.order.update({
          where: { id: orderId },
          data: {
            shopifyOrderNumber: order.shopifyOrderNumber,
            shopifyLastSeenUpdatedAt: new Date(order.shopifyUpdatedAt),
            shopifySyncState: ShopifySyncState.REVIEW_REQUIRED,
            shopifyFinancialStatus: order.shopifyFinancialStatus,
            shopifyFulfillmentStatus: order.shopifyFulfillmentStatus,
            shopifyCancelledAt: order.shopifyCancelledAt ? new Date(order.shopifyCancelledAt) : null,
            shopifyCancelReason: order.shopifyCancelReason,
          },
        });
        await createSyncAudit(tx, orderId, "SHOPIFY_ORDER_REVIEW_REQUIRED", changedCategories);
      },

      async autoCancelShopifyOrder(orderId: string, expectedStatus: string) {
        const result = await tx.order.updateMany({
          where: {
            id: orderId,
            internalStatus: expectedStatus as OrderStatus,
            shipments: { none: {} },
          },
          data: { internalStatus: OrderStatus.CANCELLED, holdReason: null },
        });
        if (result.count !== 1) return false;
        await tx.orderStatusHistory.create({
          data: {
            orderId,
            fromStatus: expectedStatus as OrderStatus,
            toStatus: OrderStatus.CANCELLED,
            reason: "Shopify order cancelled",
            actorUserId: null,
          },
        });
        await tx.auditLog.create({
          data: {
            action: "SHOPIFY_ORDER_AUTO_CANCELLED",
            entityType: "Order",
            entityId: orderId,
            metadata: { source: "SHOPIFY", fromStatus: expectedStatus, toStatus: "CANCELLED" },
          },
        });
        return true;
      },
    })),
  };
}

async function createSyncAudit(
  tx: Prisma.TransactionClient,
  orderId: string,
  action: string,
  changedCategories: ShopifySnapshotChangeCategory[],
) {
  if (changedCategories.length === 0) return;
  await tx.auditLog.create({
    data: {
      action,
      entityType: "Order",
      entityId: orderId,
      metadata: { source: "SHOPIFY", changedCategories },
    },
  });
}
