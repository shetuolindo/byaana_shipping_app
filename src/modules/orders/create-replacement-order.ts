import "server-only";

import { OrderSource } from "@prisma/client";
import { createInternalOrder } from "./create-internal-order";
import { generateReplacementOrderNumber, type ManualOrderInput } from "./manual-order";
import { replacementOrderCreationContext } from "./replacement-order";

export function createReplacementOrder(originalOrderId: string, input: ManualOrderInput, actorUserId: string) {
  const context = replacementOrderCreationContext(originalOrderId);
  return createInternalOrder(input, {
    source: OrderSource[context.source],
    parentOrderId: context.parentOrderId,
    historyReason: context.historyReason,
    auditAction: "REPLACEMENT_CREATED",
    actorUserId,
    generateOrderNumber: generateReplacementOrderNumber,
  });
}
