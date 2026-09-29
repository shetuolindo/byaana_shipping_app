import assert from "node:assert/strict";
import test from "node:test";
import { normalizeShopifyShopDomain } from "./shop-domain.ts";

test("accepts and canonicalizes a valid myshopify.com domain", () => {
  assert.equal(normalizeShopifyShopDomain(" Example-Store.myshopify.com "), "example-store.myshopify.com");
  assert.equal(normalizeShopifyShopDomain("a.myshopify.com"), "a.myshopify.com");
});

test("rejects URLs, subdomains, ports, paths, and invalid labels", () => {
  const invalid = [
    "https://example-store.myshopify.com",
    "example-store.myshopify.com/path",
    "example-store.myshopify.com:443",
    "evil.example-store.myshopify.com",
    "example-store.myshopify.com.evil.test",
    "-example.myshopify.com",
    "example-.myshopify.com",
    "example.com",
    "",
  ];

  for (const value of invalid) assert.equal(normalizeShopifyShopDomain(value), null);
});

