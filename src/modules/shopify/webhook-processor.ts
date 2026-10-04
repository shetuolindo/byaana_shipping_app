import type { NormalizedShopifyOrder, ShopifyWebhookSyncPersistence } from "./order-ingestion.ts";
import { synchronizeNormalizedShopifyOrder } from "./order-ingestion.ts";
import {
  SHOPIFY_ORDER_WEBHOOK_TOPICS,
  type ShopifyOrderWebhookTopic,
} from "./webhook-receipt.ts";

export const SHOPIFY_WEBHOOK_MAX_ATTEMPTS = 5;
export const SHOPIFY_WEBHOOK_STALE_CLAIM_MS = 5 * 60 * 1000;
export const SHOPIFY_WEBHOOK_RETRY_DELAY_MS = 60 * 1000;

export type ClaimedShopifyWebhookEvent = {
  id: string;
  shopId: string | null;
  eventType: string | null;
  resourceId: string | null;
  apiVersion: string | null;
  triggeredAt: Date | null;
  attemptCount: number;
  shop: {
    id: string;
    shopifyShopDomain: string;
    shopifyAccessTokenEncrypted: string | null;
    isActive: boolean;
  } | null;
};

type ProcessableShopifyWebhookEvent = Omit<ClaimedShopifyWebhookEvent,
  "shopId" | "eventType" | "resourceId" | "apiVersion" | "triggeredAt" | "shop"
> & {
  shopId: string;
  eventType: ShopifyOrderWebhookTopic;
  resourceId: string;
  apiVersion: string;
  triggeredAt: Date;
  shop: NonNullable<ClaimedShopifyWebhookEvent["shop"]> & {
    shopifyAccessTokenEncrypted: string;
  };
};

export type ShopifyWebhookProcessorStore = {
  claimNext(
    now: Date,
    staleBefore: Date,
    retryBefore: Date,
  ): Promise<ClaimedShopifyWebhookEvent | null>;
  markProcessed(eventId: string, processedAt: Date): Promise<void>;
  markSkipped(input: {
    eventId: string;
    processedAt: Date;
    reason: ShopifyWebhookSkipReason;
  }): Promise<void>;
  markFailed(input: {
    eventId: string;
    errorCode: ShopifyWebhookProcessingErrorCode;
    terminal: boolean;
  }): Promise<void>;
  recordSourceDeletion(input: {
    shopId: string;
    resourceId: string;
    triggeredAt: Date;
  }): Promise<"tombstoned" | "unchanged" | "missing">;
};

export type ShopifyWebhookProcessingErrorCode =
  | "INVALID_EVENT"
  | "CONFIGURATION_ERROR"
  | "SHOPIFY_READ_FAILED"
  | "ORDER_NOT_FOUND"
  | "ORDER_SYNC_FAILED";

export type ShopifyWebhookSkipReason =
  | "UNSEEN_FULFILLED_ORDER"
  | "UNSEEN_CANCELLED_ORDER"
  | "UNSEEN_DELETED_ORDER";

export class ShopifyWebhookProcessingError extends Error {
  readonly code: ShopifyWebhookProcessingErrorCode;
  readonly retryable: boolean;

