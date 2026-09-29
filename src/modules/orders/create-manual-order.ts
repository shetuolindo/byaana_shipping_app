import "server-only";

import { OrderSource } from "@prisma/client";
import { createInternalOrder } from "./create-internal-order";
import { generateManualOrderNumber, type ManualOrderInput } from "./manual-order";

export async function createManualOrder(input: ManualOrderInput, actorUserId: string) {
  return createInternalOrder(input, {
    source: OrderSource.MANUAL,
    historyReason: "Manual order created",
    auditAction: "ORDER_CREATED",
    actorUserId,
    generateOrderNumber: generateManualOrderNumber,
  });
}
