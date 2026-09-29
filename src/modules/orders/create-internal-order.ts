import "server-only";

import { OrderSource, OrderStatus, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  calculateManualOrderTotal,
  minorUnitsToMoney,
  type ManualOrderInput,
} from "./manual-order";

const MAX_ORDER_NUMBER_ATTEMPTS = 5;

type InternalOrderOptions = {
  source: Extract<OrderSource, "MANUAL" | "REPLACEMENT">;
  parentOrderId?: string;
  historyReason: string;
  auditAction: "ORDER_CREATED" | "REPLACEMENT_CREATED";
  actorUserId: string;
  generateOrderNumber(): string;
};

export async function createInternalOrder(input: ManualOrderInput, options: InternalOrderOptions) {
  const subtotal = new Prisma.Decimal(minorUnitsToMoney(calculateManualOrderTotal(input.items)));

  for (let attempt = 0; attempt < MAX_ORDER_NUMBER_ATTEMPTS; attempt += 1) {
    const orderNumber = options.generateOrderNumber();

    try {
      return await prisma.$transaction(async (transaction) => {
        const order = await transaction.order.create({
          data: {
            orderNumber,
            source: options.source,
            parentOrderId: options.parentOrderId,
            internalStatus: OrderStatus.NEW,
            customerName: input.customerName,
            customerEmail: input.customerEmail,
            customerPhone: input.customerPhone,
            currency: input.currency,
            subtotal,
            totalAmount: subtotal,
            notes: input.notes,
            address: {
              create: {
                name: input.recipientName,
                phone: input.customerPhone,
                email: input.customerEmail,
                countryCode: input.countryCode,
                province: input.province,
                city: input.city,
                address1: input.address1,
                address2: input.address2,
                postalCode: input.postalCode,
              },
            },
            items: {
              create: input.items.map((item) => ({
                name: item.name,
                sku: item.sku,
                quantity: item.quantity,
                unitPrice: new Prisma.Decimal(item.unitPrice),
              })),
            },
            statusHistory: {
              create: {
                toStatus: OrderStatus.NEW,
                reason: options.historyReason,
                actorUserId: options.actorUserId,
              },
            },
          },
          select: { id: true, orderNumber: true },
        });

        const metadata: Prisma.InputJsonObject = {
          source: options.source,
          ...(options.parentOrderId ? { parentOrderId: options.parentOrderId } : {}),
        };

        await transaction.auditLog.create({
          data: {
            actorUserId: options.actorUserId,
            action: options.auditAction,
            entityType: "Order",
            entityId: order.id,
            metadata,
          },
        });

        return order;
      });
    } catch (error) {
      if (isOrderNumberCollision(error) && attempt + 1 < MAX_ORDER_NUMBER_ATTEMPTS) continue;
      throw error;
    }
  }

  throw new Error("Unable to allocate an internal order number.");
}

function isOrderNumberCollision(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes("orderNumber") : String(target).includes("orderNumber");
}
