import assert from "node:assert/strict";
import test from "node:test";
import {
  processNextShopifyWebhook,
  runShopifyWebhookOneShot,
  SHOPIFY_WEBHOOK_MAX_ATTEMPTS,
  ShopifyWebhookProcessingError,
} from "./webhook-processor.ts";

function event(overrides = {}) {
  return {
    id: "event-1",
    shopId: "shop-1",
    eventType: "orders/updated",
    resourceId: "gid://shopify/Order/1001",
    apiVersion: "2026-10",
    triggeredAt: new Date("2026-10-04T12:00:00Z"),
    attemptCount: 1,
    shop: {
      id: "shop-1",
      shopifyShopDomain: "synthetic.myshopify.com",
      shopifyAccessTokenEncrypted: "synthetic-encrypted-token",
      isActive: true,
    },
    ...overrides,
  };
}

function processorStore(claimedEvent, deletionOutcome = "tombstoned") {
  const state = {
    claimedEvent,
    status: "PENDING",
    errorCode: null,
    skipReason: null,
    deletions: [],
    claims: 0,
  };
  return {
    state,
    store: {
      async claimNext() {
        state.claims += 1;
        if (!state.claimedEvent) return null;
        const claimed = state.claimedEvent;
        state.claimedEvent = null;
        state.status = "PROCESSING";
        return claimed;
      },
      async markProcessed() { state.status = "PROCESSED"; },
      async markSkipped({ reason }) {
        state.status = "SKIPPED";
        state.errorCode = reason;
        state.skipReason = reason;
      },
      async markFailed({ errorCode, terminal }) {
        state.status = terminal ? "FAILED" : "RETRYABLE";
        state.errorCode = errorCode;
      },
      async recordSourceDeletion(input) {
        state.deletions.push(input);
        return deletionOutcome;
      },
    },
  };
}

const unusedPersistence = {
  async transaction() { throw new Error("unexpected synchronization"); },
};

function normalizedOrder(overrides = {}) {
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
    customerName: null,
    customerEmail: null,
    customerPhone: null,
    currency: "GBP",
    subtotal: "10.00",
    shippingAmount: "2.00",
    taxAmount: "0.00",
    totalAmount: "12.00",
    address: {
      name: null,
      company: null,
      phone: null,
      email: null,
      countryCode: null,
      province: null,
      city: null,
      district: null,
      address1: null,
      address2: null,
      postalCode: null,
    },
    items: [],
    ...overrides,
  };
}

function creationPersistence() {
  const state = { order: null, creates: 0, updates: 0, reviews: 0 };
  return {
    state,
    persistence: {
      async transaction(operation) {
        return operation({
          async findByShopifyOrderId() { return state.order; },
          async createShopifyOrder(incoming, shopId) {
            state.creates += 1;
            state.order = {
              id: "local-1",
              shopId,
              source: "SHOPIFY",
              internalStatus: "NEW",
              shopifyLastSeenUpdatedAt: incoming.shopifyUpdatedAt,
              shopifySyncState: "IN_SYNC",
              shopifyDeletedAt: null,
              hasShipments: false,
              ...structuredClone(incoming),
            };
            return { id: "local-1" };
          },
          async recordShopifyObservation(_orderId, incoming) {
            state.order.shopifyLastSeenUpdatedAt = incoming.shopifyUpdatedAt;
          },
          async applyShopifySnapshot(_orderId, incoming) {
            state.updates += 1;
            state.order = {
              ...state.order,
              ...structuredClone(incoming),
              shopifyLastSeenUpdatedAt: incoming.shopifyUpdatedAt,
              shopifySyncState: "IN_SYNC",
            };
          },
          async recordShopifyReview(_orderId, incoming) {
            state.reviews += 1;
            state.order.shopifyLastSeenUpdatedAt = incoming.shopifyUpdatedAt;
            state.order.shopifySyncState = "REVIEW_REQUIRED";
          },
          async autoCancelShopifyOrder() { return false; },
        });
      },
    },
  };
}

test("creates an unseen orders/create order as NEW", async () => {
  const persistence = creationPersistence();
  const state = processorStore(event({ eventType: "orders/create" }));
  const result = await processNextShopifyWebhook({
    store: state.store,
    persistence: persistence.persistence,
    async fetchOrder() { return normalizedOrder(); },
  });

  assert.equal(result.outcome, "processed");
  assert.equal(result.synchronization.outcome, "created");
  assert.equal(result.synchronization.internalStatus, "NEW");
  assert.equal(persistence.state.creates, 1);
  assert.equal(state.state.status, "PROCESSED");
});

test("creates an unseen actionable orders/updated order as recovery", async () => {
  const persistence = creationPersistence();
  const state = processorStore(event());
  const result = await processNextShopifyWebhook({
    store: state.store,
    persistence: persistence.persistence,
    async fetchOrder() { return normalizedOrder(); },
  });

  assert.equal(result.outcome, "processed");
  assert.equal(result.synchronization.outcome, "created");
  assert.equal(persistence.state.creates, 1);
  assert.equal(state.state.status, "PROCESSED");
});

test("successfully skips an unseen fulfilled orders/updated order", async () => {
  const persistence = creationPersistence();
  const state = processorStore(event());
  const result = await processNextShopifyWebhook({
    store: state.store,
    persistence: persistence.persistence,
    async fetchOrder() { return normalizedOrder({ shopifyFulfillmentStatus: "FULFILLED" }); },
  });

  assert.equal(result.outcome, "skipped");
  assert.equal(result.reason, "UNSEEN_FULFILLED_ORDER");
  assert.equal(persistence.state.creates, 0);
  assert.equal(state.state.status, "SKIPPED");
});

