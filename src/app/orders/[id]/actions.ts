"use server";

import { OrderStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { UnauthenticatedError, UnauthorizedError } from "@/modules/auth/authorization";
import { requirePortalUser } from "@/modules/auth/session";
import {
  orderTransitionActions,
  OrderTransitionRuleError,
  StaleOrderStatusError,
} from "@/modules/orders/order-transitions";
import type { OrderActionState } from "@/modules/orders/order-action-state";
import { OrderNotFoundError, transitionOrder } from "@/modules/orders/transition-order";

const transitionSchema = z.object({
  orderId: z.string().trim().min(1),
  action: z.enum(orderTransitionActions),
  expectedStatus: z.enum(OrderStatus),
  reason: z.string().trim().max(300, "Keep the reason to 300 characters or fewer.").optional(),
});

export async function submitOrderTransition(
  _previousState: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  let actorUserId: string;
  try {
    actorUserId = (await requirePortalUser("OPERATIONS")).id;
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof UnauthorizedError) {
      return { status: "error", message: "You must sign in before changing an order." };
    }
    console.error("Order transition authorization failed");
    return { status: "error", message: "The order status could not be changed. Please try again." };
  }

  const parsed = transitionSchema.safeParse({
    orderId: formData.get("orderId"),
    action: formData.get("action"),
    expectedStatus: formData.get("expectedStatus"),
    reason: formData.get("reason") || undefined,
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "The order action is invalid." };
  }

  try {
    const result = await transitionOrder({ ...parsed.data, actorUserId });
    revalidatePath("/orders");
    revalidatePath(`/orders/${encodeURIComponent(parsed.data.orderId)}`);
    return { status: "success", message: `Order status changed to ${result.toStatus.toLowerCase().replace("_", " ")}.` };
  } catch (error) {
    if (error instanceof OrderTransitionRuleError || error instanceof StaleOrderStatusError || error instanceof OrderNotFoundError) {
      return { status: "error", message: error.message };
    }

    console.error("Internal order transition failed", error);
    return { status: "error", message: "The order status could not be changed. No changes were saved. Please try again." };
  }
}
