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

const shopifyOrderSchema = z.object({
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
};

export type ShopifyOrderPersistenceTransaction = {
  findByShopifyOrderId(shopifyOrderId: string): Promise<PersistedShopifyOrderSnapshot | null>;
  createShopifyOrder(order: NormalizedShopifyOrder, shopId: string): Promise<{ id: string }>;
};

export type ShopifyOrderPersistence = {
  transaction<T>(operation: (transaction: ShopifyOrderPersistenceTransaction) => Promise<T>): Promise<T>;
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

function canonicalOrder(order: NormalizedShopifyOrder) {
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
  return JSON.stringify(canonicalOrder(existing)) === JSON.stringify(canonicalOrder(incoming));
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
