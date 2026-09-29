import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ManualOrderForm } from "@/components/orders/manual-order-form";
import { PageHeading } from "@/components/portal/page-heading";

export default function NewOrderPage() {
  return (
    <div className="space-y-7">
      <div>
        <Link href="/orders" className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900">
          <ArrowLeft aria-hidden="true" size={16} /> Back to Orders
        </Link>
        <PageHeading title="Manual Order" description="Create an internal order for review. This does not create a shipment or contact a carrier." />
      </div>
      <ManualOrderForm />
    </div>
  );
}
