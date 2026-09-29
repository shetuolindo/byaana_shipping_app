import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptShopifyAccessToken,
  encryptShopifyAccessToken,
  isValidShopifyTokenEncryptionKey,
  ShopifyTokenEncryptionError,
} from "./token-encryption.ts";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const shop = "example-store.myshopify.com";

test("encrypts and decrypts a Shopify access token with authenticated encryption", () => {
  assert.equal(isValidShopifyTokenEncryptionKey(encryptionKey), true);
  assert.equal(isValidShopifyTokenEncryptionKey("not-a-key"), false);
  const encrypted = encryptShopifyAccessToken("test-access-token", shop, encryptionKey);
  assert.notEqual(encrypted.includes("test-access-token"), true);
  assert.equal(decryptShopifyAccessToken(encrypted, shop, encryptionKey), "test-access-token");
});

test("uses a fresh nonce for every encryption", () => {
  assert.notEqual(
    encryptShopifyAccessToken("same-token", shop, encryptionKey),
    encryptShopifyAccessToken("same-token", shop, encryptionKey),
  );
});

test("rejects tampered ciphertext, a different shop binding, and malformed keys", () => {
  const encrypted = encryptShopifyAccessToken("test-access-token", shop, encryptionKey);
  const parts = encrypted.split(".");
  parts[3] = `${parts[3].startsWith("A") ? "B" : "A"}${parts[3].slice(1)}`;

  assert.throws(() => decryptShopifyAccessToken(parts.join("."), shop, encryptionKey), ShopifyTokenEncryptionError);
  assert.throws(() => decryptShopifyAccessToken(encrypted, "other.myshopify.com", encryptionKey), ShopifyTokenEncryptionError);
  assert.throws(() => encryptShopifyAccessToken("token", shop, "not-a-key"), ShopifyTokenEncryptionError);
});
