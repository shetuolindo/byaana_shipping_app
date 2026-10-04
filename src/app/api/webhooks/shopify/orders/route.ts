import prisma from "@/lib/prisma";
import { getShopifyConfig, ShopifyConfigurationError } from "@/modules/shopify/config";
import { CONTROLLED_SHOPIFY_DOMAIN } from "@/modules/shopify/order-ingestion";
import {
  receiveShopifyOrderWebhook,
  ShopifyWebhookRequestError,
} from "@/modules/shopify/webhook-receipt";
import { createPrismaWebhookReceiptStore } from "@/modules/shopify/webhook-receipt-store";

export async function POST(request: Request) {
  let config;
  try {
    config = getShopifyConfig();
  } catch (error) {
    const status = error instanceof ShopifyConfigurationError ? 503 : 500;
    return new Response(null, { status });
  }

  let rawBody: Uint8Array;
  try {
    rawBody = new Uint8Array(await request.arrayBuffer());
  } catch {
    return new Response(null, { status: 400 });
  }

  try {
    await receiveShopifyOrderWebhook({
      rawBody,
      headers: request.headers,
      clientSecret: config.clientSecret,
      expectedShopDomain: CONTROLLED_SHOPIFY_DOMAIN,
      expectedApiVersion: config.apiVersion,
      store: createPrismaWebhookReceiptStore(prisma),
    });
    return new Response(null, { status: 200 });
  } catch (error) {
    if (error instanceof ShopifyWebhookRequestError) {
      return new Response(null, { status: error.httpStatus });
    }
    console.error("Shopify webhook receipt failed");
    return new Response(null, { status: 500 });
  }
}
