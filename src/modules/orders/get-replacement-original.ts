import "server-only";

import prisma from "@/lib/prisma";
import { replacementOrderPrefillSelect } from "./replacement-order";

export function getReplacementOriginal(id: string) {
  return prisma.order.findUnique({
    where: { id },
    select: replacementOrderPrefillSelect,
  });
}
