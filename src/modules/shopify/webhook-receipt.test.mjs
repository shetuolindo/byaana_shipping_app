import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  receiveShopifyOrderWebhook,
  ShopifyWebhookRequestError,
  verifyShopifyWebhookHmac,
} from "./webhook-receipt.ts";

const SECRET = "synthetic-webhook-secret";
const SHOP = "x612pp-ef.myshopify.com";
const VERSION = "2026-10";

function signedHeaders(rawBody, overrides = {}) {
  return new Headers({
    "x-shopify-hmac-sha256": createHmac("sha256", SECRET).update(rawBody).digest("base64"),
    "x-shopify-topic": "orders/updated",
    "x-shopify-shop-domain": SHOP,
    "x-shopify-api-version": VERSION,
    "x-shopify-webhook-id": "11111111-1111-4111-8111-111111111111",
    "x-shopify-event-id": "22222222-2222-4222-8222-222222222222",
    "x-shopify-triggered-at": "2026-10-04T12:00:00Z",
    ...overrides,
  });
}

function receiptStore() {
  const rows = new Map();
  let lookupCount = 0;
  return {
    rows,
    get lookupCount() { return lookupCount; },
    store: {
      async findActiveShopId(shopDomain) {
        lookupCount += 1;
        return shopDomain === SHOP ? "shop-1" : null;
      },
      async createReceipt(shopId, receipt) {
        await Promise.resolve();
        if (rows.has(receipt.externalEventId)) return "duplicate";
        rows.set(receipt.externalEventId, { shopId, ...structuredClone(receipt) });
        return "created";
      },
    },
  };
}

async function receive(rawText, store, overrides = {}) {
  const rawBody = Buffer.from(rawText);
  return receiveShopifyOrderWebhook({
    rawBody,
    headers: signedHeaders(rawBody, overrides),
    clientSecret: SECRET,
    expectedShopDomain: SHOP,
    expectedApiVersion: VERSION,
    store,
  });
}

test("accepts an exact raw-body HMAC and stores metadata without raw payload or PII", async () => {
  const state = receiptStore();
  const body = JSON.stringify({
    admin_graphql_api_id: "gid://shopify/Order/1001",
    updated_at: "2026-10-04T11:59:00Z",
    email: "private@example.test",
    shipping_address: { address1: "Private street" },
  });
  const result = await receive(body, state.store);

  assert.equal(result.outcome, "created");
  assert.equal(result.receipt.resourceId, "gid://shopify/Order/1001");
  assert.equal(state.rows.size, 1);
  const persisted = JSON.stringify([...state.rows.values()]);
  assert.equal(persisted.includes("private@example.test"), false);
  assert.equal(persisted.includes("Private street"), false);
  assert.equal(persisted.includes("shipping_address"), false);
  assert.equal(persisted.includes("payload"), false);
});

test("rejects missing, malformed, and body-altered HMACs before database lookup", async () => {
  const rawBody = Buffer.from('{"admin_graphql_api_id":"gid://shopify/Order/1001"}');
  assert.equal(verifyShopifyWebhookHmac(rawBody, null, SECRET), false);
  assert.equal(verifyShopifyWebhookHmac(rawBody, "not-base64", SECRET), false);

  for (const headers of [
    signedHeaders(rawBody, { "x-shopify-hmac-sha256": "" }),
    signedHeaders(Buffer.from("different body")),
  ]) {
    const state = receiptStore();
    await assert.rejects(
      receiveShopifyOrderWebhook({
        rawBody,
        headers,
        clientSecret: SECRET,
        expectedShopDomain: SHOP,
        expectedApiVersion: VERSION,
        store: state.store,
      }),
      (error) => error instanceof ShopifyWebhookRequestError && error.code === "INVALID_HMAC",
    );
    assert.equal(state.lookupCount, 0);
    assert.equal(state.rows.size, 0);
  }
});

test("rejects a wrong shop, unsupported topic/version, and malformed minimal payload", async () => {
  const cases = [
    [{ "x-shopify-shop-domain": "other.myshopify.com" }, "UNKNOWN_SHOP"],
    [{ "x-shopify-topic": "orders/fulfilled" }, "INVALID_DELIVERY"],
    [{ "x-shopify-api-version": "2026-07" }, "INVALID_DELIVERY"],
  ];
  for (const [headers, expectedCode] of cases) {
    const state = receiptStore();
    await assert.rejects(
      receive('{"admin_graphql_api_id":"gid://shopify/Order/1001"}', state.store, headers),
      (error) => error instanceof ShopifyWebhookRequestError && error.code === expectedCode,
    );
    assert.equal(state.rows.size, 0);
  }

  const malformed = receiptStore();
  await assert.rejects(
    receive('{"id":"not-an-order-id"}', malformed.store),
    (error) => error instanceof ShopifyWebhookRequestError && error.code === "INVALID_DELIVERY",
  );
  assert.equal(malformed.rows.size, 0);
});

test("deduplicates repeated and concurrent deliveries by Shopify webhook ID", async () => {
  const state = receiptStore();
  const body = '{"admin_graphql_api_id":"gid://shopify/Order/1001"}';
  const first = await receive(body, state.store);
  const duplicate = await receive(body, state.store);
  assert.equal(first.outcome, "created");
  assert.equal(duplicate.outcome, "duplicate");

  const concurrentState = receiptStore();
  const outcomes = await Promise.all([
    receive(body, concurrentState.store),
    receive(body, concurrentState.store),
  ]);
  assert.equal(outcomes.filter((result) => result.outcome === "created").length, 1);
  assert.equal(outcomes.filter((result) => result.outcome === "duplicate").length, 1);
  assert.equal(concurrentState.rows.size, 1);
});

test("preserves a large numeric orders/delete resource ID exactly", async () => {
  const state = receiptStore();
  const body = '{"nested":{"id":123},"id":90071992547409931234}';
  const result = await receive(body, state.store, { "x-shopify-topic": "orders/delete" });
  assert.equal(result.receipt.resourceId, "gid://shopify/Order/90071992547409931234");
});

test("rejects a non-integer orders/delete resource ID instead of truncating it", async () => {
  const state = receiptStore();
  await assert.rejects(
    receive('{"id":1001.5}', state.store, { "x-shopify-topic": "orders/delete" }),
    (error) => error instanceof ShopifyWebhookRequestError && error.code === "INVALID_DELIVERY",
  );
  assert.equal(state.rows.size, 0);
});
