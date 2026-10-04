import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { normalizeShopifyShopDomain } from "./shop-domain.ts";

export const SHOPIFY_ORDER_WEBHOOK_TOPICS = [
  "orders/create",
  "orders/updated",
  "orders/cancelled",
  "orders/delete",
] as const;

export type ShopifyOrderWebhookTopic = (typeof SHOPIFY_ORDER_WEBHOOK_TOPICS)[number];

export type ShopifyWebhookReceipt = {
  externalEventId: string;
  eventId: string;
  topic: ShopifyOrderWebhookTopic;
  shopDomain: string;
  apiVersion: string;
  triggeredAt: Date;
  resourceId: string;
};

export type ShopifyWebhookReceiptStore = {
  findActiveShopId(shopDomain: string): Promise<string | null>;
  createReceipt(shopId: string, receipt: ShopifyWebhookReceipt): Promise<"created" | "duplicate">;
};

export class ShopifyWebhookRequestError extends Error {
  readonly code: "INVALID_HMAC" | "INVALID_DELIVERY" | "UNKNOWN_SHOP";
  readonly httpStatus: number;

  constructor(code: ShopifyWebhookRequestError["code"], httpStatus: number) {
    super("The Shopify webhook delivery could not be accepted.");
    this.name = "ShopifyWebhookRequestError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const uuidSchema = z.string().uuid();
const apiVersionSchema = z.string().regex(/^\d{4}-(?:01|04|07|10)$/);
const timestampSchema = z.string().datetime({ offset: true });
const orderGidSchema = z.string().regex(/^gid:\/\/shopify\/Order\/\d+$/);
const minimalPayloadSchema = z.object({
  id: z.union([z.string().regex(/^\d+$/), z.number().nonnegative()]).optional(),
  admin_graphql_api_id: orderGidSchema.optional(),
  updated_at: timestampSchema.optional(),
}).passthrough();

function decodeBase64Digest(value: string) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.length === 32 && decoded.toString("base64") === value ? decoded : null;
}

export function verifyShopifyWebhookHmac(rawBody: Uint8Array, suppliedHmac: string | null, clientSecret: string) {
  if (!suppliedHmac || !clientSecret) return false;
  const supplied = decodeBase64Digest(suppliedHmac);
  if (!supplied) return false;
  const expected = createHmac("sha256", clientSecret).update(rawBody).digest();
  return timingSafeEqual(expected, supplied);
}

function requiredHeader(headers: Headers, name: string, maximumLength: number) {
  const value = headers.get(name)?.trim();
  if (!value || value.length > maximumLength || value.includes(",")) {
    throw new ShopifyWebhookRequestError("INVALID_DELIVERY", 400);
  }
  return value;
}

function skipWhitespace(value: string, start: number) {
  let index = start;
  while (/\s/.test(value[index] ?? "")) index += 1;
  return index;
}

function jsonStringEnd(value: string, start: number) {
  if (value[start] !== '"') return -1;
  for (let index = start + 1; index < value.length; index += 1) {
    if (value[index] === "\\") {
      index += 1;
    } else if (value[index] === '"') {
      return index + 1;
    }
  }
  return -1;
}

function jsonValueEnd(value: string, start: number) {
  if (value[start] === '"') return jsonStringEnd(value, start);
  if (value[start] !== "{" && value[start] !== "[") {
    let index = start;
    while (index < value.length && value[index] !== "," && value[index] !== "}") index += 1;
    return index;
  }

  const opening = value[start];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === '"') {
      index = jsonStringEnd(value, index) - 1;
      if (index < 0) return -1;
    } else if (value[index] === opening) {
      depth += 1;
    } else if (value[index] === closing) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function rawRootOrderId(rawText: string) {
  let index = skipWhitespace(rawText, 0);
  if (rawText[index] !== "{") return null;
  index += 1;
  while (index < rawText.length) {
    index = skipWhitespace(rawText, index);
    if (rawText[index] === "}") return null;
    const keyEnd = jsonStringEnd(rawText, index);
    if (keyEnd < 0) return null;
    const key = JSON.parse(rawText.slice(index, keyEnd)) as unknown;
    index = skipWhitespace(rawText, keyEnd);
    if (rawText[index] !== ":") return null;
    index = skipWhitespace(rawText, index + 1);
    const valueEnd = jsonValueEnd(rawText, index);
    if (valueEnd < 0) return null;
    if (key === "id") {
      const token = rawText.slice(index, valueEnd).trim();
      if (/^\d+$/.test(token)) return token;
      if (token.startsWith('"')) {
        const parsed = JSON.parse(token) as unknown;
        return typeof parsed === "string" && /^\d+$/.test(parsed) ? parsed : null;
      }
      return null;
    }
    index = skipWhitespace(rawText, valueEnd);
    if (rawText[index] === ",") {
      index += 1;
      continue;
    }
    if (rawText[index] === "}") return null;
    return null;
  }
  return null;
}

export function parseVerifiedShopifyWebhook(input: {
  rawBody: Uint8Array;
  headers: Headers;
  expectedShopDomain: string;
  expectedApiVersion: string;
}): ShopifyWebhookReceipt {
  const topicValue = requiredHeader(input.headers, "x-shopify-topic", 100);
  if (!SHOPIFY_ORDER_WEBHOOK_TOPICS.includes(topicValue as ShopifyOrderWebhookTopic)) {
    throw new ShopifyWebhookRequestError("INVALID_DELIVERY", 400);
  }
  const topic = topicValue as ShopifyOrderWebhookTopic;
  const shopDomain = normalizeShopifyShopDomain(requiredHeader(input.headers, "x-shopify-shop-domain", 255));
  if (!shopDomain || shopDomain !== input.expectedShopDomain) {
    throw new ShopifyWebhookRequestError("UNKNOWN_SHOP", 403);
  }
  const apiVersion = requiredHeader(input.headers, "x-shopify-api-version", 20);
  if (!apiVersionSchema.safeParse(apiVersion).success || apiVersion !== input.expectedApiVersion) {
    throw new ShopifyWebhookRequestError("INVALID_DELIVERY", 400);
  }
  const externalEventId = requiredHeader(input.headers, "x-shopify-webhook-id", 100);
  const eventId = requiredHeader(input.headers, "x-shopify-event-id", 100);
  if (!uuidSchema.safeParse(externalEventId).success || !uuidSchema.safeParse(eventId).success) {
    throw new ShopifyWebhookRequestError("INVALID_DELIVERY", 400);
  }
  const triggeredAtValue = requiredHeader(input.headers, "x-shopify-triggered-at", 100);
  if (!timestampSchema.safeParse(triggeredAtValue).success) {
    throw new ShopifyWebhookRequestError("INVALID_DELIVERY", 400);
  }

  let rawText: string;
  try {
    rawText = new TextDecoder("utf-8", { fatal: true }).decode(input.rawBody);
  } catch {
    throw new ShopifyWebhookRequestError("INVALID_DELIVERY", 400);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawText) as unknown;
  } catch {
    throw new ShopifyWebhookRequestError("INVALID_DELIVERY", 400);
  }
  const parsed = minimalPayloadSchema.safeParse(body);
  if (!parsed.success) throw new ShopifyWebhookRequestError("INVALID_DELIVERY", 400);

