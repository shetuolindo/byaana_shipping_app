import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { orderListSearchParams, type OrderListParams } from "@/modules/orders/order-list-params";

export function Pagination({ currentPage, totalPages, params }: { currentPage: number; totalPages: number; params: OrderListParams }) {
  if (totalPages <= 1) return null;
  const hrefFor = (page: number) => `/orders?${orderListSearchParams(params, page).toString()}`;

  return (
    <nav aria-label="Orders pagination" className="flex items-center justify-between border-t border-slate-200 px-4 py-4">
      {currentPage > 1 ? <PaginationLink href={hrefFor(currentPage - 1)}><ChevronLeft size={16} aria-hidden="true" />Previous</PaginationLink> : <span />}
      <span className="text-sm text-slate-600">Page <strong className="font-semibold text-slate-900">{currentPage}</strong> of {totalPages}</span>
      {currentPage < totalPages ? <PaginationLink href={hrefFor(currentPage + 1)}>Next<ChevronRight size={16} aria-hidden="true" /></PaginationLink> : <span />}
    </nav>
  );
}

function PaginationLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">{children}</Link>;
}
