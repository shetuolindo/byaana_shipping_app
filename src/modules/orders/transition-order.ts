import "server-only";

import type { OrderStatus, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  assertExpectedOrderStatus,
  resolveOrderTransition,
  StaleOrderStatusError,
  type OrderTransitionAction,
} from "./order-transitions";

export class OrderNotFoundError extends Error {
  constructor() {
    super("The order could not be found.");
    this.name = "OrderNotFoundError";
  }
}

type TransitionOrderInput = {
  orderId: string;
  action: OrderTransitionAction;
  expectedStatus: OrderStatus;
  reason?: string;
  actorUserId: string;
};

const auditActions: Record<OrderTransitionAction, string> = {
  HOLD: "ORDER_HOLD",
  RESUME: "ORDER_RELEASE",
  CANCEL: "ORDER_CANCEL_LOCAL",
};

export async function transitionOrder(input: TransitionOrderInput) {
  const reason = input.reason?.trim() || undefined;

  return prisma.$transaction(async (transaction) => {
    const order = await transaction.order.findUnique({
      where: { id: input.orderId },
      select: { internalStatus: true },
    });

    if (!order) throw new OrderNotFoundError();
    assertExpectedOrderStatus(order.internalStatus, input.expectedStatus);

    const previousHoldStatus = input.action === "RESUME"
      ? await getPreviousHoldStatus(transaction, input.orderId)
      : undefined;
    const nextStatus = resolveOrderTransition(order.internalStatus, input.action, previousHoldStatus);

    const update = await transaction.order.updateMany({
      where: { id: input.orderId, internalStatus: order.internalStatus },
      data: {
        internalStatus: nextStatus,
        holdReason: input.action === "HOLD" ? reason ?? null : null,
      },
    });

    if (update.count !== 1) throw new StaleOrderStatusError();

    await transaction.orderStatusHistory.create({
      data: {
        orderId: input.orderId,
        fromStatus: order.internalStatus,
        toStatus: nextStatus,
        reason,
        actorUserId: input.actorUserId,
      },
    });

    const metadata: Prisma.InputJsonObject = {
      fromStatus: order.internalStatus,
      toStatus: nextStatus,
      ...(reason ? { reason } : {}),
    };
    await transaction.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: auditActions[input.action],
        entityType: "Order",
        entityId: input.orderId,
        metadata,
      },
    });

    return { fromStatus: order.internalStatus, toStatus: nextStatus };
  });
}

async function getPreviousHoldStatus(transaction: Prisma.TransactionClient, orderId: string) {
  const holdEntry = await transaction.orderStatusHistory.findFirst({
    where: { orderId, toStatus: "ON_HOLD" },
    select: { fromStatus: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  return holdEntry?.fromStatus;
}
