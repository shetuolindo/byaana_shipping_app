import "server-only";

import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

const orderDetailSelect = {
  id: true,
  orderNumber: true,
  source: true,
  internalStatus: true,
  shopifyOrderId: true,
  shopifyOrderNumber: true,
  externalCreatedAt: true,
  customerName: true,
  customerEmail: true,
  customerPhone: true,
  currency: true,
  subtotal: true,
  shippingAmount: true,
  taxAmount: true,
  totalAmount: true,
  notes: true,
  holdReason: true,
  errorMessage: true,
  createdAt: true,
  updatedAt: true,
  shop: {
    select: { name: true, shopifyShopDomain: true },
  },
  parentOrder: {
    select: { id: true, orderNumber: true },
  },
  replacements: {
    select: {
      id: true,
      orderNumber: true,
      internalStatus: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  address: {
    select: {
      name: true,
      company: true,
      phone: true,
      email: true,
      countryCode: true,
      province: true,
      city: true,
      district: true,
      address1: true,
      address2: true,
      postalCode: true,
    },
  },
  items: {
    select: {
      id: true,
      name: true,
      sku: true,
      sgsSku: true,
      quantity: true,
      unitPrice: true,
      declaredValue: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  shipments: {
    select: {
      id: true,
      carrier: true,
      internalStatus: true,
      carrierOrderCode: true,
      carrierReferenceNo: true,
      carrierStatus: true,
      carrierSubStatus: true,
      allocationStatus: true,
      warehouseCode: true,
      shippingMethodCode: true,
      trackingNumber: true,
      shippingCost: true,
      totalCarrierCost: true,
      carrierCurrency: true,
      cancelStatus: true,
      cancellationReason: true,
      cancellationRequestedAt: true,
      cancellationResolvedAt: true,
      labelLastFetchedAt: true,
      lastCarrierSyncAt: true,
      carrierCreatedAt: true,
      carrierShippedAt: true,
      lastErrorCode: true,
      lastErrorMessage: true,
      createdAt: true,
      updatedAt: true,
      trackingEvents: {
        select: {
          id: true,
          carrierEventCode: true,
          status: true,
          description: true,
          location: true,
          eventAt: true,
          createdAt: true,
        },
        orderBy: [{ eventAt: "asc" }, { createdAt: "asc" }],
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  statusHistory: {
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      reason: true,
      createdAt: true,
      actor: { select: { name: true, email: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.OrderSelect;

export type OrderDetail = Prisma.OrderGetPayload<{ select: typeof orderDetailSelect }>;

export function getOrderDetail(id: string) {
  return prisma.order.findUnique({
    where: { id },
    select: orderDetailSelect,
  });
}
