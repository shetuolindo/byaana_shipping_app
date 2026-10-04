// This module is a server-side, local-development CLI boundary. It must never
// be imported into a Client Component or exposed as a public route.
import { OrderSource, OrderStatus, Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import prisma from "../../lib/prisma.ts";
import {
  CONTROLLED_SHOPIFY_DOMAIN,
  MAX_CONTROLLED_SHOPIFY_IMPORT,
  persistNormalizedShopifyOrder,
  ShopifyOrderConflictError,
  ShopifyOrderIngestionError,
} from "./order-ingestion.ts";
import { createPrismaShopifyOrderPersistence } from "./order-persistence.ts";
import {
  fetchRecentShopifyOrders,
  requestRecentShopifyOrders,
} from "./order-source.ts";
import { decryptShopifyAccessToken, isValidShopifyTokenEncryptionKey } from "./token-encryption.ts";

export { ShopifyOrderResponseError } from "./order-source.ts";

const controlledImportEnvironmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  SHOPIFY_API_VERSION: z.string().regex(/^\d{4}-(?:01|04|07|10)$/),
  SHOPIFY_TOKEN_ENCRYPTION_KEY: z.string().refine(isValidShopifyTokenEncryptionKey),
});

export type ControlledImportSummary = {
  requestedLimit: number;
  fetched: number;
  created: number;
  unchanged: number;
  conflicts: number;
  errors: number;
  failed: number;
  newOrderIds: string[];
  before: SanitizedShopifyCounts;
  after: SanitizedShopifyCounts;
  verification: {
    processedOrders: number;
    ordersOutsideControlledShop: number;
    ordersWithoutExactlyOneAddress: number;
    duplicateShopifyOrderIdGroups: number;
    duplicateShopifyLineItemIdGroups: number;
    sourceMissingSkus: number;
    storedMissingSkus: number;
    createdOrdersNotNew: number;
  };
};

type SanitizedShopifyCounts = {
  orders: number;
  orderItems: number;
  addresses: number;
  statusHistory: number;
};

function environment() {
  const parsed = controlledImportEnvironmentSchema.safeParse(process.env);
  if (!parsed.success) throw new ShopifyOrderIngestionError("The controlled Shopify importer is not configured.");
  return parsed.data;
}

export function assertLocalDatabase(databaseUrl: string) {
  const hostname = new URL(databaseUrl).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    throw new ShopifyOrderIngestionError("The controlled importer only permits a local database.");
  }
}

async function connectedShop(client: PrismaClient) {
  const shop = await client.shop.findUnique({
    where: { shopifyShopDomain: CONTROLLED_SHOPIFY_DOMAIN },
    select: {
      id: true,
      isActive: true,
      shopifyShopDomain: true,
      shopifyAccessTokenEncrypted: true,
    },
  });
  if (!shop?.isActive || !shop.shopifyAccessTokenEncrypted) {
    throw new ShopifyOrderIngestionError("The required Shopify shop is not connected and active.");
  }
  return { ...shop, shopifyAccessTokenEncrypted: shop.shopifyAccessTokenEncrypted };
}

async function controlledContext() {
  const env = environment();
  assertLocalDatabase(env.DATABASE_URL);
  const shop = await connectedShop(prisma);
  const accessToken = decryptShopifyAccessToken(
    shop.shopifyAccessTokenEncrypted,
    shop.shopifyShopDomain,
    env.SHOPIFY_TOKEN_ENCRYPTION_KEY,
  );
  return { env, shop, accessToken };
}

export async function runControlledShopifyDiagnostics(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CONTROLLED_SHOPIFY_IMPORT) {
    throw new ShopifyOrderIngestionError(`The diagnostic limit must be between 1 and ${MAX_CONTROLLED_SHOPIFY_IMPORT}.`);
  }
  const context = await controlledContext();
  return (await requestRecentShopifyOrders({
    shopDomain: context.shop.shopifyShopDomain,
    accessToken: context.accessToken,
    apiVersion: context.env.SHOPIFY_API_VERSION,
    limit,
  })).diagnostics;
}

async function sanitizedCounts(client: PrismaClient, shopId: string): Promise<SanitizedShopifyCounts> {
  const shopOrders = { shopId, source: OrderSource.SHOPIFY } as const;
  const [orders, orderItems, addresses, statusHistory] = await Promise.all([
    client.order.count({ where: shopOrders }),
    client.orderItem.count({ where: { order: shopOrders } }),
    client.address.count({ where: { order: shopOrders } }),
    client.orderStatusHistory.count({ where: { order: shopOrders } }),
  ]);
  return { orders, orderItems, addresses, statusHistory };
}

