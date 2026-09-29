import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ManualOrderForm } from "@/components/orders/manual-order-form";
import { PageHeading } from "@/components/portal/page-heading";
import { getReplacementOriginal } from "@/modules/orders/get-replacement-original";
import { replacementOrderFormValues } from "@/modules/orders/replacement-order";

type ReplacementOrderPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ReplacementOrderPage({ params }: ReplacementOrderPageProps) {
  const { id } = await params;
  const original = await getReplacementOriginal(id);

  if (!original) notFound();

  return (
    <div className="space-y-7">
      <div>
        <Link href={`/orders/${encodeURIComponent(original.id)}`} className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900">
          <ArrowLeft aria-hidden="true" size={16} /> Back to {original.orderNumber}
        </Link>
        <PageHeading
          title="Create Replacement"
          description={`Create an editable internal replacement for ${original.orderNumber}. This does not create a shipment or contact Shopify or SGS.`}
        />
      </div>
      <ManualOrderForm
        mode="replacement"
        originalOrderId={original.id}
        initialValues={replacementOrderFormValues(original)}
      />
    </div>
  );
}
