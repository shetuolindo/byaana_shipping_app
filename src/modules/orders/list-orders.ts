import "server-only";

import { OrderSource, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { selectChronologicalOrderPage, type ChronologicalDirection } from "./order-list-ordering";
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
  externalCreatedAt: true,
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
    case "total_desc": return [{ totalAmount: "desc" }, { createdAt: "desc" }, { id: "desc" }];
    case "total_asc": return [{ totalAmount: "asc" }, { createdAt: "desc" }, { id: "desc" }];
    default: return [{ createdAt: "desc" }, { id: "desc" }];
  }
}

async function listChronologically(
  where: Prisma.OrderWhereInput,
  direction: ChronologicalDirection,
  skip: number,
  take: number,
) {
  const candidateLimit = skip + take;
  const [shopifyWithSourceDate, shopifyWithoutSourceDate, localOrders] = await Promise.all([
    prisma.order.findMany({
      where: { AND: [where, { source: OrderSource.SHOPIFY, externalCreatedAt: { not: null } }] },
      select: orderListSelect,
      orderBy: [{ externalCreatedAt: direction }, { createdAt: direction }, { id: direction }],
      take: candidateLimit,
    }),
    prisma.order.findMany({
      where: { AND: [where, { source: OrderSource.SHOPIFY, externalCreatedAt: null }] },
      select: orderListSelect,
      orderBy: [{ createdAt: direction }, { id: direction }],
      take: candidateLimit,
    }),
    prisma.order.findMany({
      where: { AND: [where, { source: { in: [OrderSource.MANUAL, OrderSource.REPLACEMENT] } }] },
      select: orderListSelect,
      orderBy: [{ createdAt: direction }, { id: direction }],
      take: candidateLimit,
    }),
  ]);

  return selectChronologicalOrderPage(
    [shopifyWithSourceDate, shopifyWithoutSourceDate, localOrders],
    direction,
    skip,
    take,
  );
}

export async function listOrders(params: OrderListParams) {
  const where = buildOrderWhere(params);
  const totalCount = await prisma.order.count({ where });
  const totalPages = Math.max(1, Math.ceil(totalCount / ORDER_PAGE_SIZE));
  const currentPage = Math.min(params.page, totalPages);
  const skip = (currentPage - 1) * ORDER_PAGE_SIZE;
  const orders = params.sort === "newest" || params.sort === "oldest"
    ? await listChronologically(where, params.sort === "newest" ? "desc" : "asc", skip, ORDER_PAGE_SIZE)
    : await prisma.order.findMany({
        where,
        select: orderListSelect,
        orderBy: orderByFor(params.sort),
        skip,
        take: ORDER_PAGE_SIZE,
      });
  return {
    orders, totalCount, totalPages, currentPage,
    rangeStart: totalCount === 0 ? 0 : (currentPage - 1) * ORDER_PAGE_SIZE + 1,
    rangeEnd: Math.min(currentPage * ORDER_PAGE_SIZE, totalCount),
  };
}