async function duplicateCounts(client: PrismaClient, shopId: string) {
  const [orderRows, itemRows] = await Promise.all([
    client.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT "shopifyOrderId"
        FROM "Order"
        WHERE "shopId" = ${shopId} AND "shopifyOrderId" IS NOT NULL
        GROUP BY "shopifyOrderId"
        HAVING COUNT(*) > 1
      ) duplicate_orders
    `),
    client.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT item."orderId", item."shopifyLineItemId"
        FROM "OrderItem" item
        INNER JOIN "Order" portal_order ON portal_order."id" = item."orderId"
        WHERE portal_order."shopId" = ${shopId} AND item."shopifyLineItemId" IS NOT NULL
        GROUP BY item."orderId", item."shopifyLineItemId"
        HAVING COUNT(*) > 1
      ) duplicate_items
    `),
  ]);
  return {
    duplicateShopifyOrderIdGroups: Number(orderRows[0]?.count ?? BigInt(0)),
    duplicateShopifyLineItemIdGroups: Number(itemRows[0]?.count ?? BigInt(0)),
  };
}

export async function runControlledShopifyImport(limit: number): Promise<ControlledImportSummary> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CONTROLLED_SHOPIFY_IMPORT) {
    throw new ShopifyOrderIngestionError(`The import limit must be between 1 and ${MAX_CONTROLLED_SHOPIFY_IMPORT}.`);
  }
  const context = await controlledContext();
  const { env, shop, accessToken } = context;
  const { orders } = await fetchRecentShopifyOrders({
    shopDomain: shop.shopifyShopDomain,
    accessToken,
    apiVersion: env.SHOPIFY_API_VERSION,
    limit,
  });
  const before = await sanitizedCounts(prisma, shop.id);
  const summary: ControlledImportSummary = {
    requestedLimit: limit,
    fetched: orders.length,
    created: 0,
    unchanged: 0,
    conflicts: 0,
    errors: 0,
    failed: 0,
    newOrderIds: [],
    before,
    after: before,
    verification: {
      processedOrders: 0,
      ordersOutsideControlledShop: 0,
      ordersWithoutExactlyOneAddress: 0,
      duplicateShopifyOrderIdGroups: 0,
      duplicateShopifyLineItemIdGroups: 0,
      sourceMissingSkus: orders.flatMap((order) => order.items).filter((item) => item.sku === null).length,
      storedMissingSkus: 0,
      createdOrdersNotNew: 0,
    },
  };
  const persistence = createPrismaShopifyOrderPersistence(prisma);
  const processedOrderIds: string[] = [];

  for (const order of orders) {
    try {
      const result = await persistNormalizedShopifyOrder(order, shop.id, persistence);
      if (result.outcome === "created") {
        summary.created += 1;
        summary.newOrderIds.push(result.orderId);
      } else {
        summary.unchanged += 1;
      }
      processedOrderIds.push(result.orderId);
    } catch (error) {
      if (error instanceof ShopifyOrderConflictError) summary.conflicts += 1;
      else summary.errors += 1;
      summary.failed += 1;
    }
  }

  const [after, duplicateVerification, processedOrders, ordersOutsideControlledShop,
    ordersWithoutExactlyOneAddress, storedMissingSkus, createdOrdersNotNew] = await Promise.all([
    sanitizedCounts(prisma, shop.id),
    duplicateCounts(prisma, shop.id),
    prisma.order.count({ where: { id: { in: processedOrderIds } } }),
    prisma.order.count({ where: { id: { in: processedOrderIds }, NOT: { shopId: shop.id } } }),
    prisma.order.count({ where: { id: { in: processedOrderIds }, address: { is: null } } }),
    prisma.orderItem.count({ where: { orderId: { in: processedOrderIds }, sku: null } }),
    prisma.order.count({ where: { id: { in: summary.newOrderIds }, NOT: { internalStatus: OrderStatus.NEW } } }),
  ]);
  summary.after = after;
  summary.verification = {
    processedOrders,
    ordersOutsideControlledShop,
    ordersWithoutExactlyOneAddress,
    ...duplicateVerification,
    sourceMissingSkus: summary.verification.sourceMissingSkus,
    storedMissingSkus,
    createdOrdersNotNew,
  };
  return summary;
}

export async function disconnectControlledImporter() {
  await prisma.$disconnect();
}
