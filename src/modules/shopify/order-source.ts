import { z } from "zod";
import { SHOPIFY_REQUEST_TIMEOUT_MS } from "./constants.ts";
import {
  diagnoseShopifyOrdersResponse,
  mapShopifyOrder,
  recentShopifyOrdersResponseSchema,
  shopifyOrderSchema,
  ShopifyOrderIngestionError,
  type NormalizedShopifyOrder,
  type ShopifyOrderResponseDiagnostics,
} from "./order-ingestion.ts";
import { normalizeShopifyShopDomain } from "./shop-domain.ts";

const SHOPIFY_ORDER_FIELDS = `
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
`;

const RECENT_ORDERS_QUERY = `#graphql
  query ControlledRecentOrders($first: Int!) {
    shop { myshopifyDomain }
    orders(first: $first, sortKey: CREATED_AT, reverse: true) {
      nodes { ${SHOPIFY_ORDER_FIELDS} }
    }
  }
`;

const ORDER_BY_ID_QUERY = `#graphql
  query ShopifyOrderById($id: ID!) {
    shop { myshopifyDomain }
    order(id: $id) { ${SHOPIFY_ORDER_FIELDS} }
  }
`;

const orderByIdResponseSchema = z.object({
  data: z.object({
    shop: z.object({ myshopifyDomain: z.string().min(1) }),
    order: shopifyOrderSchema.nullable(),
  }),
  errors: z.array(z.unknown()).optional(),
});

export class ShopifyOrderResponseError extends ShopifyOrderIngestionError {
  readonly diagnostics?: ShopifyOrderResponseDiagnostics;

  constructor(diagnostics?: ShopifyOrderResponseDiagnostics) {
    super("Shopify returned an invalid order response.");
    this.name = "ShopifyOrderResponseError";
    this.diagnostics = diagnostics;
  }
}

async function requestShopifyGraphql(input: {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
  query: string;
  variables: Record<string, unknown>;
  fetchImplementation?: typeof fetch;
}) {
  const fetchImplementation = input.fetchImplementation ?? fetch;
  try {
    const response = await fetchImplementation(
      `https://${input.shopDomain}/admin/api/${input.apiVersion}/graphql.json`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": input.accessToken,
        },
        body: JSON.stringify({ query: input.query, variables: input.variables }),
        signal: AbortSignal.timeout(SHOPIFY_REQUEST_TIMEOUT_MS),
      },
    );
    return { ok: response.ok, body: await response.json().catch(() => null) as unknown };
  } catch {
    throw new ShopifyOrderIngestionError("Shopify orders could not be read.");
  }
}

function assertExpectedShop(returnedDomain: string, expectedDomain: string) {
  if (normalizeShopifyShopDomain(returnedDomain) !== expectedDomain) {
    throw new ShopifyOrderIngestionError("Shopify returned a different shop identity.");
  }
}

export async function fetchRecentShopifyOrders(input: {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
  limit: number;
  fetchImplementation?: typeof fetch;
}): Promise<{ orders: NormalizedShopifyOrder[]; diagnostics: ShopifyOrderResponseDiagnostics }> {
  const result = await requestRecentShopifyOrders(input);
  const diagnostics = result.diagnostics;
  if (!result.ok) throw new ShopifyOrderResponseError(diagnostics);

  const parsed = recentShopifyOrdersResponseSchema.safeParse(result.body);
  if (!parsed.success || parsed.data.errors?.length) throw new ShopifyOrderResponseError(diagnostics);
  assertExpectedShop(parsed.data.data.shop.myshopifyDomain, input.shopDomain);
  if (parsed.data.data.orders.nodes.length > input.limit) {
    throw new ShopifyOrderIngestionError("Shopify returned more orders than requested.");
  }
  return { orders: parsed.data.data.orders.nodes.map(mapShopifyOrder), diagnostics };
}

export async function requestRecentShopifyOrders(input: {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
  limit: number;
  fetchImplementation?: typeof fetch;
}) {
  const result = await requestShopifyGraphql({
    ...input,
    query: RECENT_ORDERS_QUERY,
    variables: { first: input.limit },
  });
  return { ...result, diagnostics: diagnoseShopifyOrdersResponse(result.body, result.ok) };
}

export async function fetchShopifyOrderById(input: {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
  shopifyOrderId: string;
  fetchImplementation?: typeof fetch;
}): Promise<NormalizedShopifyOrder | null> {
  const result = await requestShopifyGraphql({
    ...input,
    query: ORDER_BY_ID_QUERY,
    variables: { id: input.shopifyOrderId },
  });
  if (!result.ok) throw new ShopifyOrderResponseError();
  const parsed = orderByIdResponseSchema.safeParse(result.body);
  if (!parsed.success || parsed.data.errors?.length) throw new ShopifyOrderResponseError();
  assertExpectedShop(parsed.data.data.shop.myshopifyDomain, input.shopDomain);
  return parsed.data.data.order ? mapShopifyOrder(parsed.data.data.order) : null;
}
