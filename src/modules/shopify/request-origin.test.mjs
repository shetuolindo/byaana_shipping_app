import assert from "node:assert/strict";
import test from "node:test";
import { isExpectedShopifyAppOrigin } from "./request-origin.ts";

const appUrl = "https://shipping.example.test";

test("accepts only the configured public Shopify application origin", () => {
  assert.equal(isExpectedShopifyAppOrigin(appUrl, appUrl), true);
  assert.equal(isExpectedShopifyAppOrigin(null, appUrl), false);
  assert.equal(isExpectedShopifyAppOrigin("http://shipping.example.test", appUrl), false);
  assert.equal(isExpectedShopifyAppOrigin("https://shipping.example.test.evil.test", appUrl), false);
  assert.equal(isExpectedShopifyAppOrigin(`${appUrl}/`, appUrl), false);
});