  constructor(code: ShopifyWebhookProcessingErrorCode, retryable: boolean) {
    super("The Shopify webhook event could not be processed.");
    this.name = "ShopifyWebhookProcessingError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type ShopifyWebhookProcessorDependencies = {
  store: ShopifyWebhookProcessorStore;
  fetchOrder(event: ProcessableShopifyWebhookEvent): Promise<NormalizedShopifyOrder | null>;
  persistence: ShopifyWebhookSyncPersistence;
};

function processableEvent(event: ClaimedShopifyWebhookEvent): ProcessableShopifyWebhookEvent {
  const topic = event.eventType;
  if (!topic || !SHOPIFY_ORDER_WEBHOOK_TOPICS.includes(topic as ShopifyOrderWebhookTopic)
    || !event.shopId || !event.resourceId || !/^gid:\/\/shopify\/Order\/\d+$/.test(event.resourceId)
    || !event.apiVersion || !/^\d{4}-(?:01|04|07|10)$/.test(event.apiVersion)
    || !event.triggeredAt || Number.isNaN(event.triggeredAt.getTime())
    || !event.shop || event.shop.id !== event.shopId) {
    throw new ShopifyWebhookProcessingError("INVALID_EVENT", false);
  }
  if (topic !== "orders/delete"
    && (!event.shop.isActive || !event.shop.shopifyAccessTokenEncrypted)) {
    throw new ShopifyWebhookProcessingError("CONFIGURATION_ERROR", false);
  }
  return event as ProcessableShopifyWebhookEvent;
}

function processingFailure(error: unknown): ShopifyWebhookProcessingError {
  return error instanceof ShopifyWebhookProcessingError
    ? error
    : new ShopifyWebhookProcessingError("ORDER_SYNC_FAILED", true);
}

function unseenOrderSkipReason(
  topic: ShopifyOrderWebhookTopic,
  order: NormalizedShopifyOrder,
): ShopifyWebhookSkipReason | null {
  if (topic === "orders/cancelled") return "UNSEEN_CANCELLED_ORDER";
  if (topic !== "orders/updated") return null;
  if (order.shopifyCancelledAt !== null) return "UNSEEN_CANCELLED_ORDER";
  if (order.shopifyFulfillmentStatus === "FULFILLED") return "UNSEEN_FULFILLED_ORDER";
  return null;
}

export async function processNextShopifyWebhook(
  dependencies: ShopifyWebhookProcessorDependencies,
  now = new Date(),
) {
  const event = await dependencies.store.claimNext(
    now,
    new Date(now.getTime() - SHOPIFY_WEBHOOK_STALE_CLAIM_MS),
    new Date(now.getTime() - SHOPIFY_WEBHOOK_RETRY_DELAY_MS),
  );
  if (!event) return { outcome: "idle" as const };

  try {
    const processable = processableEvent(event);
    if (processable.eventType === "orders/delete") {
      const deletionOutcome = await dependencies.store.recordSourceDeletion({
        shopId: processable.shopId,
        resourceId: processable.resourceId,
        triggeredAt: processable.triggeredAt,
      });
      if (deletionOutcome === "missing") {
        const reason = "UNSEEN_DELETED_ORDER" as const;
        await dependencies.store.markSkipped({ eventId: processable.id, processedAt: now, reason });
        return { outcome: "skipped" as const, eventId: processable.id, reason, deletionOutcome };
      }
      await dependencies.store.markProcessed(processable.id, now);
      return { outcome: "processed" as const, eventId: processable.id, deletionOutcome };
    }

    let order: NormalizedShopifyOrder | null;
    try {
      order = await dependencies.fetchOrder(processable);
    } catch (error) {
      if (error instanceof ShopifyWebhookProcessingError) throw error;
      throw new ShopifyWebhookProcessingError("SHOPIFY_READ_FAILED", true);
    }
    if (!order) throw new ShopifyWebhookProcessingError("ORDER_NOT_FOUND", true);
    if (order.shopifyOrderId !== processable.resourceId) {
      throw new ShopifyWebhookProcessingError("INVALID_EVENT", false);
    }

    const skipReason = unseenOrderSkipReason(processable.eventType, order);
    const synchronization = await synchronizeNormalizedShopifyOrder(
      order,
      processable.shopId,
      dependencies.persistence,
      { createUnseen: skipReason === null },
    );
    if (synchronization.outcome === "skipped") {
      if (!skipReason) throw new ShopifyWebhookProcessingError("ORDER_SYNC_FAILED", true);
      await dependencies.store.markSkipped({ eventId: processable.id, processedAt: now, reason: skipReason });
      return {
        outcome: "skipped" as const,
        eventId: processable.id,
        reason: skipReason,
        synchronization,
      };
    }
    await dependencies.store.markProcessed(processable.id, now);
    return {
      outcome: "processed" as const,
      eventId: processable.id,
      synchronization,
    };
  } catch (error) {
    const failure = processingFailure(error);
    const terminal = !failure.retryable || event.attemptCount >= SHOPIFY_WEBHOOK_MAX_ATTEMPTS;
    await dependencies.store.markFailed({ eventId: event.id, errorCode: failure.code, terminal });
    return {
      outcome: terminal ? "failed" as const : "retryable" as const,
      eventId: event.id,
      errorCode: failure.code,
      attemptCount: event.attemptCount,
    };
  }
}

export async function runShopifyWebhookOneShot(input: {
  dependencies: ShopifyWebhookProcessorDependencies;
  limit: number;
  now?: () => Date;
}) {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new Error("The Shopify webhook processor limit must be between 1 and 100.");
  }
  const summary = { processed: 0, skipped: 0, retryable: 0, failed: 0 };
  for (let index = 0; index < input.limit; index += 1) {
    const result = await processNextShopifyWebhook(input.dependencies, input.now?.() ?? new Date());
    if (result.outcome === "idle") break;
    summary[result.outcome] += 1;
  }
  return summary;
}
