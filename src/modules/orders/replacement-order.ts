import type { Prisma } from "@prisma/client";

export const replacementOrderPrefillSelect = {
  id: true,
  orderNumber: true,
  customerName: true,
  customerEmail: true,
  customerPhone: true,
  currency: true,
  notes: true,
  address: {
    select: {
      name: true,
      address1: true,
      address2: true,
      city: true,
      province: true,
      postalCode: true,
      countryCode: true,
    },
  },
  items: {
    select: {
      name: true,
      sku: true,
      quantity: true,
      unitPrice: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.OrderSelect;

export type ReplacementOrderOriginal = Prisma.OrderGetPayload<{ select: typeof replacementOrderPrefillSelect }>;

export type InternalOrderFormValues = {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  recipientName: string;
  address1: string;
  address2: string;
  city: string;
  province: string;
  postalCode: string;
  countryCode: string;
  currency: string;
  notes: string;
  items: Array<{ name: string; sku: string; quantity: string; unitPrice: string }>;
};

export function replacementOrderCreationContext(originalOrderId: string) {
  return {
    source: "REPLACEMENT" as const,
    parentOrderId: originalOrderId,
    historyReason: "Replacement order created",
  };
}

export function replacementOrderFormValues(original: ReplacementOrderOriginal): InternalOrderFormValues {
  return {
    customerName: original.customerName,
    customerEmail: original.customerEmail ?? "",
    customerPhone: original.customerPhone ?? "",
    recipientName: original.address?.name ?? original.customerName,
    address1: original.address?.address1 ?? "",
    address2: original.address?.address2 ?? "",
    city: original.address?.city ?? "",
    province: original.address?.province ?? "",
    postalCode: original.address?.postalCode ?? "",
    countryCode: original.address?.countryCode ?? "GB",
    currency: original.currency ?? "GBP",
    notes: [`Replacement for ${original.orderNumber}`, original.notes ? `Original notes:\n${original.notes}` : ""].filter(Boolean).join("\n\n"),
    items: original.items.map((item) => ({
      name: item.name,
      sku: item.sku,
      quantity: String(item.quantity),
      unitPrice: item.unitPrice?.toFixed(2) ?? "0.00",
    })),
  };
}
