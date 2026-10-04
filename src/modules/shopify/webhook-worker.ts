export const SHOPIFY_WEBHOOK_IDLE_POLL_MS = 5_000;

export type ShopifyWebhookWorkerIterationResult = {
  outcome: "idle" | "processed" | "skipped" | "retryable" | "failed";
  eventId?: string;
  errorCode?: string;
  attemptCount?: number;
};

export type ShopifyWebhookWorkerOptions = {
  signal: AbortSignal;
  processNext(): Promise<ShopifyWebhookWorkerIterationResult>;
  idlePollMs?: number;
  waitForIdle?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  onResult?: (result: ShopifyWebhookWorkerIterationResult) => void;
};

export function waitForShopifyWebhookPoll(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    };

    const timeout = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

export async function runShopifyWebhookWorker(options: ShopifyWebhookWorkerOptions) {
  const idlePollMs = options.idlePollMs ?? SHOPIFY_WEBHOOK_IDLE_POLL_MS;
  if (!Number.isFinite(idlePollMs) || idlePollMs <= 0) {
    throw new Error("The Shopify webhook worker idle poll interval must be positive.");
  }
  const waitForIdle = options.waitForIdle ?? waitForShopifyWebhookPoll;

  while (!options.signal.aborted) {
    const result = await options.processNext();
    options.onResult?.(result);
    if (options.signal.aborted) break;
    if (result.outcome === "idle") {
      await waitForIdle(idlePollMs, options.signal);
    }
  }
}

export async function runShopifyWebhookWorkerUntilShutdown(input: {
  run(): Promise<void>;
  disconnect(): Promise<void>;
}) {
  try {
    await input.run();
  } finally {
    await input.disconnect();
  }
}
