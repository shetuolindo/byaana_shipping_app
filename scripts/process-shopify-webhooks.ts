import { z } from "zod";
import prisma from "../src/lib/prisma.ts";
import { fetchShopifyOrderById } from "../src/modules/shopify/order-source.ts";
import { createPrismaShopifyOrderPersistence } from "../src/modules/shopify/order-persistence.ts";
import { decryptShopifyAccessToken } from "../src/modules/shopify/token-encryption.ts";
import {
  runShopifyWebhookOneShot,
  ShopifyWebhookProcessingError,
} from "../src/modules/shopify/webhook-processor.ts";
import { createPrismaShopifyWebhookProcessorStore } from "../src/modules/shopify/webhook-processor-store.ts";

const environmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  SHOPIFY_TOKEN_ENCRYPTION_KEY: z.string().min(1),
});

function requestedLimit(argumentsList: string[]) {
  const value = argumentsList.find((argument) => argument.startsWith("--limit="));
  return value ? Number(value.slice("--limit=".length)) : 10;
}

function assertLocalDatabase(databaseUrl: string) {
  const hostname = new URL(databaseUrl).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    throw new Error("The one-shot Shopify webhook processor only permits a local database.");
  }
}

async function main() {
  if (process.argv.slice(2).includes("--runtime-smoke")) {
    console.log(JSON.stringify({ runtimeLoaded: true, persistenceAttempted: false, shopifyRequestAttempted: false }));
    return;
  }

  const environment = environmentSchema.parse(process.env);
  assertLocalDatabase(environment.DATABASE_URL);
  const store = createPrismaShopifyWebhookProcessorStore(prisma);
  const persistence = createPrismaShopifyOrderPersistence(prisma);
  const summary = await runShopifyWebhookOneShot({
    limit: requestedLimit(process.argv.slice(2)),
    dependencies: {
      store,
      persistence,
      async fetchOrder(event) {
        if (!event.shop.shopifyAccessTokenEncrypted) {
          throw new ShopifyWebhookProcessingError("CONFIGURATION_ERROR", false);
        }
        let accessToken: string;
        try {
          accessToken = decryptShopifyAccessToken(
            event.shop.shopifyAccessTokenEncrypted,
            event.shop.shopifyShopDomain,
            environment.SHOPIFY_TOKEN_ENCRYPTION_KEY,
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
    },
  });
  console.log(JSON.stringify({ ...summary, localOnly: true }));
  if (summary.failed > 0) process.exitCode = 1;
}

main()
  .catch(() => {
    console.error("The local Shopify webhook processor failed.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