  const resourceId = parsed.data.admin_graphql_api_id
    ?? (topic === "orders/delete" ? rawRootOrderId(rawText) : null);
  const normalizedResourceId = resourceId?.startsWith("gid://")
    ? resourceId
    : resourceId ? `gid://shopify/Order/${resourceId}` : null;
  if (!normalizedResourceId || !orderGidSchema.safeParse(normalizedResourceId).success) {
    throw new ShopifyWebhookRequestError("INVALID_DELIVERY", 400);
  }

  return {
    externalEventId,
    eventId,
    topic,
    shopDomain,
    apiVersion,
    triggeredAt: new Date(triggeredAtValue),
    resourceId: normalizedResourceId,
  };
}

export async function receiveShopifyOrderWebhook(input: {
  rawBody: Uint8Array;
  headers: Headers;
  clientSecret: string;
  expectedShopDomain: string;
  expectedApiVersion: string;
  store: ShopifyWebhookReceiptStore;
}) {
  if (!verifyShopifyWebhookHmac(
    input.rawBody,
    input.headers.get("x-shopify-hmac-sha256"),
    input.clientSecret,
  )) {
    throw new ShopifyWebhookRequestError("INVALID_HMAC", 401);
  }
  const receipt = parseVerifiedShopifyWebhook(input);
  const shopId = await input.store.findActiveShopId(receipt.shopDomain);
  if (!shopId) throw new ShopifyWebhookRequestError("UNKNOWN_SHOP", 403);
  const outcome = await input.store.createReceipt(shopId, receipt);
  return { outcome, receipt };
}
