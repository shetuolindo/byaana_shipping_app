import type { PrismaClient } from "@prisma/client";
import { fetchShopifyOrderById } from "./order-source.ts";
import { createPrismaShopifyOrderPersistence } from "./order-persistence.ts";
import { decryptShopifyAccessToken } from "./token-encryption.ts";
import {
  ShopifyWebhookProcessingError,
  type ShopifyWebhookProcessorDependencies,
} from "./webhook-processor.ts";
import { createPrismaShopifyWebhookProcessorStore } from "./webhook-processor-store.ts";

export function createPrismaShopifyWebhookProcessorDependencies(input: {
  client: PrismaClient;
  tokenEncryptionKey: string;
}): ShopifyWebhookProcessorDependencies {
  return {
    store: createPrismaShopifyWebhookProcessorStore(input.client),
    persistence: createPrismaShopifyOrderPersistence(input.client),
    async fetchOrder(event) {
      if (!event.shop.shopifyAccessTokenEncrypted) {
        throw new ShopifyWebhookProcessingError("CONFIGURATION_ERROR", false);
      }

      let accessToken: string;
      try {
        accessToken = decryptShopifyAccessToken(
          event.shop.shopifyAccessTokenEncrypted,
          event.shop.shopifyShopDomain,
          input.tokenEncryptionKey,
        );
      } catch {
        throw new ShopifyWebhookProcessingError("CONFIGURATION_ERROR", false);
      }

      return fetchShopifyOrderById({
        shopDomain: event.shop.shopifyShopDomain,
        accessToken,
        apiVersion: event.apiVersion,
        shopifyOrderId: event.resourceId,
      });
    },
  };
}
