import "server-only";

import { z } from "zod";
import { isValidShopifyTokenEncryptionKey } from "./token-encryption";

const apiVersionPattern = /^\d{4}-(?:01|04|07|10)$/;

const shopifyEnvironmentSchema = z.object({
  SHOPIFY_CLIENT_ID: z.string().trim().min(1),
  SHOPIFY_CLIENT_SECRET: z.string().min(1),
  SHOPIFY_API_VERSION: z.string().regex(apiVersionPattern),
  SHOPIFY_APP_URL: z.string().url(),
  SHOPIFY_TOKEN_ENCRYPTION_KEY: z.string().refine(isValidShopifyTokenEncryptionKey),
});

export type ShopifyConfig = {
  clientId: string;
  clientSecret: string;
  apiVersion: string;
  appUrl: string;
  callbackUrl: string;
  tokenEncryptionKey: string;
};

export class ShopifyConfigurationError extends Error {
  constructor() {
    super("Shopify connection is not configured.");
    this.name = "ShopifyConfigurationError";
  }
}

export function getShopifyConfig(): ShopifyConfig {
  const result = shopifyEnvironmentSchema.safeParse(process.env);
  if (!result.success) throw new ShopifyConfigurationError();

  const appUrl = new URL(result.data.SHOPIFY_APP_URL);
  if (appUrl.protocol !== "https:" || appUrl.pathname !== "/" || appUrl.search || appUrl.hash) {
    throw new ShopifyConfigurationError();
  }

  return {
    clientId: result.data.SHOPIFY_CLIENT_ID,
    clientSecret: result.data.SHOPIFY_CLIENT_SECRET,
    apiVersion: result.data.SHOPIFY_API_VERSION,
    appUrl: appUrl.origin,
    callbackUrl: new URL("/api/shopify/callback", appUrl).toString(),
    tokenEncryptionKey: result.data.SHOPIFY_TOKEN_ENCRYPTION_KEY,
  };
}

export function isShopifyConfigured() {
  try {
    getShopifyConfig();
    return true;
  } catch {
    return false;
  }
}
