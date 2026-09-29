import { Carrier, OrderSource, OrderStatus, ShipmentStatus } from "@prisma/client";

const statusStyles: Record<OrderStatus, string> = {
  NEW: "bg-blue-50 text-blue-700 ring-blue-600/20",
  ON_HOLD: "bg-amber-50 text-amber-700 ring-amber-600/20",
  READY: "bg-cyan-50 text-cyan-700 ring-cyan-600/20",
  PROCESSING: "bg-violet-50 text-violet-700 ring-violet-600/20",
  SHIPPED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  CANCELLED: "bg-slate-100 text-slate-600 ring-slate-500/20",
  ERROR: "bg-red-50 text-red-700 ring-red-600/20",
};

const sourceStyles: Record<OrderSource, string> = {
  SHOPIFY: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  MANUAL: "bg-slate-100 text-slate-700 ring-slate-500/20",
  REPLACEMENT: "bg-orange-50 text-orange-700 ring-orange-600/20",
};

const carrierStyles: Record<Carrier, string> = {
  SGS: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
};

const shipmentStatusStyles: Record<ShipmentStatus, string> = {
  PENDING: "bg-blue-50 text-blue-700 ring-blue-600/20",
  PROCESSING: "bg-violet-50 text-violet-700 ring-violet-600/20",
  SHIPPED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  CANCELLED: "bg-slate-100 text-slate-600 ring-slate-500/20",
  ERROR: "bg-red-50 text-red-700 ring-red-600/20",
};

const formatLabel = (value: string) => value.replaceAll("_", " ");

export function OrderBadge({ kind, value }: {
  kind: "status" | "source" | "carrier" | "shipmentStatus";
  value: OrderStatus | OrderSource | Carrier | ShipmentStatus;
}) {
  const styles = kind === "status"
    ? statusStyles[value as OrderStatus]
    : kind === "source"
      ? sourceStyles[value as OrderSource]
      : kind === "carrier"
        ? carrierStyles[value as Carrier]
        : shipmentStatusStyles[value as ShipmentStatus];
  return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${styles}`}>{formatLabel(value)}</span>;
}
