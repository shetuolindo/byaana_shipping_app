import {
  disconnectControlledImporter,
  runControlledShopifyDiagnostics,
} from "../src/modules/shopify/controlled-order-import.ts";
import { ShopifyOrderIngestionError } from "../src/modules/shopify/order-ingestion.ts";

function importLimit(argumentsList: string[]) {
  const limitArgument = argumentsList.find((argument) => argument.startsWith("--limit="));
  return limitArgument ? Number(limitArgument.slice("--limit=".length)) : 5;
}

async function main() {
  if (process.argv.slice(2).includes("--runtime-smoke")) {
    console.log(JSON.stringify({ runtimeLoaded: true, shopifyRequestAttempted: false }));
    return;
  }

  const diagnostics = await runControlledShopifyDiagnostics(importLimit(process.argv.slice(2)));
  console.log(JSON.stringify(diagnostics, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof ShopifyOrderIngestionError
      ? error.message
      : "The sanitized Shopify diagnostic failed.");
    process.exitCode = 1;
  })
  .finally(disconnectControlledImporter);
