import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { SHOPIFY_OAUTH_STATE_MAX_AGE_SECONDS } from "./constants.ts";
import { normalizeShopifyShopDomain } from "./shop-domain.ts";

type OAuthStateRecord = {
  nonce: string;
  shop: string;
  createdAt: number;
};

export type ValidatedShopifyCallback = {
  code: string;
  shop: string;
};

export class ShopifyCallbackValidationError extends Error {
  constructor() {
    super("The Shopify authorization response could not be verified.");
    this.name = "ShopifyCallbackValidationError";
  }
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function signStatePayload(encodedPayload: string, clientSecret: string) {
  return createHmac("sha256", clientSecret).update(encodedPayload).digest("base64url");
}

export function createShopifyOAuthState(
  shop: string,
  clientSecret: string,
  now = Date.now(),
) {
  const nonce = randomBytes(32).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ nonce, shop, createdAt: now })).toString("base64url");
  const signature = signStatePayload(payload, clientSecret);

  return { state: nonce, cookieValue: `${payload}.${signature}` };
}

export function verifyShopifyOAuthState(
  cookieValue: string | undefined,
  returnedState: string,
  returnedShop: string,
  clientSecret: string,
  now = Date.now(),
) {
  if (!cookieValue) return false;

  const [payload, signature, extra] = cookieValue.split(".");
  if (!payload || !signature || extra) return false;
  if (!safeEqual(signature, signStatePayload(payload, clientSecret))) return false;

  try {
    const record = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<OAuthStateRecord>;
    const maxAgeMs = SHOPIFY_OAUTH_STATE_MAX_AGE_SECONDS * 1_000;

    return typeof record.nonce === "string"
      && typeof record.shop === "string"
      && typeof record.createdAt === "number"
      && record.createdAt <= now
      && now - record.createdAt <= maxAgeMs
      && safeEqual(record.nonce, returnedState)
      && safeEqual(record.shop, returnedShop);
  } catch {
    return false;
  }
}

export function buildShopifyAuthorizationUrl(input: {
  shop: string;
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
}) {
  const url = new URL(`https://${input.shop}/admin/oauth/authorize`);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    scope: input.scopes.join(","),
    redirect_uri: input.redirectUri,
    state: input.state,
  }).toString();
  return url;
}

function hasExactlyOne(params: URLSearchParams, key: string) {
  return params.getAll(key).length === 1;
}

export function verifyShopifyCallbackHmac(params: URLSearchParams, clientSecret: string) {
  if (!hasExactlyOne(params, "hmac")) return false;
  const suppliedHmac = params.get("hmac");
  if (!suppliedHmac || !/^[a-f0-9]{64}$/i.test(suppliedHmac)) return false;

  const message = [...params.entries()]
    .filter(([key]) => key !== "hmac")
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey < rightKey) return -1;
      if (leftKey > rightKey) return 1;
      if (leftValue < rightValue) return -1;
      if (leftValue > rightValue) return 1;
      return 0;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const expectedHmac = createHmac("sha256", clientSecret).update(message).digest("hex");

  return safeEqual(expectedHmac, suppliedHmac.toLowerCase());
}

export function validateShopifyOAuthCallback(input: {
  params: URLSearchParams;
  stateCookie: string | undefined;
  clientSecret: string;
  now?: number;
}): ValidatedShopifyCallback {
  const required = ["code", "hmac", "shop", "state", "timestamp"];
  if (required.some((key) => !hasExactlyOne(input.params, key))) {
    throw new ShopifyCallbackValidationError();
  }

  const code = input.params.get("code") ?? "";
  const state = input.params.get("state") ?? "";
  const shop = normalizeShopifyShopDomain(input.params.get("shop"));
  const timestamp = input.params.get("timestamp") ?? "";
  const now = input.now ?? Date.now();
  const timestampMs = Number(timestamp) * 1_000;

  if (!code || !state || !shop || !/^\d+$/.test(timestamp)) {
    throw new ShopifyCallbackValidationError();
  }
  if (!Number.isSafeInteger(timestampMs) || Math.abs(now - timestampMs) > SHOPIFY_OAUTH_STATE_MAX_AGE_SECONDS * 1_000) {
    throw new ShopifyCallbackValidationError();
  }
  if (!verifyShopifyOAuthState(input.stateCookie, state, shop, input.clientSecret, now)) {
    throw new ShopifyCallbackValidationError();
  }
  if (!verifyShopifyCallbackHmac(input.params, input.clientSecret)) {
    throw new ShopifyCallbackValidationError();
  }

  return { code, shop };
}