test("successfully skips an unseen cancelled orders/updated order", async () => {
  const persistence = creationPersistence();
  const state = processorStore(event());
  const result = await processNextShopifyWebhook({
    store: state.store,
    persistence: persistence.persistence,
    async fetchOrder() {
      return normalizedOrder({
        shopifyCancelledAt: "2026-10-01T10:00:00.000Z",
        shopifyCancelReason: "CUSTOMER",
      });
    },
  });

  assert.equal(result.outcome, "skipped");
  assert.equal(result.reason, "UNSEEN_CANCELLED_ORDER");
  assert.equal(persistence.state.creates, 0);
  assert.equal(state.state.status, "SKIPPED");
});

test("successfully skips an unseen orders/cancelled order", async () => {
  const persistence = creationPersistence();
  const state = processorStore(event({ eventType: "orders/cancelled" }));
  const result = await processNextShopifyWebhook({
    store: state.store,
    persistence: persistence.persistence,
    async fetchOrder() {
      return normalizedOrder({ shopifyCancelledAt: "2026-10-01T10:00:00.000Z" });
    },
  });

  assert.equal(result.outcome, "skipped");
  assert.equal(result.reason, "UNSEEN_CANCELLED_ORDER");
  assert.equal(persistence.state.creates, 0);
  assert.equal(state.state.status, "SKIPPED");
});

test("handles orders/delete without an Admin GraphQL read or unseen order creation", async () => {
  for (const [deletionOutcome, expectedOutcome, expectedStatus] of [
    ["tombstoned", "processed", "PROCESSED"],
    ["missing", "skipped", "SKIPPED"],
  ]) {
    const state = processorStore(event({ eventType: "orders/delete" }), deletionOutcome);
    let fetches = 0;
    const result = await processNextShopifyWebhook({
      store: state.store,
      persistence: unusedPersistence,
      async fetchOrder() { fetches += 1; return null; },
    });
    assert.equal(result.outcome, expectedOutcome);
    assert.equal(result.deletionOutcome, deletionOutcome);
    assert.equal(fetches, 0);
    assert.equal(state.state.deletions.length, 1);
    assert.equal(state.state.status, expectedStatus);
  }
});

test("does not retry intentionally skipped events", async () => {
  const persistence = creationPersistence();
  const state = processorStore(event());
  const summary = await runShopifyWebhookOneShot({
    limit: 5,
    dependencies: {
      store: state.store,
      persistence: persistence.persistence,
      async fetchOrder() { return normalizedOrder({ shopifyFulfillmentStatus: "FULFILLED" }); },
    },
  });

  assert.deepEqual(summary, { processed: 0, skipped: 1, retryable: 0, failed: 0 });
  assert.equal(state.state.status, "SKIPPED");
  assert.equal(state.state.claims, 2);
});

test("keeps existing local-order update behavior when unseen creation is disallowed", async () => {
  const persistence = creationPersistence();
  await processNextShopifyWebhook({
    store: processorStore(event({ eventType: "orders/create" })).store,
    persistence: persistence.persistence,
    async fetchOrder() { return normalizedOrder(); },
  });
  const state = processorStore(event({ id: "event-2" }));
  const result = await processNextShopifyWebhook({
    store: state.store,
    persistence: persistence.persistence,
    async fetchOrder() {
      return normalizedOrder({
        shopifyUpdatedAt: "2026-10-01T10:00:00.000Z",
        shopifyFulfillmentStatus: "FULFILLED",
      });
    },
  });

  assert.equal(result.outcome, "processed");
  assert.equal(result.synchronization.outcome, "updated");
  assert.equal(persistence.state.creates, 1);
  assert.equal(persistence.state.updates, 1);
  assert.equal(state.state.status, "PROCESSED");
});

test("keeps retryable processor failures bounded and terminal on the fifth attempt", async () => {
  for (const attemptCount of [1, SHOPIFY_WEBHOOK_MAX_ATTEMPTS]) {
    const state = processorStore(event({ attemptCount }));
    const result = await processNextShopifyWebhook({
      store: state.store,
      persistence: unusedPersistence,
      async fetchOrder() {
        throw new ShopifyWebhookProcessingError("SHOPIFY_READ_FAILED", true);
      },
    });
    assert.equal(result.errorCode, "SHOPIFY_READ_FAILED");
    assert.equal(result.outcome, attemptCount === SHOPIFY_WEBHOOK_MAX_ATTEMPTS ? "failed" : "retryable");
    assert.equal(state.state.status, attemptCount === SHOPIFY_WEBHOOK_MAX_ATTEMPTS ? "FAILED" : "RETRYABLE");
  }
});

test("fails invalid durable metadata without fetching or retrying", async () => {
  const state = processorStore(event({ resourceId: "not-a-gid" }));
  let fetches = 0;
  const result = await processNextShopifyWebhook({
    store: state.store,
    persistence: unusedPersistence,
    async fetchOrder() { fetches += 1; return null; },
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.errorCode, "INVALID_EVENT");
  assert.equal(fetches, 0);
  assert.equal(state.state.status, "FAILED");
});

test("treats an unavailable authoritative order as retryable", async () => {
  const state = processorStore(event());
  const result = await processNextShopifyWebhook({
    store: state.store,
    persistence: unusedPersistence,
    async fetchOrder() { return null; },
  });
  assert.equal(result.outcome, "retryable");
  assert.equal(result.errorCode, "ORDER_NOT_FOUND");
});
