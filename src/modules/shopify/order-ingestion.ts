import { z } from "zod";

export const CONTROLLED_SHOPIFY_DOMAIN = "x612pp-ef.myshopify.com";
export const MAX_CONTROLLED_SHOPIFY_IMPORT = 5;

const nullableText = z.string().nullable();
const moneySchema = z.object({
  amount: z.string(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
});
const moneyBagSchema = z.object({ shopMoney: moneySchema });

const shopifyLineItemSchema = z.object({
  id: z.string().startsWith("gid://shopify/LineItem/"),
  name: z.string().min(1),
  sku: nullableText,
  currentQuantity: z.number().int().nonnegative(),
  originalUnitPriceSet: moneyBagSchema,
});

export const shopifyOrderSchema = z.object({
  id: z.string().startsWith("gid://shopify/Order/"),
  name: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  displayFinancialStatus: nullableText,
  displayFulfillmentStatus: z.string().min(1),
  cancelledAt: z.string().datetime({ offset: true }).nullable(),
  cancelReason: nullableText,
  email: nullableText,
  phone: nullableText,
  shippingAddress: z.object({
    name: nullableText,
    company: nullableText,
    phone: nullableText,
    countryCodeV2: nullableText,
    province: nullableText,
    city: nullableText,
    address1: nullableText,
    address2: nullableText,
    zip: nullableText,
  }).nullable(),
  currentSubtotalPriceSet: moneyBagSchema,
  currentShippingPriceSet: moneyBagSchema,
  currentTotalTaxSet: moneyBagSchema,
  currentTotalPriceSet: moneyBagSchema,
  lineItems: z.object({
    nodes: z.array(shopifyLineItemSchema),
    pageInfo: z.object({ hasNextPage: z.boolean() }),
  }),
});

export const recentShopifyOrdersResponseSchema = z.object({
  data: z.object({
    shop: z.object({ myshopifyDomain: z.string().min(1) }),
    orders: z.object({ nodes: z.array(shopifyOrderSchema).max(MAX_CONTROLLED_SHOPIFY_IMPORT) }),
  }),
  errors: z.array(z.unknown()).optional(),
});

export type ShopifyOrderResponseDiagnostics = {
  graphqlHttpSuccess: boolean;
  topLevelDataPresent: boolean;
  ordersConnectionPresent: boolean;
  nodesIsArray: boolean;
  returnedNodeCount: number | null;
  errorsPresent: boolean;
  errorPaths: string[];
  firstOrderStructuralValidation: "passed" | "failed" | "not_available";
  failingPath: string | null;
  expectedStructuralType: string | null;
  receivedStructuralType: string | null;
};

export type ShopifyOrderGraphqlNode = z.infer<typeof shopifyOrderSchema>;

export type NormalizedShopifyOrder = {
  shopifyOrderId: string;
  orderNumber: string;
  shopifyOrderNumber: string;
  externalCreatedAt: string;
  shopifyUpdatedAt: string;
  shopifyFinancialStatus: string | null;
  shopifyFulfillmentStatus: string;
  shopifyCancelledAt: string | null;
  shopifyCancelReason: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  currency: string;
  subtotal: string;
  shippingAmount: string;
  taxAmount: string;
  totalAmount: string;
  address: {
    name: string | null;
    company: string | null;
    phone: string | null;
    email: string | null;
    countryCode: string | null;
    province: string | null;
    city: string | null;
    district: string | null;
    address1: string | null;
    address2: string | null;
    postalCode: string | null;
  };
  items: Array<{
    shopifyLineItemId: string;
    sku: string | null;
    name: string;
    quantity: number;
    unitPrice: string;
  }>;
};

export type PersistedShopifyOrderSnapshot = NormalizedShopifyOrder & {
  id: string;
  shopId: string | null;
  source: string;
  internalStatus: string;
  shopifyLastSeenUpdatedAt?: string | null;
  shopifySyncState?: "IN_SYNC" | "REVIEW_REQUIRED" | "SOURCE_DELETED" | null;
  shopifyDeletedAt?: string | null;
  hasShipments?: boolean;
};

export type ShopifyOrderPersistenceTransaction = {
  findByShopifyOrderId(shopifyOrderId: string): Promise<PersistedShopifyOrderSnapshot | null>;
  createShopifyOrder(order: NormalizedShopifyOrder, shopId: string): Promise<{ id: string }>;
};

export type ShopifyOrderPersistence = {
  transaction<T>(operation: (transaction: ShopifyOrderPersistenceTransaction) => Promise<T>): Promise<T>;
};

export const shopifySnapshotChangeCategories = [
  "SOURCE_STATE",
  "FINANCIALS",
  "CUSTOMER",
  "ADDRESS",
  "ITEMS",
] as const;

export type ShopifySnapshotChangeCategory = (typeof shopifySnapshotChangeCategories)[number];

export type ShopifyWebhookSyncTransaction = ShopifyOrderPersistenceTransaction & {
  recordShopifyObservation(orderId: string, order: NormalizedShopifyOrder): Promise<void>;
  applyShopifySnapshot(
    orderId: string,
    order: NormalizedShopifyOrder,
    changedCategories: ShopifySnapshotChangeCategory[],
  ): Promise<void>;
  recordShopifyReview(
    orderId: string,
    order: NormalizedShopifyOrder,
    changedCategories: ShopifySnapshotChangeCategory[],
  ): Promise<void>;
  autoCancelShopifyOrder(orderId: string, expectedStatus: string): Promise<boolean>;
};

export type ShopifyWebhookSyncPersistence = {
  transaction<T>(operation: (transaction: ShopifyWebhookSyncTransaction) => Promise<T>): Promise<T>;
};

export type ShopifyWebhookSyncOptions = {
  createUnseen?: boolean;
};

export class ShopifyOrderIngestionError extends Error {
  constructor(message = "Shopify order data could not be ingested safely.") {
    super(message);
    this.name = "ShopifyOrderIngestionError";
  }
}

export class ShopifyOrderConflictError extends ShopifyOrderIngestionError {
  constructor() {
    super("The Shopify order has changed since it was imported; local data was preserved.");
    this.name = "ShopifyOrderConflictError";
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function structuralType(value: unknown) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function pathLabel(path: PropertyKey[]) {
  return path.reduce<string>((label, segment) => {
    if (typeof segment === "number") return `${label}[${segment}]`;
    return label ? `${label}.${String(segment)}` : String(segment);
  }, "");
}

function valueAtPath(value: unknown, path: PropertyKey[]) {
  let current = value;
  for (const segment of path) {
    if (typeof segment === "number") {
      current = Array.isArray(current) ? current[segment] : undefined;
    } else {
      current = recordValue(current)?.[String(segment)];
    }
  }
  return current;
}

export function diagnoseShopifyOrdersResponse(
  body: unknown,
  graphqlHttpSuccess: boolean,
): ShopifyOrderResponseDiagnostics {
  const root = recordValue(body);
  const data = recordValue(root?.data);
  const orders = recordValue(data?.orders);
  const nodes = orders?.nodes;
  const errors = Array.isArray(root?.errors) ? root.errors : [];
  const firstNode = Array.isArray(nodes) ? nodes[0] : undefined;
  const firstOrderResult = firstNode === undefined
    ? null
    : shopifyOrderSchema.safeParse(firstNode);
  const firstIssue = firstOrderResult && !firstOrderResult.success
    ? firstOrderResult.error.issues[0]
    : undefined;
  const failingValue = firstIssue ? valueAtPath(firstNode, firstIssue.path) : undefined;

  return {
    graphqlHttpSuccess,
    topLevelDataPresent: data !== null,
    ordersConnectionPresent: orders !== null,
    nodesIsArray: Array.isArray(nodes),
    returnedNodeCount: Array.isArray(nodes) ? nodes.length : null,
    errorsPresent: errors.length > 0,
    errorPaths: errors.flatMap((error) => {
      const path = recordValue(error)?.path;
      return Array.isArray(path) && path.every((segment) => typeof segment === "string" || typeof segment === "number")
        ? [pathLabel(path)]
        : [];
    }),
    firstOrderStructuralValidation: firstOrderResult === null
      ? "not_available"
      : firstOrderResult.success ? "passed" : "failed",
    failingPath: firstIssue ? pathLabel(firstIssue.path) : null,
    expectedStructuralType: firstIssue
      ? firstIssue.code === "invalid_type" ? String(firstIssue.expected) : firstIssue.code
      : null,
    receivedStructuralType: firstIssue ? structuralType(failingValue) : null,
  };
}

function optionalValue(value: string | null) {
  return value === null || value.length === 0 ? null : value;
}

function normalizeMoney(value: string) {
  const match = /^(0|[1-9]\d{0,9})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new ShopifyOrderIngestionError("A Shopify monetary amount is incompatible with local storage.");
  return `${match[1]}.${(match[2] ?? "").padEnd(2, "0")}`;
}

export function mapShopifyOrder(node: ShopifyOrderGraphqlNode): NormalizedShopifyOrder {
  if (node.lineItems.pageInfo.hasNextPage) {
    throw new ShopifyOrderIngestionError("A Shopify order has more line items than the controlled importer supports.");
  }

  const currencies = [
    node.currentSubtotalPriceSet.shopMoney.currencyCode,
    node.currentShippingPriceSet.shopMoney.currencyCode,
    node.currentTotalTaxSet.shopMoney.currencyCode,
    node.currentTotalPriceSet.shopMoney.currencyCode,
    ...node.lineItems.nodes.map((item) => item.originalUnitPriceSet.shopMoney.currencyCode),
  ];
  if (currencies.some((currency) => currency !== currencies[0])) {
    throw new ShopifyOrderIngestionError("A Shopify order contains inconsistent shop-money currencies.");
  }

  const lineItemIds = new Set<string>();
  const items = node.lineItems.nodes.map((item) => {
    if (lineItemIds.has(item.id)) {
      throw new ShopifyOrderIngestionError("A Shopify order contains a duplicate line-item identifier.");
    }
    lineItemIds.add(item.id);
    return {
      shopifyLineItemId: item.id,
      sku: optionalValue(item.sku),
      name: item.name,
      quantity: item.currentQuantity,
      unitPrice: normalizeMoney(item.originalUnitPriceSet.shopMoney.amount),
    };
  });

  const address = node.shippingAddress;
  const customerEmail = optionalValue(node.email);

  return {
    shopifyOrderId: node.id,
    orderNumber: node.name,
    shopifyOrderNumber: node.name,
    externalCreatedAt: new Date(node.createdAt).toISOString(),
    shopifyUpdatedAt: new Date(node.updatedAt).toISOString(),
    shopifyFinancialStatus: node.displayFinancialStatus,
    shopifyFulfillmentStatus: node.displayFulfillmentStatus,
    shopifyCancelledAt: node.cancelledAt ? new Date(node.cancelledAt).toISOString() : null,
    shopifyCancelReason: optionalValue(node.cancelReason),
    customerName: optionalValue(address?.name ?? null),
    customerEmail,
    customerPhone: optionalValue(node.phone) ?? optionalValue(address?.phone ?? null),
    currency: currencies[0],
    subtotal: normalizeMoney(node.currentSubtotalPriceSet.shopMoney.amount),
    shippingAmount: normalizeMoney(node.currentShippingPriceSet.shopMoney.amount),
    taxAmount: normalizeMoney(node.currentTotalTaxSet.shopMoney.amount),
    totalAmount: normalizeMoney(node.currentTotalPriceSet.shopMoney.amount),
    address: {
      name: optionalValue(address?.name ?? null),
      company: optionalValue(address?.company ?? null),
      phone: optionalValue(address?.phone ?? null),
      email: customerEmail,
      countryCode: optionalValue(address?.countryCodeV2 ?? null),
      province: optionalValue(address?.province ?? null),
      city: optionalValue(address?.city ?? null),
      district: null,
      address1: optionalValue(address?.address1 ?? null),
      address2: optionalValue(address?.address2 ?? null),
      postalCode: optionalValue(address?.zip ?? null),
    },
    items,
  };
}

export function canonicalShopifyOrder(order: NormalizedShopifyOrder) {
  return {
    shopifyOrderId: order.shopifyOrderId,
    orderNumber: order.orderNumber,
    shopifyOrderNumber: order.shopifyOrderNumber,
    externalCreatedAt: order.externalCreatedAt,
    shopifyUpdatedAt: order.shopifyUpdatedAt,
    shopifyFinancialStatus: order.shopifyFinancialStatus,
    shopifyFulfillmentStatus: order.shopifyFulfillmentStatus,
    shopifyCancelledAt: order.shopifyCancelledAt,
    shopifyCancelReason: order.shopifyCancelReason,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    currency: order.currency,
    subtotal: order.subtotal,
    shippingAmount: order.shippingAmount,
    taxAmount: order.taxAmount,
    totalAmount: order.totalAmount,
    address: order.address,
    items: [...order.items].sort((left, right) => left.shopifyLineItemId.localeCompare(right.shopifyLineItemId)),
  };
}

export function isUnchangedShopifyOrder(
  existing: PersistedShopifyOrderSnapshot,
  incoming: NormalizedShopifyOrder,
  shopId: string,
) {
  if (existing.shopId !== shopId || existing.source !== "SHOPIFY") return false;
  return JSON.stringify(canonicalShopifyOrder(existing)) === JSON.stringify(canonicalShopifyOrder(incoming));
}

export function getShopifySnapshotChangeCategories(
  existing: PersistedShopifyOrderSnapshot,
  incoming: NormalizedShopifyOrder,
): ShopifySnapshotChangeCategory[] {
  const categories: ShopifySnapshotChangeCategory[] = [];
  if (JSON.stringify({
    orderNumber: existing.shopifyOrderNumber,
    externalCreatedAt: existing.externalCreatedAt,
    financialStatus: existing.shopifyFinancialStatus,
    fulfillmentStatus: existing.shopifyFulfillmentStatus,
    cancelledAt: existing.shopifyCancelledAt,
    cancelReason: existing.shopifyCancelReason,
  }) !== JSON.stringify({
    orderNumber: incoming.shopifyOrderNumber,
    externalCreatedAt: incoming.externalCreatedAt,
    financialStatus: incoming.shopifyFinancialStatus,
    fulfillmentStatus: incoming.shopifyFulfillmentStatus,
    cancelledAt: incoming.shopifyCancelledAt,
    cancelReason: incoming.shopifyCancelReason,
  })) categories.push("SOURCE_STATE");

  if (JSON.stringify({
    currency: existing.currency,
    subtotal: existing.subtotal,
    shippingAmount: existing.shippingAmount,
    taxAmount: existing.taxAmount,
    totalAmount: existing.totalAmount,
  }) !== JSON.stringify({
    currency: incoming.currency,
    subtotal: incoming.subtotal,
    shippingAmount: incoming.shippingAmount,
    taxAmount: incoming.taxAmount,
    totalAmount: incoming.totalAmount,
  })) categories.push("FINANCIALS");

  if (JSON.stringify({
    name: existing.customerName,
    email: existing.customerEmail,
    phone: existing.customerPhone,
  }) !== JSON.stringify({
    name: incoming.customerName,
    email: incoming.customerEmail,
    phone: incoming.customerPhone,
  })) categories.push("CUSTOMER");

  if (JSON.stringify(existing.address) !== JSON.stringify(incoming.address)) categories.push("ADDRESS");
  const existingItems = [...existing.items].sort((left, right) => left.shopifyLineItemId.localeCompare(right.shopifyLineItemId));
  const incomingItems = [...incoming.items].sort((left, right) => left.shopifyLineItemId.localeCompare(right.shopifyLineItemId));
  if (JSON.stringify(existingItems) !== JSON.stringify(incomingItems)) categories.push("ITEMS");
  return categories;
}

export async function persistNormalizedShopifyOrder(
  order: NormalizedShopifyOrder,
  shopId: string,
  persistence: ShopifyOrderPersistence,
) {
  return persistence.transaction(async (transaction) => {
    const existing = await transaction.findByShopifyOrderId(order.shopifyOrderId);
    if (existing) {
      if (!isUnchangedShopifyOrder(existing, order, shopId)) throw new ShopifyOrderConflictError();
      return { outcome: "unchanged" as const, orderId: existing.id, internalStatus: existing.internalStatus };
    }

    const created = await transaction.createShopifyOrder(order, shopId);
    return { outcome: "created" as const, orderId: created.id, internalStatus: "NEW" as const };
  });
}

export async function synchronizeNormalizedShopifyOrder(
  order: NormalizedShopifyOrder,
  shopId: string,
  persistence: ShopifyWebhookSyncPersistence,
  options: ShopifyWebhookSyncOptions = {},
) {
  return persistence.transaction(async (transaction) => {
    const existing = await transaction.findByShopifyOrderId(order.shopifyOrderId);
    if (!existing) {
      if (options.createUnseen === false) {
        return {
          outcome: "skipped" as const,
          autoCancelled: false,
        };
      }
      const created = await transaction.createShopifyOrder(order, shopId);
      const autoCancelled = order.shopifyCancelledAt !== null
        ? await transaction.autoCancelShopifyOrder(created.id, "NEW")
        : false;
      return {
        outcome: "created" as const,
        orderId: created.id,
        internalStatus: autoCancelled ? "CANCELLED" as const : "NEW" as const,
        autoCancelled,
      };
    }
    if (existing.shopId !== shopId || existing.source !== "SHOPIFY") throw new ShopifyOrderConflictError();

    const newestObservedAt = existing.shopifyLastSeenUpdatedAt ?? existing.shopifyUpdatedAt;
    if (newestObservedAt && new Date(order.shopifyUpdatedAt) <= new Date(newestObservedAt)) {
      return {
        outcome: "unchanged" as const,
        orderId: existing.id,
        internalStatus: existing.internalStatus,
        autoCancelled: false,
      };
    }

    const changedCategories = getShopifySnapshotChangeCategories(existing, order);
    if (changedCategories.length === 0) {
      await transaction.recordShopifyObservation(existing.id, order);
      return {
        outcome: "unchanged" as const,
        orderId: existing.id,
        internalStatus: existing.internalStatus,
        autoCancelled: false,
      };
    }
    const hasShipments = existing.hasShipments ?? false;
    const canApplySnapshot = existing.internalStatus === "NEW" && !hasShipments;
    const canAutoCancel = order.shopifyCancelledAt !== null
      && ["NEW", "ON_HOLD", "READY"].includes(existing.internalStatus)
      && !hasShipments;

    if (canApplySnapshot) {
      await transaction.applyShopifySnapshot(existing.id, order, changedCategories);
    } else {
      await transaction.recordShopifyReview(existing.id, order, changedCategories);
    }

    const autoCancelled = canAutoCancel
      ? await transaction.autoCancelShopifyOrder(existing.id, existing.internalStatus)
      : false;

    return {
      outcome: canApplySnapshot ? "updated" as const : "review_required" as const,
      orderId: existing.id,
      internalStatus: autoCancelled ? "CANCELLED" as const : existing.internalStatus,
      autoCancelled,
      changedCategories,
    };
  });
}
