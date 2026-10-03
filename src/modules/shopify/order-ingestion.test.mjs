import assert from "node:assert/strict";
import test from "node:test";
import {
  diagnoseShopifyOrdersResponse,
  mapShopifyOrder,
  persistNormalizedShopifyOrder,
  recentShopifyOrdersResponseSchema,
  ShopifyOrderConflictError,
} from "./order-ingestion.ts";

function rawOrder(overrides = {}) {
  return {
    id: "gid://shopify/Order/1001",
    name: "#1001",
    createdAt: "2026-10-01T08:00:00Z",
    updatedAt: "2026-10-01T09:00:00Z",
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "UNFULFILLED",
    cancelledAt: null,
    cancelReason: null,
    email: "buyer@example.test",
    phone: null,
    shippingAddress: {
      name: "Example Recipient",
      company: null,
      phone: "+441234567890",
      countryCodeV2: "GB",
      province: "London",
      city: "London",
      address1: "1 Test Street",
      address2: null,
      zip: "SW1A 1AA",
    },
    currentSubtotalPriceSet: { shopMoney: { amount: "25.00", currencyCode: "GBP" } },
    currentShippingPriceSet: { shopMoney: { amount: "4.50", currencyCode: "GBP" } },
    currentTotalTaxSet: { shopMoney: { amount: "5.00", currencyCode: "GBP" } },
    currentTotalPriceSet: { shopMoney: { amount: "34.50", currencyCode: "GBP" } },
    lineItems: {
      nodes: [
        {
          id: "gid://shopify/LineItem/2001",
          name: "First item",
          sku: "SKU-1",
          currentQuantity: 2,
          originalUnitPriceSet: { shopMoney: { amount: "12.50", currencyCode: "GBP" } },
        },
      ],
      pageInfo: { hasNextPage: false },
    },
    ...overrides,
  };
}

function fakePersistence() {
  const state = {
    orders: new Map(),
    addresses: [],
    items: [],
    histories: [],
    audits: [],
    failAfterAddress: false,
  };
  return {
    state,
    persistence: {
      async transaction(operation) {
        const draft = structuredClone(state);
        const result = await operation({
          async findByShopifyOrderId(shopifyOrderId) {
            return draft.orders.get(shopifyOrderId) ?? null;
          },
          async createShopifyOrder(order, shopId) {
            const id = `local-${draft.orders.size + 1}`;
            draft.addresses.push({ orderId: id, ...order.address });
            if (draft.failAfterAddress) throw new Error("synthetic item failure");
            draft.items.push(...order.items.map((item) => ({ orderId: id, ...item })));
            draft.histories.push({ orderId: id, toStatus: "NEW" });
            draft.audits.push({ orderId: id, action: "SHOPIFY_ORDER_IMPORTED" });
            draft.orders.set(order.shopifyOrderId, {
              id,
              shopId,
              source: "SHOPIFY",
              internalStatus: "NEW",
              ...structuredClone(order),
            });
            return { id };
          },
        });
        state.orders = draft.orders;
        state.addresses = draft.addresses;
        state.items = draft.items;
        state.histories = draft.histories;
        state.audits = draft.audits;
        return result;
      },
    },
  };
}

test("maps a new Shopify order with current quantities and shop-money amounts", () => {
  const mapped = mapShopifyOrder(rawOrder());
  assert.equal(mapped.shopifyOrderId, "gid://shopify/Order/1001");
  assert.equal(mapped.orderNumber, "#1001");
  assert.equal(mapped.shopifyOrderNumber, "#1001");
  assert.equal(mapped.totalAmount, "34.50");
  assert.equal(mapped.currency, "GBP");
  assert.equal(mapped.items[0].quantity, 2);
  assert.equal(mapped.items[0].unitPrice, "12.50");
  assert.equal(mapped.address.countryCode, "GB");
});

test("preserves missing SKU and nullable customer/address fields as null", () => {
  const mapped = mapShopifyOrder(rawOrder({
    email: null,
    shippingAddress: null,
    lineItems: {
      nodes: [{
        id: "gid://shopify/LineItem/2001",
        name: "Custom item",
        sku: null,
        currentQuantity: 1,
        originalUnitPriceSet: { shopMoney: { amount: "25", currencyCode: "GBP" } },
      }],
      pageInfo: { hasNextPage: false },
    },
  }));
  assert.equal(mapped.customerName, null);
  assert.equal(mapped.customerEmail, null);
  assert.equal(mapped.address.name, null);
  assert.equal(mapped.address.address1, null);
  assert.equal(mapped.address.countryCode, null);
  assert.equal(mapped.items[0].sku, null);
  assert.equal(mapped.items[0].unitPrice, "25.00");
});

