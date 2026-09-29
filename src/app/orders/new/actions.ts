"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { UnauthenticatedError, UnauthorizedError } from "@/modules/auth/authorization";
import { requirePortalUser } from "@/modules/auth/session";
import { createManualOrder } from "@/modules/orders/create-manual-order";
import {
  manualOrderInputFromFormData,
  manualOrderSchema,
  validationErrors,
  type ManualOrderActionState,
} from "@/modules/orders/manual-order";

export async function submitManualOrder(
  _previousState: ManualOrderActionState,
  formData: FormData,
): Promise<ManualOrderActionState> {
  let actorUserId: string;
  try {
    actorUserId = (await requirePortalUser("OPERATIONS")).id;
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof UnauthorizedError) {
      return { status: "error", message: "You must sign in before creating an order." };
    }
    console.error("Manual order authorization failed");
    return { status: "error", message: "The order could not be created. Please try again." };
  }

  const result = manualOrderSchema.safeParse(manualOrderInputFromFormData(formData));

  if (!result.success) {
    return { status: "error", ...validationErrors(result.error) };
  }

  let orderId: string;
  try {
    const order = await createManualOrder(result.data, actorUserId);
    orderId = order.id;
  } catch (error) {
    console.error("Manual order creation failed", error);
    return {
      status: "error",
      message: "The order could not be created. No changes were saved. Please try again.",
    };
  }

  revalidatePath("/orders");
  redirect(`/orders/${encodeURIComponent(orderId)}`);
}
