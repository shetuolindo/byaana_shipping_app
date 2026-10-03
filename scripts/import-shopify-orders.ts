import {
  CONTROLLED_SHOPIFY_DOMAIN,
  MAX_CONTROLLED_SHOPIFY_IMPORT,
  ShopifyOrderIngestionError,
} from "../src/modules/shopify/order-ingestion.ts";
import {
  disconnectControlledImporter,
  runControlledShopifyImport,
  ShopifyOrderResponseError,
} from "../src/modules/shopify/controlled-order-import.ts";

function importLimit(argumentsList: string[]) {
  const limitArgument = argumentsList.find((argument) => argument.startsWith("--limit="));
  if (!limitArgument) return MAX_CONTROLLED_SHOPIFY_IMPORT;
  return Number(limitArgument.slice("--limit=".length));
}

async function main() {
  if (process.argv.slice(2).includes("--runtime-smoke")) {
    console.log(JSON.stringify({ runtimeLoaded: true, persistenceAttempted: false }));
    return;
  }

  if (!process.argv.slice(2).includes("--confirm-local-write")) {
    throw new Error("Pass --confirm-local-write to acknowledge the controlled local database write.");
  }

  const summary = await runControlledShopifyImport(importLimit(process.argv.slice(2)));
  console.log(JSON.stringify({
    shop: CONTROLLED_SHOPIFY_DOMAIN,
    localOnly: true,
    maximumAllowed: MAX_CONTROLLED_SHOPIFY_IMPORT,
    requested: summary.requestedLimit,
    fetched: summary.fetched,
    created: summary.created,
    unchanged: summary.unchanged,
    conflicts: summary.conflicts,
    errors: summary.errors,
    failed: summary.failed,
    before: summary.before,
    after: summary.after,
    verification: summary.verification,
    shopifyOperation: "query-only",
  }));
  if (summary.failed > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    if (error instanceof ShopifyOrderResponseError) {
      console.error(JSON.stringify(error.diagnostics, null, 2));
    } else {
      console.error(error instanceof ShopifyOrderIngestionError
        ? error.message
        : "The controlled Shopify import failed.");
    }
    process.exitCode = 1;
  })
  .finally(disconnectControlledImporter);
