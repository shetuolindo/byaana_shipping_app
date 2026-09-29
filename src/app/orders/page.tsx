import { OrdersFilters } from "@/components/orders/orders-filters";
import { OrdersTable } from "@/components/orders/orders-table";
import { Pagination } from "@/components/orders/pagination";
import { PageHeading } from "@/components/portal/page-heading";
import { listOrders } from "@/modules/orders/list-orders";
import { parseOrderListParams } from "@/modules/orders/order-list-params";

type OrdersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const params = parseOrderListParams(await searchParams);
  const result = await listOrders(params);
  const hasFilters = Boolean(params.query || params.status || params.source || params.shipment);

  return (
    <div className="space-y-7">
      <PageHeading title="Orders" description="Search, filter, and review orders across the shipping workflow." />
      <OrdersFilters params={params} />
      <section aria-labelledby="orders-results" className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 id="orders-results" className="text-sm font-semibold text-slate-900">
            {hasFilters ? `${result.totalCount} matching orders` : `${result.totalCount} orders`}
          </h2>
          {result.totalCount > 0 && <p className="mt-1 text-xs text-slate-500">Showing {result.rangeStart}–{result.rangeEnd} of {result.totalCount}</p>}
        </div>
        <OrdersTable orders={result.orders} hasFilters={hasFilters} />
        <Pagination currentPage={result.currentPage} totalPages={result.totalPages} params={params} />
      </section>
    </div>
  );
}
