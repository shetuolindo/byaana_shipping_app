import Link from "next/link";
import { OrderSource, OrderStatus } from "@prisma/client";
import { Search } from "lucide-react";
import type { OrderListParams } from "@/modules/orders/order-list-params";

const label = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());

export function OrdersFilters({ params }: { params: OrderListParams }) {
  const hasActiveControls = Boolean(params.query || params.status || params.source || params.shipment || params.sort !== "newest");

  return (
    <form action="/orders" method="get" className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(18rem,1fr)_repeat(4,minmax(9rem,auto))_auto] xl:items-end">
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Search orders</span>
          <span className="relative mt-1.5 block">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
            <input name="q" type="search" defaultValue={params.query} placeholder="Order, customer, email, phone, tracking" className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm placeholder:text-slate-400" />
          </span>
        </label>
        <FilterSelect name="status" labelText="Status" defaultValue={params.status ?? ""} options={Object.values(OrderStatus).map(value => [value, label(value)])} />
        <FilterSelect name="source" labelText="Source" defaultValue={params.source ?? ""} options={Object.values(OrderSource).map(value => [value, label(value)])} />
        <FilterSelect name="shipment" labelText="Shipment" defaultValue={params.shipment ?? ""} options={[["with", "Has shipment"], ["without", "No shipment"]]} />
        <FilterSelect name="sort" labelText="Sort" defaultValue={params.sort} includeAny={false} options={[["newest", "Newest first"], ["oldest", "Oldest first"], ["total_desc", "Total: high to low"], ["total_asc", "Total: low to high"]]} />
        <div className="flex items-center gap-3">
          <button type="submit" className="h-10 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700">Apply</button>
          {hasActiveControls && <Link href="/orders" className="text-sm font-medium text-slate-600 hover:text-slate-900">Clear</Link>}
        </div>
      </div>
    </form>
  );
}

function FilterSelect({ name, labelText, defaultValue, options, includeAny = true }: {
  name: string;
  labelText: string;
  defaultValue: string;
  options: readonly (readonly [string, string])[];
  includeAny?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{labelText}</span>
      <select name={name} defaultValue={defaultValue} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700">
        {includeAny && <option value="">Any</option>}
        {options.map(([value, optionLabel]) => <option key={value} value={value}>{optionLabel}</option>)}
      </select>
    </label>
  );
}
