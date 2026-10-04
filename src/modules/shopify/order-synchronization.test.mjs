import assert from "node:assert/strict";
import test from "node:test";
import { synchronizeNormalizedShopifyOrder } from "./order-ingestion.ts";

function order(overrides = {}) {
  return {
    shopifyOrderId: "gid://shopify/Order/1001",
    orderNumber: "#1001",
    shopifyOrderNumber: "#1001",
    externalCreatedAt: "2026-10-01T08:00:00.000Z",
    shopifyUpdatedAt: "2026-10-01T09:00:00.000Z",
    shopifyFinancialStatus: "PAID",
    shopifyFulfillmentStatus: "UNFULFILLED",
    shopifyCancelledAt: null,
    shopifyCancelReason: null,
    customerName: "Synthetic Recipient",
    customerEmail: "synthetic@example.test",
    customerPhone: "+440000000000",
    currency: "GBP",
    subtotal: "25.00",
    shippingAmount: "4.50",
    taxAmount: "5.00",
    totalAmount: "34.50",
    address: {
      name: "Synthetic Recipient",
      company: null,
      phone: "+440000000000",
      email: "synthetic@example.test",
      countryCode: "GB",
      province: "London",
      city: "London",
      district: null,
      address1: "1 Synthetic Street",
      address2: null,
      postalCode: "SW1A 1AA",
    },
    items: [{
      shopifyLineItemId: "gid://shopify/LineItem/2001",
      sku: "SHOP-SKU-1",
      name: "Synthetic item",
      quantity: 1,
      unitPrice: "25.00",
    }],
    ...overrides,
  };
}

function synchronizationStore(initialOrder = null) {
  const state = {
    order: initialOrder ? structuredClone(initialOrder) : null,
    audits: [],
    histories: [],
  };
  return {
    state,
    persistence: {
      async transaction(operation) {
        const draft = structuredClone(state);
        const result = await operation({
          async findByShopifyOrderId(shopifyOrderId) {
            if (!draft.order || draft.order.shopifyOrderId !== shopifyOrderId) return null;
            const { storedItems, ...snapshot } = draft.order;
            return {
              ...structuredClone(snapshot),
              items: storedItems.map((item) => ({
                shopifyLineItemId: item.shopifyLineItemId,
                sku: item.sku,
                name: item.name,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
              })),
            };
          },
          async createShopifyOrder(incoming, shopId) {
            draft.order = {
              id: "local-1",
              shopId,
              source: "SHOPIFY",
              internalStatus: "NEW",
              shopifyLastSeenUpdatedAt: incoming.shopifyUpdatedAt,
              shopifySyncState: "IN_SYNC",
              shopifyDeletedAt: null,
              hasShipments: false,
              ...structuredClone(incoming),
              storedItems: incoming.items.map((item) => ({ ...item, sgsSku: null })),
            };
            draft.histories.push({ fromStatus: null, toStatus: "NEW" });
            draft.audits.push({ action: "SHOPIFY_ORDER_IMPORTED" });
            return { id: draft.order.id };
          },
          async recordShopifyObservation(_orderId, incoming) {
            draft.order.shopifyLastSeenUpdatedAt = incoming.shopifyUpdatedAt;
          },
          async applyShopifySnapshot(_orderId, incoming, changedCategories) {
            const existingItems = new Map(
              draft.order.storedItems.map((item) => [item.shopifyLineItemId, item]),
            );
            const preserved = {
              id: draft.order.id,
              shopId: draft.order.shopId,
              source: draft.order.source,
              internalStatus: draft.order.internalStatus,
              hasShipments: draft.order.hasShipments,
            };
            draft.order = {
              ...preserved,
              ...structuredClone(incoming),
              shopifyLastSeenUpdatedAt: incoming.shopifyUpdatedAt,
              shopifySyncState: "IN_SYNC",
              shopifyDeletedAt: null,
              storedItems: incoming.items.map((item) => ({
                ...item,
                sgsSku: existingItems.get(item.shopifyLineItemId)?.sgsSku ?? null,
              })),
            };
            draft.audits.push({ action: "SHOPIFY_ORDER_SYNCED", changedCategories });
          },
          async recordShopifyReview(_orderId, incoming, changedCategories) {
            draft.order.shopifyOrderNumber = incoming.shopifyOrderNumber;
            draft.order.shopifyLastSeenUpdatedAt = incoming.shopifyUpdatedAt;
            draft.order.shopifySyncState = "REVIEW_REQUIRED";
            draft.order.shopifyFinancialStatus = incoming.shopifyFinancialStatus;
            draft.order.shopifyFulfillmentStatus = incoming.shopifyFulfillmentStatus;
            draft.order.shopifyCancelledAt = incoming.shopifyCancelledAt;
            draft.order.shopifyCancelReason = incoming.shopifyCancelReason;
            draft.audits.push({ action: "SHOPIFY_ORDER_REVIEW_REQUIRED", changedCategories });
          },
          async autoCancelShopifyOrder(_orderId, expectedStatus) {
            if (draft.order.internalStatus !== expectedStatus || draft.order.hasShipments) return false;
            draft.order.internalStatus = "CANCELLED";
            draft.histories.push({ fromStatus: expectedStatus, toStatus: "CANCELLED", actorUserId: null });
            draft.audits.push({ action: "SHOPIFY_ORDER_AUTO_CANCELLED" });
            return true;
          },
        });
        state.order = draft.order;
        state.audits = draft.audits;
        state.histories = draft.histories;
        return result;
      },
    },
  };
}

