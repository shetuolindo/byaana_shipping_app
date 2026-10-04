import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import type { ShopifyWebhookReceipt, ShopifyWebhookReceiptStore } from "./webhook-receipt";

export function createPrismaWebhookReceiptStore(client: PrismaClient): ShopifyWebhookReceiptStore {
  return {
    async findActiveShopId(shopDomain) {
      const shop = await client.shop.findFirst({
        where: {
          shopifyShopDomain: shopDomain,
          isActive: true,
          shopifyAccessTokenEncrypted: { not: null },
        },
        select: { id: true },
      });
      return shop?.id ?? null;
    },

    async createReceipt(shopId, receipt) {
      try {
        await client.webhookEvent.create({
          data: {
            provider: "SHOPIFY",
            externalEventId: receipt.externalEventId,
            eventType: receipt.topic,
            status: "PENDING",
            shopId,
            resourceId: receipt.resourceId,
            eventId: receipt.eventId,
            apiVersion: receipt.apiVersion,
            triggeredAt: receipt.triggeredAt,
          },
        });
        return "created";
      } catch (error) {
        if (!isWebhookIdCollision(error)) throw error;
        const existing = await client.webhookEvent.findUnique({
          where: {
            provider_externalEventId: {
              provider: "SHOPIFY",
              externalEventId: receipt.externalEventId,
            },
          },
          select: {
            shopId: true,
            eventType: true,
            resourceId: true,
            eventId: true,
            apiVersion: true,
            triggeredAt: true,
          },
        });
        if (!existing || !sameReceipt(existing, shopId, receipt)) throw error;
        return "duplicate";
      }
    },
  };
}

function isWebhookIdCollision(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  return Array.isArray(target)
    ? target.includes("provider") && target.includes("externalEventId")
    : String(target).includes("externalEventId");
}

function sameReceipt(
  existing: {
    shopId: string | null;
    eventType: string | null;
    resourceId: string | null;
    eventId: string | null;
    apiVersion: string | null;
    triggeredAt: Date | null;
  },
  shopId: string,
  receipt: ShopifyWebhookReceipt,
) {
  return existing.shopId === shopId
    && existing.eventType === receipt.topic
    && existing.resourceId === receipt.resourceId
    && existing.eventId === receipt.eventId
    && existing.apiVersion === receipt.apiVersion
    && existing.triggeredAt?.getTime() === receipt.triggeredAt.getTime();
}
