import Link from "next/link";
import type { OrderListRow } from "@/modules/orders/list-orders";
import { getOrderDisplayNumber } from "@/modules/orders/order-detail-format";
import { OrderBadge } from "./order-badge";

const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });

function formatMoney(value: OrderListRow["totalAmount"], currency: string | null) {
  if (value === null) return "—";
  if (!currency) return value.toFixed(2);
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(value.toNumber());
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function OrdersTable({ orders, hasFilters }: { orders: OrderListRow[]; hasFilters: boolean }) {
  if (orders.length === 0) {
    return (
      <div className="px-6 py-16 text-center">
        <h3 className="text-sm font-semibold text-slate-900">{hasFilters ? "No matching orders" : "No orders yet"}</h3>
        <p className="mt-2 text-sm text-slate-500">{hasFilters ? "Try changing or clearing the search and filters." : "Orders will appear here when they are added."}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-[1120px] w-full border-collapse text-left text-sm">
        <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>{["Order number", "Customer", "Source", "Status", "Items", "Total", "Shipment / carrier", "Tracking number", "Created"].map(heading => <th key={heading} scope="col" className="whitespace-nowrap px-4 py-3">{heading}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {orders.map(order => {
            const itemQuantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
            const carriers = [...new Set(order.shipments.map(shipment => shipment.carrier))];
            const trackingNumbers = order.shipments.flatMap(shipment => shipment.trackingNumber ? [shipment.trackingNumber] : []);
            return (
              <tr key={order.id} className="hover:bg-slate-50/80">
                <td className="max-w-48 px-4 py-4 align-top"><Link href={`/orders/${encodeURIComponent(order.id)}`} className="block truncate font-semibold text-slate-900 hover:underline" title={getOrderDisplayNumber(order)}>{getOrderDisplayNumber(order)}</Link></td>
                <td className="px-4 py-4 align-top"><p className="font-medium text-slate-900">{order.customerName}</p><p className="mt-1 max-w-52 truncate text-xs text-slate-500">{order.customerEmail ?? "No email"}</p></td>
                <td className="px-4 py-4 align-top"><OrderBadge kind="source" value={order.source} /></td>
                <td className="px-4 py-4 align-top"><OrderBadge kind="status" value={order.internalStatus} /></td>
                <td className="px-4 py-4 align-top tabular-nums text-slate-700">{itemQuantity}</td>
                <td className="whitespace-nowrap px-4 py-4 align-top font-medium tabular-nums text-slate-900">{formatMoney(order.totalAmount, order.currency)}</td>
                <td className="px-4 py-4 align-top">{carriers.length > 0 ? <div className="flex flex-wrap gap-1">{carriers.map(carrier => <OrderBadge key={carrier} kind="carrier" value={carrier} />)}{order.shipments.length > 1 && <span className="text-xs text-slate-500">{order.shipments.length} shipments</span>}</div> : <span className="text-slate-400">Not created</span>}</td>
                <td className="max-w-48 px-4 py-4 align-top text-slate-700">{trackingNumbers.length > 0 ? trackingNumbers.map(number => <div key={number} className="truncate" title={number}>{number}</div>) : <span className="text-slate-400">—</span>}</td>
                <td className="whitespace-nowrap px-4 py-4 align-top text-slate-600"><time dateTime={order.createdAt.toISOString()}>{dateFormatter.format(order.createdAt)}</time></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
