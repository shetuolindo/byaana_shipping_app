import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchShopifyOrderById,
  ShopifyOrderResponseError,
} from "./order-source.ts";
import { ShopifyOrderIngestionError } from "./order-ingestion.ts";

const SHOP = "synthetic.myshopify.com";

function graphqlOrder() {
  return {
    id: "gid://shopify/Order/1001",
    name: "#1001",
    createdAt: "2026-10-01T08:00:00Z",
    updatedAt: "2026-10-01T09:00:00Z",
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "UNFULFILLED",
    cancelledAt: null,
    cancelReason: null,
    email: null,
    phone: null,
    shippingAddress: null,
    currentSubtotalPriceSet: { shopMoney: { amount: "10.00", currencyCode: "GBP" } },
    currentShippingPriceSet: { shopMoney: { amount: "2.00", currencyCode: "GBP" } },
    currentTotalTaxSet: { shopMoney: { amount: "0.00", currencyCode: "GBP" } },
    currentTotalPriceSet: { shopMoney: { amount: "12.00", currencyCode: "GBP" } },
    lineItems: {
      nodes: [{
        id: "gid://shopify/LineItem/2001",
        name: "Synthetic item",
        sku: null,
        currentQuantity: 1,
        originalUnitPriceSet: { shopMoney: { amount: "10.00", currencyCode: "GBP" } },
      }],
      pageInfo: { hasNextPage: false },
    },
  };
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("fetches a Shopify order by durable GID through the shared validated mapper", async () => {
  let requestBody;
  const mapped = await fetchShopifyOrderById({
    shopDomain: SHOP,
    accessToken: "synthetic-token",
    apiVersion: "2026-10",
    shopifyOrderId: "gid://shopify/Order/1001",
    async fetchImplementation(_url, init) {
      requestBody = JSON.parse(init.body);
      return response({ data: { shop: { myshopifyDomain: SHOP }, order: graphqlOrder() } });
    },
  });

  assert.equal(requestBody.variables.id, "gid://shopify/Order/1001");
  assert.equal(mapped.shopifyOrderId, "gid://shopify/Order/1001");
  assert.equal(mapped.totalAmount, "12.00");
});

test("rejects malformed GraphQL data and a mismatched returned shop identity", async () => {
  await assert.rejects(fetchShopifyOrderById({
    shopDomain: SHOP,
    accessToken: "synthetic-token",
    apiVersion: "2026-10",
    shopifyOrderId: "gid://shopify/Order/1001",
    async fetchImplementation() {
      return response({ data: { shop: { myshopifyDomain: SHOP }, order: { id: "invalid" } } });
    },
  }), ShopifyOrderResponseError);

  await assert.rejects(fetchShopifyOrderById({
    shopDomain: SHOP,
    accessToken: "synthetic-token",
    apiVersion: "2026-10",
    shopifyOrderId: "gid://shopify/Order/1001",
    async fetchImplementation() {
      return response({
        data: { shop: { myshopifyDomain: "other.myshopify.com" }, order: graphqlOrder() },
      });
    },
  }), ShopifyOrderIngestionError);
});
