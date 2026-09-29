"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { UnauthenticatedError, UnauthorizedError } from "@/modules/auth/authorization";
import { requirePortalUser } from "@/modules/auth/session";
import { createReplacementOrder } from "@/modules/orders/create-replacement-order";
import {
  manualOrderInputFromFormData,
  manualOrderSchema,
  validationErrors,
  type ManualOrderActionState,
} from "@/modules/orders/manual-order";

const originalOrderIdSchema = z.string().trim().min(1);

export async function submitReplacementOrder(
  _previousState: ManualOrderActionState,
  formData: FormData,
): Promise<ManualOrderActionState> {
  let actorUserId: string;
  try {
    actorUserId = (await requirePortalUser("OPERATIONS")).id;
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof UnauthorizedError) {
      return { status: "error", message: "You must sign in before creating a replacement." };
    }
    console.error("Replacement order authorization failed");
    return { status: "error", message: "The replacement could not be created. Please try again." };
  }

  const originalOrderId = originalOrderIdSchema.safeParse(formData.get("originalOrderId"));
  const input = manualOrderSchema.safeParse(manualOrderInputFromFormData(formData));

  if (!originalOrderId.success) {
    return { status: "error", message: "The original order could not be identified. No changes were saved." };
  }

  if (!input.success) {
    return { status: "error", ...validationErrors(input.error) };
  }

  let replacementOrderId: string;
  try {
    const replacement = await createReplacementOrder(originalOrderId.data, input.data, actorUserId);
    replacementOrderId = replacement.id;
  } catch (error) {
    console.error("Replacement order creation failed", error);
    return {
      status: "error",
      message: "The replacement could not be created. No changes were saved. Please try again.",
    };
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${encodeURIComponent(originalOrderId.data)}`);
  redirect(`/orders/${encodeURIComponent(replacementOrderId)}`);
}
