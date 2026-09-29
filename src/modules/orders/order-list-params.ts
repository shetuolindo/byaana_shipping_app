import { OrderSource, OrderStatus } from "@prisma/client";

export const ORDER_PAGE_SIZE = 20;
export const orderSortValues = ["newest", "oldest", "total_desc", "total_asc"] as const;
export const shipmentFilterValues = ["with", "without"] as const;

export type OrderSort = (typeof orderSortValues)[number];
export type ShipmentFilter = (typeof shipmentFilterValues)[number];
export type OrderListParams = {
  query: string;
  status?: OrderStatus;
  source?: OrderSource;
  shipment?: ShipmentFilter;
  sort: OrderSort;
  page: number;
};

type RawParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function enumValue<T extends string>(value: string | undefined, values: readonly T[]) {
  return value && values.includes(value as T) ? (value as T) : undefined;
}

export function parseOrderListParams(raw: RawParams): OrderListParams {
  const pageValue = Number.parseInt(firstValue(raw.page) ?? "1", 10);
  return {
    query: (firstValue(raw.q) ?? "").trim().slice(0, 200),
    status: enumValue(firstValue(raw.status), Object.values(OrderStatus)),
    source: enumValue(firstValue(raw.source), Object.values(OrderSource)),
    shipment: enumValue(firstValue(raw.shipment), shipmentFilterValues),
    sort: enumValue(firstValue(raw.sort), orderSortValues) ?? "newest",
    page: Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1,
  };
}

export function orderListSearchParams(params: OrderListParams, page = params.page) {
  const searchParams = new URLSearchParams();
  if (params.query) searchParams.set("q", params.query);
  if (params.status) searchParams.set("status", params.status);
  if (params.source) searchParams.set("source", params.source);
  if (params.shipment) searchParams.set("shipment", params.shipment);
  if (params.sort !== "newest") searchParams.set("sort", params.sort);
  if (page > 1) searchParams.set("page", String(page));
  return searchParams;
}