test("accepts the read_orders response shape without Customer scope and allows a null financial status", () => {
  const node = rawOrder({ displayFinancialStatus: null });
  const response = recentShopifyOrdersResponseSchema.safeParse({
    data: {
      shop: { myshopifyDomain: "x612pp-ef.myshopify.com" },
      orders: { nodes: [node] },
    },
  });
  assert.equal(response.success, true);
  if (!response.success) return;

  const mapped = mapShopifyOrder(response.data.data.orders.nodes[0]);
  assert.equal(mapped.shopifyFinancialStatus, null);
  assert.equal(mapped.customerName, "Example Recipient");
  assert.equal(mapped.customerEmail, "buyer@example.test");
  assert.equal(mapped.customerPhone, "+441234567890");
});

test("maps multiple line items by durable Shopify line-item identity", () => {
  const first = rawOrder().lineItems.nodes[0];
  const mapped = mapShopifyOrder(rawOrder({
    lineItems: {
      nodes: [first, { ...first, id: "gid://shopify/LineItem/2002", name: "Second item", currentQuantity: 3 }],
      pageInfo: { hasNextPage: false },
    },
  }));
  assert.deepEqual(mapped.items.map((item) => item.shopifyLineItemId), [
    "gid://shopify/LineItem/2001",
    "gid://shopify/LineItem/2002",
  ]);
  assert.deepEqual(mapped.items.map((item) => item.quantity), [2, 3]);
});

test("rejects duplicate line-item IDs within one order while allowing the same ID in another order", async () => {
  const first = rawOrder().lineItems.nodes[0];
  assert.throws(() => mapShopifyOrder(rawOrder({
    lineItems: { nodes: [first, { ...first }], pageInfo: { hasNextPage: false } },
  })));

  const store = fakePersistence();
  const firstOrder = mapShopifyOrder(rawOrder());
  const secondOrder = mapShopifyOrder(rawOrder({ id: "gid://shopify/Order/1002", name: "#1002" }));
  await persistNormalizedShopifyOrder(firstOrder, "shop-1", store.persistence);
  await persistNormalizedShopifyOrder(secondOrder, "shop-1", store.persistence);
  assert.equal(store.state.orders.size, 2);
  assert.equal(store.state.items.length, 2);
});

test("repeated ingestion is a no-op and preserves portal-owned internalStatus", async () => {
  const store = fakePersistence();
  const order = mapShopifyOrder(rawOrder());
  const created = await persistNormalizedShopifyOrder(order, "shop-1", store.persistence);
  store.state.orders.get(order.shopifyOrderId).internalStatus = "ON_HOLD";
  const counts = () => [store.state.orders.size, store.state.addresses.length, store.state.items.length, store.state.histories.length, store.state.audits.length];
  const before = counts();
  const repeated = await persistNormalizedShopifyOrder(order, "shop-1", store.persistence);

  assert.equal(created.outcome, "created");
  assert.deepEqual(before, [1, 1, 1, 1, 1]);
  assert.equal(repeated.outcome, "unchanged");
  assert.equal(repeated.internalStatus, "ON_HOLD");
  assert.deepEqual(counts(), before);
});

test("changed Shopify data is not merged over an existing operational record", async () => {
  const store = fakePersistence();
  const order = mapShopifyOrder(rawOrder());
  await persistNormalizedShopifyOrder(order, "shop-1", store.persistence);
  await assert.rejects(
    persistNormalizedShopifyOrder({ ...order, totalAmount: "99.00" }, "shop-1", store.persistence),
    ShopifyOrderConflictError,
  );
  assert.equal(store.state.orders.get(order.shopifyOrderId).totalAmount, "34.50");
});

test("a child-write failure rolls back the entire order transaction", async () => {
  const store = fakePersistence();
  store.state.failAfterAddress = true;
  await assert.rejects(persistNormalizedShopifyOrder(mapShopifyOrder(rawOrder()), "shop-1", store.persistence));
  assert.equal(store.state.orders.size, 0);
  assert.equal(store.state.addresses.length, 0);
  assert.equal(store.state.items.length, 0);
  assert.equal(store.state.histories.length, 0);
  assert.equal(store.state.audits.length, 0);
});

test("reports sanitized structural diagnostics without exposing field values", () => {
  const diagnostics = diagnoseShopifyOrdersResponse({
    data: {
      orders: {
        nodes: [{ ...rawOrder(), currentTotalPriceSet: null }],
      },
    },
    errors: [{ message: "sensitive upstream detail", path: ["orders", "nodes", 0, "customer", "email"] }],
  }, true);

  assert.deepEqual(diagnostics, {
    graphqlHttpSuccess: true,
    topLevelDataPresent: true,
    ordersConnectionPresent: true,
    nodesIsArray: true,
    returnedNodeCount: 1,
    errorsPresent: true,
    errorPaths: ["orders.nodes[0].customer.email"],
    firstOrderStructuralValidation: "failed",
    failingPath: "currentTotalPriceSet",
    expectedStructuralType: "object",
    receivedStructuralType: "null",
  });
  assert.equal(JSON.stringify(diagnostics).includes("sensitive upstream detail"), false);
  assert.equal(JSON.stringify(diagnostics).includes("buyer@example.test"), false);
});
