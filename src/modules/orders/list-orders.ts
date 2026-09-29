import "server-only";

import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ORDER_PAGE_SIZE, type OrderListParams } from "./order-list-params";

const orderListSelect = {
  id: true,
  orderNumber: true,
  shopifyOrderNumber: true,
  customerName: true,
  customerEmail: true,
  source: true,
  internalStatus: true,
  currency: true,
  totalAmount: true,
  createdAt: true,
  items: { select: { quantity: true } },
  shipments: { select: { id: true, carrier: true, trackingNumber: true }, orderBy: { createdAt: "desc" } },
} satisfies Prisma.OrderSelect;

export type OrderListRow = Prisma.OrderGetPayload<{ select: typeof orderListSelect }>;

export function buildOrderWhere(params: OrderListParams): Prisma.OrderWhereInput {
  const queryFilter: Prisma.OrderWhereInput | undefined = params.query ? {
    OR: [
      { id: { contains: params.query, mode: "insensitive" } },
      { orderNumber: { contains: params.query, mode: "insensitive" } },
      { shopifyOrderNumber: { contains: params.query, mode: "insensitive" } },
      { customerName: { contains: params.query, mode: "insensitive" } },
      { customerEmail: { contains: params.query, mode: "insensitive" } },
      { customerPhone: { contains: params.query, mode: "insensitive" } },
      { shipments: { some: { trackingNumber: { contains: params.query, mode: "insensitive" } } } },
    ],
  } : undefined;

  return {
    ...(queryFilter ?? {}),
    ...(params.status ? { internalStatus: params.status } : {}),
    ...(params.source ? { source: params.source } : {}),
    ...(params.shipment === "with" ? { shipments: { some: {} } } : {}),
    ...(params.shipment === "without" ? { shipments: { none: {} } } : {}),
  };
}

function orderByFor(sort: OrderListParams["sort"]): Prisma.OrderOrderByWithRelationInput[] {
  switch (sort) {
    case "oldest": return [{ createdAt: "asc" }, { id: "asc" }];
    case "total_desc": return [{ totalAmount: "desc" }, { createdAt: "desc" }, { id: "desc" }];
    case "total_asc": return [{ totalAmount: "asc" }, { createdAt: "desc" }, { id: "desc" }];
    default: return [{ createdAt: "desc" }, { id: "desc" }];
  }
}

export async function listOrders(params: OrderListParams) {
  const where = buildOrderWhere(params);
  const totalCount = await prisma.order.count({ where });
  const totalPages = Math.max(1, Math.ceil(totalCount / ORDER_PAGE_SIZE));
  const currentPage = Math.min(params.page, totalPages);
  const orders = await prisma.order.findMany({
    where,
    select: orderListSelect,
    orderBy: orderByFor(params.sort),
    skip: (currentPage - 1) * ORDER_PAGE_SIZE,
    take: ORDER_PAGE_SIZE,
  });
  return {
    orders, totalCount, totalPages, currentPage,
    rangeStart: totalCount === 0 ? 0 : (currentPage - 1) * ORDER_PAGE_SIZE + 1,
    rangeEnd: Math.min(currentPage * ORDER_PAGE_SIZE, totalCount),
  };
}