async function seededStore(overrides = {}) {
  const store = synchronizationStore();
  await synchronizeNormalizedShopifyOrder(order(), "shop-1", store.persistence);
  Object.assign(store.state.order, overrides);
  return store;
}

test("creates a new normalized Shopify order once with initial history and audit", async () => {
  const store = synchronizationStore();
  const first = await synchronizeNormalizedShopifyOrder(order(), "shop-1", store.persistence);
  const repeated = await synchronizeNormalizedShopifyOrder(order(), "shop-1", store.persistence);
  assert.equal(first.outcome, "created");
  assert.equal(repeated.outcome, "unchanged");
  assert.equal(store.state.order.shopifySyncState, "IN_SYNC");
  assert.equal(store.state.histories.length, 1);
  assert.equal(store.state.audits.length, 1);
});

test("records a newer unchanged observation without an audit or operational rewrite", async () => {
  const store = await seededStore();
  const originalAddress = structuredClone(store.state.order.address);
  const result = await synchronizeNormalizedShopifyOrder(
    order({ shopifyUpdatedAt: "2026-10-01T10:00:00.000Z" }),
    "shop-1",
    store.persistence,
  );
  assert.equal(result.outcome, "unchanged");
  assert.equal(store.state.order.shopifyUpdatedAt, "2026-10-01T09:00:00.000Z");
  assert.equal(store.state.order.shopifyLastSeenUpdatedAt, "2026-10-01T10:00:00.000Z");
  assert.deepEqual(store.state.order.address, originalAddress);
  assert.equal(store.state.audits.length, 1);
});

test("safely updates a NEW order, preserving surviving sgsSku and adding/removing lines", async () => {
  const store = await seededStore();
  store.state.order.storedItems[0].sgsSku = "LOCAL-SGS-1";
  const incoming = order({
    shopifyUpdatedAt: "2026-10-01T10:00:00.000Z",
    totalAmount: "20.00",
    address: { ...order().address, city: "Manchester" },
    items: [
      { ...order().items[0], quantity: 2 },
      {
        shopifyLineItemId: "gid://shopify/LineItem/2002",
        sku: "SHOP-SKU-2",
        name: "Added item",
        quantity: 1,
        unitPrice: "5.00",
      },
    ],
  });
  const result = await synchronizeNormalizedShopifyOrder(incoming, "shop-1", store.persistence);
  assert.equal(result.outcome, "updated");
  assert.equal(store.state.order.totalAmount, "20.00");
  assert.equal(store.state.order.storedItems[0].sgsSku, "LOCAL-SGS-1");
  assert.equal(store.state.order.storedItems[1].sgsSku, null);

  const removal = { ...incoming, shopifyUpdatedAt: "2026-10-01T11:00:00.000Z", items: [incoming.items[1]] };
  await synchronizeNormalizedShopifyOrder(removal, "shop-1", store.persistence);
  assert.deepEqual(store.state.order.storedItems.map((item) => item.shopifyLineItemId), [
    "gid://shopify/LineItem/2002",
  ]);
});

