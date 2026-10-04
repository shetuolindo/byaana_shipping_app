import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaShopifyWebhookProcessorStore } from "./webhook-processor-store.ts";

function comparable(value) {
  return value instanceof Date ? value.getTime() : value;
}

function matches(row, where) {
  return Object.entries(where).every(([field, expected]) => {
    if (field === "OR") return expected.some((branch) => matches(row, branch));
    const actual = row[field];
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      if ("lt" in expected && !(comparable(actual) < comparable(expected.lt))) return false;
      if ("lte" in expected && !(comparable(actual) <= comparable(expected.lte))) return false;
      return true;
    }
    return comparable(actual) === comparable(expected);
  });
}

function fakeClaimClient(initialRow, options = {}) {
  let row = structuredClone(initialRow);
  let selectionCount = 0;
  let releaseSelections;
  const selectionsReady = new Promise((resolve) => { releaseSelections = resolve; });

  const tx = {
    webhookEvent: {
      async findFirst({ where }) {
        const candidate = row && matches(row, where) ? structuredClone(row) : null;
        if (options.synchronizeSelections) {
          selectionCount += 1;
          if (selectionCount === options.synchronizeSelections) releaseSelections();
          await selectionsReady;
        }
        return candidate;
      },
      async updateMany({ where, data }) {
        if (!row || !matches(row, where)) return { count: 0 };
        row = {
          ...row,
          ...data,
          attemptCount: row.attemptCount + (data.attemptCount?.increment ?? 0),
        };
        return { count: 1 };
      },
      async findUnique() {
        return row ? structuredClone(row) : null;
      },
    },
  };

  return {
    client: {
      async $transaction(operation) { return operation(tx); },
    },
    get row() { return row; },
  };
}

function storedEvent(overrides = {}) {
  return {
    id: "event-1",
    provider: "SHOPIFY",
    status: "PENDING",
    attemptCount: 0,
    processingStartedAt: null,
    lastAttemptAt: null,
    receivedAt: new Date("2026-10-05T00:00:00Z"),
    shopId: "shop-1",
    eventType: "orders/updated",
    resourceId: "gid://shopify/Order/1001",
    apiVersion: "2026-10",
    triggeredAt: new Date("2026-10-05T00:00:00Z"),
    shop: null,
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

const now = new Date("2026-10-05T00:10:00Z");
const staleBefore = new Date("2026-10-05T00:05:00Z");
const retryBefore = new Date("2026-10-05T00:09:00Z");

test("reclaims stale interrupted processing at the fifth claim", async () => {
  const state = fakeClaimClient(storedEvent({
    status: "PROCESSING",
    attemptCount: 5,
    processingStartedAt: new Date("2026-10-05T00:04:59Z"),
  }));
  const store = createPrismaShopifyWebhookProcessorStore(state.client);

  const claimed = await store.claimNext(now, staleBefore, retryBefore);

  assert.equal(claimed.id, "event-1");
  assert.equal(claimed.attemptCount, 6);
  assert.equal(state.row.status, "PROCESSING");
  assert.equal(state.row.processingStartedAt.getTime(), now.getTime());
});

test("does not extend the five-claim limit for ordinary pending or retryable work", async () => {
  for (const event of [
    storedEvent({ status: "PENDING", attemptCount: 5 }),
    storedEvent({
      status: "RETRYABLE",
      attemptCount: 5,
      lastAttemptAt: new Date("2026-10-05T00:08:00Z"),
    }),
  ]) {
    const state = fakeClaimClient(event);
    const store = createPrismaShopifyWebhookProcessorStore(state.client);
    assert.equal(await store.claimNext(now, staleBefore, retryBefore), null);
  }
});

test("allows only one of multiple contenders to claim an event", async () => {
  const state = fakeClaimClient(storedEvent(), { synchronizeSelections: 2 });
  const firstStore = createPrismaShopifyWebhookProcessorStore(state.client);
  const secondStore = createPrismaShopifyWebhookProcessorStore(state.client);

  const claims = await Promise.all([
    firstStore.claimNext(now, staleBefore, retryBefore),
    secondStore.claimNext(now, staleBefore, retryBefore),
  ]);

  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(state.row.attemptCount, 1);
  assert.equal(state.row.status, "PROCESSING");
});
