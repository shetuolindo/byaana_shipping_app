import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const ENVELOPE_VERSION = "v1";

export class ShopifyTokenEncryptionError extends Error {
  constructor() {
    super("Shopify token encryption is not configured correctly.");
    this.name = "ShopifyTokenEncryptionError";
  }
}

export function isValidShopifyTokenEncryptionKey(encodedKey: string) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encodedKey)) return false;
  const key = Buffer.from(encodedKey, "base64");
  return key.length === 32 && key.toString("base64") === encodedKey;
}

function encryptionKey(encodedKey: string) {
  if (!isValidShopifyTokenEncryptionKey(encodedKey)) throw new ShopifyTokenEncryptionError();
  return Buffer.from(encodedKey, "base64");
}

export function encryptShopifyAccessToken(token: string, shopDomain: string, encodedKey: string) {
  if (!token) throw new ShopifyTokenEncryptionError();

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(encodedKey), iv);
  cipher.setAAD(Buffer.from(shopDomain, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const authenticationTag = cipher.getAuthTag();

  return [
    ENVELOPE_VERSION,
    iv.toString("base64url"),
    authenticationTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptShopifyAccessToken(envelope: string, shopDomain: string, encodedKey: string) {
  const [version, ivValue, tagValue, ciphertextValue, extra] = envelope.split(".");
  if (version !== ENVELOPE_VERSION || !ivValue || !tagValue || !ciphertextValue || extra) {
    throw new ShopifyTokenEncryptionError();
  }

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      encryptionKey(encodedKey),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAAD(Buffer.from(shopDomain, "utf8"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof ShopifyTokenEncryptionError) throw error;
    throw new ShopifyTokenEncryptionError();
  }
}
