import "server-only";

import prisma from "@/lib/prisma";
import { encryptShopifyAccessToken } from "./token-encryption";

export class ShopifyConnectionConflictError extends Error {
  constructor() {
    super("A different Shopify store is already connected.");
    this.name = "ShopifyConnectionConflictError";
  }
}

export async function getConnectedShopifyShop() {
  return prisma.shop.findFirst({
    where: { shopifyAccessTokenEncrypted: { not: null } },
    orderBy: { shopifyConnectedAt: "desc" },
    select: {
      id: true,
      name: true,
      shopifyShopDomain: true,
      shopifyConnectedAt: true,
    },
  });
}

export async function persistShopifyConnection(input: {
  actorUserId: string;
  accessToken: string;
  encryptionKey: string;
  name: string;
  shopifyShopDomain: string;
}) {
  const encryptedToken = encryptShopifyAccessToken(
    input.accessToken,
    input.shopifyShopDomain,
    input.encryptionKey,
  );

  return prisma.$transaction(async (tx) => {
    const otherConnection = await tx.shop.findFirst({
      where: {
        shopifyAccessTokenEncrypted: { not: null },
        shopifyShopDomain: { not: input.shopifyShopDomain },
      },
      select: { id: true },
    });
    if (otherConnection) throw new ShopifyConnectionConflictError();

    const shop = await tx.shop.upsert({
      where: { shopifyShopDomain: input.shopifyShopDomain },
      update: {
        name: input.name,
        shopifyAccessTokenEncrypted: encryptedToken,
        shopifyConnectedAt: new Date(),
        isActive: true,
      },
      create: {
        name: input.name,
        shopifyShopDomain: input.shopifyShopDomain,
        shopifyAccessTokenEncrypted: encryptedToken,
        shopifyConnectedAt: new Date(),
        isActive: true,
      },
      select: { id: true, name: true, shopifyShopDomain: true, shopifyConnectedAt: true },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: "SHOPIFY_CONNECTED",
        entityType: "Shop",
        entityId: shop.id,
        metadata: { shopifyShopDomain: shop.shopifyShopDomain },
      },
    });

    return shop;
  });
}
