import { z } from "zod";
import prisma from "../src/lib/prisma.ts";
import { createPrismaShopifyWebhookProcessorDependencies } from "../src/modules/shopify/webhook-processor-dependencies.ts";
import { processNextShopifyWebhook } from "../src/modules/shopify/webhook-processor.ts";
import {
  runShopifyWebhookWorker,
  runShopifyWebhookWorkerUntilShutdown,
  type ShopifyWebhookWorkerIterationResult,
} from "../src/modules/shopify/webhook-worker.ts";

const environmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  SHOPIFY_TOKEN_ENCRYPTION_KEY: z.string().min(1),
});

function logResult(result: ShopifyWebhookWorkerIterationResult) {
  if (result.outcome === "idle") return;
  console.log(JSON.stringify({
    component: "shopify-webhook-worker",
    outcome: result.outcome,
    eventId: result.eventId,
    errorCode: result.errorCode,
    attemptCount: result.attemptCount,
  }));
}

async function main() {
  if (process.argv.slice(2).includes("--runtime-smoke")) {
    console.log(JSON.stringify({ runtimeLoaded: true, workerStarted: false, persistenceAttempted: false }));
    return;
  }

  const environment = environmentSchema.parse(process.env);
  const dependencies = createPrismaShopifyWebhookProcessorDependencies({
    client: prisma,
    tokenEncryptionKey: environment.SHOPIFY_TOKEN_ENCRYPTION_KEY,
  });
  const shutdown = new AbortController();
  const requestShutdown = () => shutdown.abort();
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);

  await runShopifyWebhookWorkerUntilShutdown({
    run: () => runShopifyWebhookWorker({
      signal: shutdown.signal,
      processNext: () => processNextShopifyWebhook(dependencies),
      onResult: logResult,
    }),
    disconnect: () => prisma.$disconnect(),
  });
}

main().catch(() => {
  console.error("The Shopify webhook worker stopped unexpectedly.");
  process.exitCode = 1;
});
