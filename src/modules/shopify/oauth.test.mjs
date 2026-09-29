import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  buildShopifyAuthorizationUrl,
  createShopifyOAuthState,
  ShopifyCallbackValidationError,
  validateShopifyOAuthCallback,
  verifyShopifyCallbackHmac,
  verifyShopifyOAuthState,
} from "./oauth.ts";

const clientSecret = "test-client-secret";
const now = Date.UTC(2026, 8, 26, 12, 0, 0);
const shop = "example-store.myshopify.com";

function sign(params) {
  const message = [...params.entries()]
    .filter(([key]) => key !== "hmac")
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey < rightKey) return -1;
      if (leftKey > rightKey) return 1;
      return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  params.set("hmac", createHmac("sha256", clientSecret).update(message).digest("hex"));
  return params;
}

function validCallback() {
  const state = createShopifyOAuthState(shop, clientSecret, now);
  const params = sign(new URLSearchParams({
    code: "authorization-code",
    shop,
    state: state.state,
    timestamp: String(now / 1_000),
  }));
  return { params, stateCookie: state.cookieValue };
}

test("constructs the offline authorization URL with only the required scope", () => {
  const url = buildShopifyAuthorizationUrl({
    shop,
    clientId: "client-id",
    redirectUri: "https://portal.example.test/api/shopify/callback",
    scopes: ["read_orders"],
    state: "random-state",
  });

  assert.equal(url.origin, `https://${shop}`);
  assert.equal(url.pathname, "/admin/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.searchParams.get("scope"), "read_orders");
  assert.equal(url.searchParams.get("redirect_uri"), "https://portal.example.test/api/shopify/callback");
  assert.equal(url.searchParams.get("state"), "random-state");
  assert.equal(url.searchParams.has("grant_options[]"), false);
});

test("verifies a signed, unexpired OAuth state bound to the shop", () => {
  const state = createShopifyOAuthState(shop, clientSecret, now);
  assert.equal(verifyShopifyOAuthState(state.cookieValue, state.state, shop, clientSecret, now), true);
  assert.equal(verifyShopifyOAuthState(state.cookieValue, "wrong", shop, clientSecret, now), false);
  assert.equal(verifyShopifyOAuthState(state.cookieValue, state.state, "other.myshopify.com", clientSecret, now), false);
  assert.equal(verifyShopifyOAuthState(state.cookieValue, state.state, shop, clientSecret, now + 601_000), false);
});

test("verifies Shopify callback HMAC and rejects tampering", () => {
  const { params } = validCallback();
  assert.equal(verifyShopifyCallbackHmac(params, clientSecret), true);
  params.set("shop", "tampered.myshopify.com");
  assert.equal(verifyShopifyCallbackHmac(params, clientSecret), false);
});

test("accepts a fully verified callback", () => {
  const input = validCallback();
  assert.deepEqual(
    validateShopifyOAuthCallback({ ...input, clientSecret, now }),
    { code: "authorization-code", shop },
  );
});

test("safely rejects callbacks with invalid state, HMAC, domain, duplicate fields, or stale timestamps", () => {
  const cases = [];

  const invalidState = validCallback();
  invalidState.params.set("state", "invalid-state");
  cases.push(invalidState);

  const invalidHmac = validCallback();
  invalidHmac.params.set("hmac", "0".repeat(64));
  cases.push(invalidHmac);

  const invalidDomain = validCallback();
  invalidDomain.params.set("shop", "https://example-store.myshopify.com");
  cases.push(invalidDomain);

  const duplicateCode = validCallback();
  duplicateCode.params.append("code", "second-code");
  cases.push(duplicateCode);

  const stale = validCallback();
  stale.params.set("timestamp", String((now - 601_000) / 1_000));
  cases.push(stale);

  for (const input of cases) {
    assert.throws(
      () => validateShopifyOAuthCallback({ ...input, clientSecret, now }),
      ShopifyCallbackValidationError,
    );
  }
});

