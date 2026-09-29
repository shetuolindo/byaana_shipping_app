import type { OrderStatus } from "@prisma/client";

export const orderTransitionActions = ["HOLD", "RESUME", "CANCEL"] as const;

export type OrderTransitionAction = (typeof orderTransitionActions)[number];

export class OrderTransitionRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderTransitionRuleError";
  }
}

export class StaleOrderStatusError extends Error {
  constructor() {
    super("The order status changed before this action was completed. Refresh the page and try again.");
    this.name = "StaleOrderStatusError";
  }
}

export function availableOrderActions(status: OrderStatus): OrderTransitionAction[] {
  switch (status) {
    case "NEW":
    case "READY":
      return ["HOLD", "CANCEL"];
    case "ON_HOLD":
      return ["RESUME", "CANCEL"];
    case "PROCESSING":
    case "SHIPPED":
    case "CANCELLED":
    case "ERROR":
      return [];
  }
}

export function assertExpectedOrderStatus(current: OrderStatus, expected: OrderStatus) {
  if (current !== expected) throw new StaleOrderStatusError();
}

export function resolveOrderTransition(
  current: OrderStatus,
  action: OrderTransitionAction,
  previousHoldStatus?: OrderStatus | null,
): OrderStatus {
  if (!availableOrderActions(current).includes(action)) {
    throw new OrderTransitionRuleError(`${actionLabel(action)} is not allowed while the order is ${statusLabel(current)}.`);
  }

  if (action === "HOLD") return "ON_HOLD";
  if (action === "CANCEL") return "CANCELLED";

  if (previousHoldStatus !== "NEW" && previousHoldStatus !== "READY") {
    throw new OrderTransitionRuleError("This order cannot be resumed because its pre-hold status is unavailable.");
  }

  return previousHoldStatus;
}

function actionLabel(action: OrderTransitionAction) {
  if (action === "HOLD") return "Putting the order on hold";
  if (action === "RESUME") return "Resuming the order";
  return "Cancelling the order";
}

function statusLabel(status: OrderStatus) {
  return status.toLowerCase().replace("_", " ");
}
