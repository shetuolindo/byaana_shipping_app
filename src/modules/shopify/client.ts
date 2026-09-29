import "server-only";

import { z } from "zod";
import { SHOPIFY_REQUIRED_SCOPES, SHOPIFY_REQUEST_TIMEOUT_MS } from "./constants";
import type { ShopifyConfig } from "./config";
import { normalizeShopifyShopDomain } from "./shop-domain";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1).max(4_096),
  scope: z.string().max(4_096),
  expires_in: z.number().positive().optional(),
  refresh_token: z.string().min(1).max(4_096).optional(),
  associated_user: z.unknown().optional(),
});

const shopIdentityResponseSchema = z.object({
  data: z.object({
    shop: z.object({
      name: z.string().min(1),
      myshopifyDomain: z.string().min(1),
    }),
  }),
  errors: z.array(z.unknown()).optional(),
});

export class ShopifyConnectionError extends Error {
  constructor() {
    super("Shopify could not be connected.");
    this.name = "ShopifyConnectionError";
  }
}

async function shopifyFetch(url: string, init: RequestInit) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(SHOPIFY_REQUEST_TIMEOUT_MS) });
  } catch {
    throw new ShopifyConnectionError();
  }
}

export async function exchangeShopifyAuthorizationCode(input: {
  shop: string;
  code: string;
  config: ShopifyConfig;
}) {
  const response = await shopifyFetch(`https://${input.shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      code: input.code,
    }),
  });
  if (!response.ok) throw new ShopifyConnectionError();

  const parsed = tokenResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new ShopifyConnectionError();
  if (
    parsed.data.expires_in !== undefined
    || parsed.data.refresh_token !== undefined
    || parsed.data.associated_user !== undefined
  ) {
    // This foundation stores one non-expiring offline token. Never persist an
    // online or expiring token while discarding the metadata needed to use it safely.
    throw new ShopifyConnectionError();
  }

  const grantedScopes = new Set(parsed.data.scope.split(",").map((scope) => scope.trim()));
  if (SHOPIFY_REQUIRED_SCOPES.some((scope) => !grantedScopes.has(scope))) {
    throw new ShopifyConnectionError();
  }

  return parsed.data.access_token;
}

export async function fetchShopifyIdentity(input: {
  shop: string;
  accessToken: string;
  apiVersion: string;
}) {
  const response = await shopifyFetch(
    `https://${input.shop}/admin/api/${input.apiVersion}/graphql.json`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": input.accessToken,
      },
      body: JSON.stringify({ query: "query ShopifyConnectionIdentity { shop { name myshopifyDomain } }" }),
    },
  );
  if (!response.ok) throw new ShopifyConnectionError();

  const parsed = shopIdentityResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success || parsed.data.errors?.length) throw new ShopifyConnectionError();

  const verifiedDomain = normalizeShopifyShopDomain(parsed.data.data.shop.myshopifyDomain);
  if (!verifiedDomain || verifiedDomain !== input.shop) throw new ShopifyConnectionError();

  return { name: parsed.data.data.shop.name, shopifyShopDomain: verifiedDomain };
}