test("freezes operational data and requires review after progression or any Shipment", async () => {
  for (const overrides of [
    { internalStatus: "READY", hasShipments: false },
    { internalStatus: "NEW", hasShipments: true },
  ]) {
    const store = await seededStore(overrides);
    const originalTotal = store.state.order.totalAmount;
    const result = await synchronizeNormalizedShopifyOrder(order({
      shopifyUpdatedAt: "2026-10-01T10:00:00.000Z",
      totalAmount: "99.00",
    }), "shop-1", store.persistence);
    assert.equal(result.outcome, "review_required");
    assert.equal(store.state.order.totalAmount, originalTotal);
    assert.equal(store.state.order.shopifyUpdatedAt, "2026-10-01T09:00:00.000Z");
    assert.equal(store.state.order.shopifyLastSeenUpdatedAt, "2026-10-01T10:00:00.000Z");
    assert.equal(store.state.order.shopifySyncState, "REVIEW_REQUIRED");
  }
});

test("auto-cancels before shipment but requires review after progression or shipment", async () => {
  for (const internalStatus of ["NEW", "ON_HOLD", "READY"]) {
    const store = await seededStore({ internalStatus });
    const result = await synchronizeNormalizedShopifyOrder(order({
      shopifyUpdatedAt: "2026-10-01T10:00:00.000Z",
      shopifyCancelledAt: "2026-10-01T09:30:00.000Z",
      shopifyCancelReason: "CUSTOMER",
    }), "shop-1", store.persistence);
    assert.equal(result.autoCancelled, true);
    assert.equal(store.state.order.internalStatus, "CANCELLED");
    assert.equal(store.state.histories.at(-1).actorUserId, null);
  }

  for (const overrides of [
    { internalStatus: "PROCESSING", hasShipments: false },
    { internalStatus: "NEW", hasShipments: true },
  ]) {
    const store = await seededStore(overrides);
    const result = await synchronizeNormalizedShopifyOrder(order({
      shopifyUpdatedAt: "2026-10-01T10:00:00.000Z",
      shopifyCancelledAt: "2026-10-01T09:30:00.000Z",
      shopifyCancelReason: "CUSTOMER",
    }), "shop-1", store.persistence);
    assert.equal(result.autoCancelled, false);
    assert.equal(store.state.order.internalStatus, overrides.internalStatus);
    assert.equal(store.state.order.shopifySyncState, "REVIEW_REQUIRED");
  }
});

test("auto-cancels a newly discovered already-cancelled order exactly once", async () => {
  const store = synchronizationStore();
  const cancelled = order({
    shopifyCancelledAt: "2026-10-01T08:30:00.000Z",
    shopifyCancelReason: "CUSTOMER",
  });
  const result = await synchronizeNormalizedShopifyOrder(cancelled, "shop-1", store.persistence);
  const repeated = await synchronizeNormalizedShopifyOrder(cancelled, "shop-1", store.persistence);
  assert.equal(result.autoCancelled, true);
  assert.equal(repeated.outcome, "unchanged");
  assert.equal(store.state.histories.length, 2);
  assert.equal(store.state.audits.filter((audit) => audit.action === "SHOPIFY_ORDER_AUTO_CANCELLED").length, 1);
});

test("ignores stale and out-of-order snapshots", async () => {
  const store = await seededStore();
  const result = await synchronizeNormalizedShopifyOrder(order({
    shopifyUpdatedAt: "2026-10-01T08:59:59.000Z",
    totalAmount: "99.00",
  }), "shop-1", store.persistence);
  assert.equal(result.outcome, "unchanged");
  assert.equal(store.state.order.totalAmount, "34.50");
  assert.equal(store.state.order.shopifyLastSeenUpdatedAt, "2026-10-01T09:00:00.000Z");
});
