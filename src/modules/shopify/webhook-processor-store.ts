import {
  OrderSource,
  Prisma,
  ShopifySyncState,
  type PrismaClient,
} from "@prisma/client";
import {
  SHOPIFY_WEBHOOK_MAX_ATTEMPTS,
  type ShopifyWebhookProcessingErrorCode,
  type ShopifyWebhookProcessorStore,
  type ShopifyWebhookSkipReason,
} from "./webhook-processor.ts";
import { getShopifySourceDeletionUpdate } from "./source-deletion.ts";

const ERROR_MESSAGES: Record<ShopifyWebhookProcessingErrorCode, string> = {
  INVALID_EVENT: "Stored webhook metadata is invalid.",
  CONFIGURATION_ERROR: "Shopify processing configuration is unavailable.",
  SHOPIFY_READ_FAILED: "The authoritative Shopify order could not be read.",
  ORDER_NOT_FOUND: "The authoritative Shopify order was not available.",
  ORDER_SYNC_FAILED: "The Shopify order could not be synchronized.",
};

const SKIP_MESSAGES: Record<ShopifyWebhookSkipReason, string> = {
  UNSEEN_FULFILLED_ORDER: "The unseen Shopify order was already fulfilled and was intentionally skipped.",
  UNSEEN_CANCELLED_ORDER: "The unseen Shopify order was already cancelled and was intentionally skipped.",
  UNSEEN_DELETED_ORDER: "The unseen Shopify order was already deleted and was intentionally skipped.",
};

export function createPrismaShopifyWebhookProcessorStore(
  client: PrismaClient,
): ShopifyWebhookProcessorStore {
  return {
    async claimNext(now, staleBefore, retryBefore) {
      return client.$transaction(async (tx) => {
        const eligibility = {
          provider: "SHOPIFY",
          attemptCount: { lt: SHOPIFY_WEBHOOK_MAX_ATTEMPTS },
          OR: [
            { status: "PENDING" },
            {
              status: "RETRYABLE",
              OR: [
                { lastAttemptAt: null },
                { lastAttemptAt: { lte: retryBefore } },
              ],
            },
            { status: "PROCESSING", processingStartedAt: { lte: staleBefore } },
          ],
        } satisfies Prisma.WebhookEventWhereInput;
        const candidate = await tx.webhookEvent.findFirst({
          where: eligibility,
          orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
          select: { id: true, attemptCount: true, status: true, processingStartedAt: true },
        });
        if (!candidate) return null;

        const claimed = await tx.webhookEvent.updateMany({
          where: {
            id: candidate.id,
            attemptCount: candidate.attemptCount,
            status: candidate.status,
            processingStartedAt: candidate.processingStartedAt,
          },
          data: {
            status: "PROCESSING",
            processingStartedAt: now,
            lastAttemptAt: now,
            attemptCount: { increment: 1 },
            errorCode: null,
            errorMessage: null,
          },
        });
        if (claimed.count !== 1) return null;
        return tx.webhookEvent.findUnique({
          where: { id: candidate.id },
          select: {
            id: true,
            shopId: true,
            eventType: true,
            resourceId: true,
            apiVersion: true,
            triggeredAt: true,
            attemptCount: true,
            shop: {
              select: {
                id: true,
                shopifyShopDomain: true,
                shopifyAccessTokenEncrypted: true,
                isActive: true,
              },
            },
          },
        });
      });
    },

    async markProcessed(eventId, processedAt) {
      const result = await client.webhookEvent.updateMany({
        where: { id: eventId, status: "PROCESSING" },
        data: {
          status: "PROCESSED",
          processedAt,
          processingStartedAt: null,
          errorCode: null,
          errorMessage: null,
        },
      });
      if (result.count !== 1) throw new Error("Webhook processing state changed unexpectedly.");
    },

    async markSkipped({ eventId, processedAt, reason }) {
      const result = await client.webhookEvent.updateMany({
        where: { id: eventId, status: "PROCESSING" },
        data: {
          status: "SKIPPED",
          processedAt,
          processingStartedAt: null,
          errorCode: reason,
          errorMessage: SKIP_MESSAGES[reason],
        },
      });
      if (result.count !== 1) throw new Error("Webhook processing state changed unexpectedly.");
    },

    async markFailed({ eventId, errorCode, terminal }) {
      const result = await client.webhookEvent.updateMany({
        where: { id: eventId, status: "PROCESSING" },
        data: {
          status: terminal ? "FAILED" : "RETRYABLE",
          processingStartedAt: null,
          processedAt: null,
          errorCode,
          errorMessage: ERROR_MESSAGES[errorCode],
        },
      });
      if (result.count !== 1) throw new Error("Webhook processing state changed unexpectedly.");
    },

    async recordSourceDeletion({ shopId, resourceId, triggeredAt }) {
      return client.$transaction(async (tx) => {
        const candidate = await tx.order.findFirst({
          where: {
            shopId,
            source: OrderSource.SHOPIFY,
            shopifyOrderId: resourceId,
          },
          select: { id: true },
        });
        if (!candidate) return "missing";
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "Order" WHERE "id" = ${candidate.id} FOR UPDATE
        `);
        const order = await tx.order.findUnique({
          where: { id: candidate.id },
          select: {
            shopifySyncState: true,
            shopifyDeletedAt: true,
            shopifyLastSeenUpdatedAt: true,
          },
        });
        if (!order) return "missing";
        const update = getShopifySourceDeletionUpdate(order, triggeredAt);
        if (!update) return "unchanged";
        await tx.order.update({
          where: { id: candidate.id },
          data: {
            ...update,
            shopifySyncState: ShopifySyncState.SOURCE_DELETED,
          },
        });
        await tx.auditLog.create({
          data: {
            action: "SHOPIFY_ORDER_SOURCE_DELETED",
            entityType: "Order",
            entityId: candidate.id,
            metadata: { source: "SHOPIFY" },
          },
        });
        return "tombstoned";
      });
    },
  };
}
