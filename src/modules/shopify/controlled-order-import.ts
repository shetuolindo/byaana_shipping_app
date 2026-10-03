// This module is a server-side, local-development CLI boundary. It must never
// be imported into a Client Component or exposed as a public route.
import { OrderSource, OrderStatus, Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import prisma from "../../lib/prisma.ts";
import { SHOPIFY_REQUEST_TIMEOUT_MS } from "./constants.ts";
import {
  CONTROLLED_SHOPIFY_DOMAIN,
  diagnoseShopifyOrdersResponse,
  mapShopifyOrder,
  MAX_CONTROLLED_SHOPIFY_IMPORT,
  persistNormalizedShopifyOrder,
  recentShopifyOrdersResponseSchema,
  ShopifyOrderConflictError,
  ShopifyOrderIngestionError,
  type NormalizedShopifyOrder,
  type PersistedShopifyOrderSnapshot,
  type ShopifyOrderPersistence,
  type ShopifyOrderResponseDiagnostics,
} from "./order-ingestion.ts";
import { decryptShopifyAccessToken, isValidShopifyTokenEncryptionKey } from "./token-encryption.ts";

const controlledImportEnvironmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  SHOPIFY_API_VERSION: z.string().regex(/^\d{4}-(?:01|04|07|10)$/),
  SHOPIFY_TOKEN_ENCRYPTION_KEY: z.string().refine(isValidShopifyTokenEncryptionKey),
});

const RECENT_ORDERS_QUERY = `#graphql
  query ControlledRecentOrders($first: Int!) {
    shop {
      myshopifyDomain
    }
    orders(first: $first, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        name
        createdAt
        updatedAt
        displayFinancialStatus
        displayFulfillmentStatus
        cancelledAt
        cancelReason
        email
        phone
        shippingAddress {
          name
          company
          phone
          countryCodeV2
          province
          city
          address1
          address2
          zip
        }
        currentSubtotalPriceSet { shopMoney { amount currencyCode } }
        currentShippingPriceSet { shopMoney { amount currencyCode } }
        currentTotalTaxSet { shopMoney { amount currencyCode } }
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        lineItems(first: 250) {
          nodes {
            id
            name
            sku
            currentQuantity
            originalUnitPriceSet { shopMoney { amount currencyCode } }
          }
          pageInfo { hasNextPage }
        }
      }
    }
  }
`;

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

export class ShopifyOrderResponseError extends ShopifyOrderIngestionError {
  readonly diagnostics: ShopifyOrderResponseDiagnostics;

  constructor(diagnostics: ShopifyOrderResponseDiagnostics) {
    super("Shopify returned an invalid order response.");
    this.name = "ShopifyOrderResponseError";
    this.diagnostics = diagnostics;
  }
}

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

async function requestRecentOrders(input: {
  accessToken: string;
  apiVersion: string;
  limit: number;
  fetchImplementation?: typeof fetch;
}): Promise<{ body: unknown; diagnostics: ShopifyOrderResponseDiagnostics }> {
  const fetchImplementation = input.fetchImplementation ?? fetch;
  let response: Response;
  try {
    response = await fetchImplementation(
      `https://${CONTROLLED_SHOPIFY_DOMAIN}/admin/api/${input.apiVersion}/graphql.json`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": input.accessToken,
        },
        body: JSON.stringify({ query: RECENT_ORDERS_QUERY, variables: { first: input.limit } }),
        signal: AbortSignal.timeout(SHOPIFY_REQUEST_TIMEOUT_MS),
      },
    );
  } catch {
    throw new ShopifyOrderIngestionError("Shopify orders could not be read.");
  }
  const body: unknown = await response.json().catch(() => null);
  return { body, diagnostics: diagnoseShopifyOrdersResponse(body, response.ok) };
}

async function fetchRecentOrders(input: {
  accessToken: string;
  apiVersion: string;
  limit: number;
  fetchImplementation?: typeof fetch;
}) {
  const result = await requestRecentOrders(input);
  if (!result.diagnostics.graphqlHttpSuccess) {
    throw new ShopifyOrderResponseError(result.diagnostics);
  }
  const parsed = recentShopifyOrdersResponseSchema.safeParse(result.body);
  if (!parsed.success || parsed.data.errors?.length) {
    throw new ShopifyOrderResponseError(result.diagnostics);
  }
  if (parsed.data.data.shop.myshopifyDomain.toLowerCase() !== CONTROLLED_SHOPIFY_DOMAIN) {
    throw new ShopifyOrderIngestionError("Shopify returned a different shop identity.");
  }
  if (parsed.data.data.orders.nodes.length > input.limit) {
    throw new ShopifyOrderIngestionError("Shopify returned more orders than the requested controlled limit.");
  }
  return parsed.data.data.orders.nodes.map(mapShopifyOrder);
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
  return (await requestRecentOrders({
    accessToken: context.accessToken,
    apiVersion: context.env.SHOPIFY_API_VERSION,
    limit,
  })).diagnostics;
}

function persistenceFor(client: PrismaClient): ShopifyOrderPersistence {
  return {
    transaction: (operation) => client.$transaction(async (tx) => operation({
      async findByShopifyOrderId(shopifyOrderId): Promise<PersistedShopifyOrderSnapshot | null> {
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
        };
      },
      async createShopifyOrder(order: NormalizedShopifyOrder, shopId: string) {
        const created = await tx.order.create({
          data: {
            orderNumber: order.orderNumber,
            shopId,
            source: OrderSource.SHOPIFY,
            internalStatus: OrderStatus.NEW,
            shopifyOrderId: order.shopifyOrderId,
            shopifyOrderNumber: order.shopifyOrderNumber,
            externalCreatedAt: new Date(order.externalCreatedAt),
            shopifyUpdatedAt: new Date(order.shopifyUpdatedAt),
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
            metadata: {
              source: "SHOPIFY",
              shopifyOrderId: order.shopifyOrderId,
              shopifyShopDomain: CONTROLLED_SHOPIFY_DOMAIN,
            },
          },
        });
        return created;
      },
    })),
  };
}

function incompatibleExistingSnapshot(existing: { id: string; shopId: string | null; source: string; internalStatus: string }) {
  return {
    id: existing.id,
    shopId: existing.shopId,
    source: "INCOMPATIBLE",
    internalStatus: existing.internalStatus,
  } as PersistedShopifyOrderSnapshot;
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
  const orders = await fetchRecentOrders({ accessToken, apiVersion: env.SHOPIFY_API_VERSION, limit });
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
  const persistence = persistenceFor(prisma);
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
