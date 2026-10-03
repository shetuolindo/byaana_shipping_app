import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { OrderActions } from "@/components/orders/order-actions";
import { OrderBadge } from "@/components/orders/order-badge";
import { getOrderDetail, type OrderDetail } from "@/modules/orders/get-order-detail";
import {
  formatDateTime,
  formatLabel,
  formatMoney,
  getNullableOrderDetailDisplay,
  getOrderDisplayNumber,
} from "@/modules/orders/order-detail-format";

type OrderDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function OrderDetailPage({ params }: OrderDetailPageProps) {
  const { id } = await params;
  const order = await getOrderDetail(id);

  if (!order) notFound();

  const orderNumber = getOrderDisplayNumber(order);
  const nullableDisplay = getNullableOrderDetailDisplay(order);

  return (
    <div className="space-y-7">
      <header className="border-b border-slate-200 pb-7">
        <Link href="/orders" className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900">
          <ArrowLeft aria-hidden="true" size={16} />
          Back to Orders
        </Link>
        <div className="mt-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Order</p>
            <h1 className="mt-1 break-words text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{orderNumber}</h1>
            {order.shopifyOrderNumber && <p className="mt-2 break-words text-sm text-slate-500">Shopify order: {order.shopifyOrderNumber}</p>}
            {order.shopifyOrderId && <p className="mt-2 break-all text-sm text-slate-500">Shopify ID: {order.shopifyOrderId}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/orders/${encodeURIComponent(order.id)}/replacement`} className="rounded-md bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-700">
              Create Replacement
            </Link>
            <OrderBadge kind="status" value={order.internalStatus} />
            <OrderBadge kind="source" value={order.source} />
            <span className="text-sm text-slate-500">Created {formatDateTime(order.createdAt)}</span>
          </div>
        </div>
      </header>

      {(order.parentOrder || order.replacements.length > 0) && <ReplacementLinks order={order} />}

      <div className="grid gap-7 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)] xl:items-start">
        <div className="min-w-0 space-y-7">
          <DetailSection title="Order summary">
            <InfoGrid>
              <Info label="Source"><OrderBadge kind="source" value={order.source} /></Info>
              <Info label="Status"><OrderBadge kind="status" value={order.internalStatus} /></Info>
              <Info label="Created">{formatDateTime(order.createdAt)}</Info>
              <Info label="Updated">{formatDateTime(order.updatedAt)}</Info>
              <Info label="External created">{formatDateTime(order.externalCreatedAt)}</Info>
              <Info label="Shopify order number">{order.shopifyOrderNumber ?? "—"}</Info>
              <Info label="Currency">{order.currency ?? "—"}</Info>
              <Info label="Subtotal">{formatMoney(order.subtotal, order.currency)}</Info>
              <Info label="Shipping">{formatMoney(order.shippingAmount, order.currency)}</Info>
              <Info label="Tax">{formatMoney(order.taxAmount, order.currency)}</Info>
              <Info label="Total"><span className="font-semibold text-slate-900">{formatMoney(order.totalAmount, order.currency)}</span></Info>
              <Info label="Shop">{order.shop?.name ?? "—"}</Info>
              <Info label="Shop domain">{order.shop?.shopifyShopDomain ?? "—"}</Info>
            </InfoGrid>
            {(order.notes || order.holdReason || order.errorMessage) && (
              <div className="mt-6 grid gap-4">
                {order.notes && <Message label="Notes">{order.notes}</Message>}
                {order.holdReason && <Message label="Hold reason" tone="warning">{order.holdReason}</Message>}
                {order.errorMessage && <Message label="Order error" tone="error">{order.errorMessage}</Message>}
              </div>
            )}
          </DetailSection>

          <DetailSection title="Items" description={`${order.items.reduce((total, item) => total + item.quantity, 0)} units across ${order.items.length} lines`} noPadding>
            {order.items.length === 0 ? <EmptyState title="No items recorded" /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Product</th>
                      <th className="px-5 py-3">SKU</th>
                      <th className="px-5 py-3 text-right">Quantity</th>
                      <th className="px-5 py-3 text-right">Unit price</th>
                      <th className="px-5 py-3 text-right">Line total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {order.items.map((item, index) => (
                      <tr key={item.id}>
                        <td className="px-5 py-4 font-medium text-slate-900">{item.name}</td>
                        <td className="px-5 py-4 text-slate-600">
                          <div>{nullableDisplay.itemSkus[index]}</div>
                          {item.sgsSku && <div className="mt-1 text-xs text-slate-400">SGS: {item.sgsSku}</div>}
                        </td>
                        <td className="px-5 py-4 text-right tabular-nums text-slate-700">{item.quantity}</td>
                        <td className="px-5 py-4 text-right tabular-nums text-slate-700">{formatMoney(item.unitPrice, order.currency)}</td>
                        <td className="px-5 py-4 text-right font-medium tabular-nums text-slate-900">{formatMoney(item.unitPrice?.mul(item.quantity) ?? null, order.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DetailSection>

          <DetailSection title="Shipment" noPadding>
            {order.shipments.length === 0 ? (
              <EmptyState title="Shipment not created" description="This order does not have a shipment record yet." />
            ) : (
              <div className="divide-y divide-slate-200">
                {order.shipments.map((shipment, index) => <ShipmentDetails key={shipment.id} shipment={shipment} number={order.shipments.length > 1 ? index + 1 : null} />)}
              </div>
            )}
          </DetailSection>

          <DetailSection title="Tracking" noPadding>
            <Tracking order={order} />
          </DetailSection>
        </div>

        <div className="space-y-7">
          <OrderActions orderId={order.id} status={order.internalStatus} />

          <DetailSection title="Customer">
            <InfoStack label="Name">{nullableDisplay.customerName}</InfoStack>
            <InfoStack label="Email">{order.customerEmail ?? "—"}</InfoStack>
            <InfoStack label="Phone">{order.customerPhone ?? "—"}</InfoStack>
          </DetailSection>

          <DetailSection title="Shipping address">
            {order.address ? (
              <address className="space-y-1 text-sm not-italic leading-6 text-slate-700">
                <p className="font-medium text-slate-900">{nullableDisplay.address?.name}</p>
                {order.address.company && <p>{order.address.company}</p>}
                <p>{nullableDisplay.address?.address1}</p>
                {order.address.address2 && <p>{order.address.address2}</p>}
                {order.address.district && <p>{order.address.district}</p>}
                <p>{[order.address.city, order.address.province, order.address.postalCode].filter(Boolean).join(", ") || "—"}</p>
                <p>{nullableDisplay.address?.countryCode}</p>
                {order.address.phone && <p className="pt-2">Phone: {order.address.phone}</p>}
                {order.address.email && <p className="break-all">Email: {order.address.email}</p>}
              </address>
            ) : <EmptyState title="Shipping address not available" compact />}
          </DetailSection>

          <DetailSection title="Order history" noPadding>
            {order.statusHistory.length === 0 ? <EmptyState title="No status history" compact /> : (
              <ol className="divide-y divide-slate-200">
                {order.statusHistory.map((entry) => (
                  <li key={entry.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <OrderBadge kind="status" value={entry.toStatus} />
                      <time className="text-xs text-slate-500" dateTime={entry.createdAt.toISOString()}>{formatDateTime(entry.createdAt)}</time>
                    </div>
                    {entry.fromStatus && <p className="mt-2 text-xs text-slate-500">From {formatLabel(entry.fromStatus)}</p>}
                    <p className="mt-2 text-sm text-slate-700">{entry.reason ?? "No reason recorded"}</p>
                    <p className="mt-2 text-xs text-slate-500">{entry.actor ? `${entry.actor.name} (${entry.actor.email})` : "System"}</p>
                  </li>
                ))}
              </ol>
            )}
          </DetailSection>
        </div>
      </div>
    </div>
  );
}

function DetailSection({ title, description, noPadding = false, children }: { title: string; description?: string; noPadding?: boolean; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
      </div>
      <div className={noPadding ? "" : "p-5"}>{children}</div>
    </section>
  );
}

function InfoGrid({ children }: { children: ReactNode }) {
  return <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">{children}</dl>;
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="text-xs font-medium text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm text-slate-700">{children}</dd></div>;
}

function InfoStack({ label, children }: { label: string; children: ReactNode }) {
  return <div className="border-b border-slate-100 py-3 first:pt-0 last:border-0 last:pb-0"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 break-words text-sm text-slate-800">{children}</p></div>;
}

function Message({ label, tone = "neutral", children }: { label: string; tone?: "neutral" | "warning" | "error"; children: ReactNode }) {
  const colors = tone === "error" ? "border-red-200 bg-red-50 text-red-800" : tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-50 text-slate-700";
  return <div className={`rounded-md border px-4 py-3 text-sm ${colors}`}><p className="font-medium">{label}</p><p className="mt-1 whitespace-pre-wrap">{children}</p></div>;
}

function EmptyState({ title, description, compact = false }: { title: string; description?: string; compact?: boolean }) {
  return <div className={compact ? "py-3 text-center" : "px-6 py-10 text-center"}><p className="text-sm font-medium text-slate-700">{title}</p>{description && <p className="mt-1 text-sm text-slate-500">{description}</p>}</div>;
}

function ReplacementLinks({ order }: { order: OrderDetail }) {
  return (
    <section aria-label="Replacement relationships" className="rounded-lg border border-orange-200 bg-orange-50 px-5 py-4 text-sm text-orange-900">
      {order.parentOrder && (
        <p>
          This is a replacement for{" "}
          <Link className="inline-flex items-center gap-1 font-semibold underline underline-offset-2" href={`/orders/${encodeURIComponent(order.parentOrder.id)}`}>
            {getOrderDisplayNumber(order.parentOrder)} <ExternalLink aria-hidden="true" size={13} />
          </Link>.
        </p>
      )}
      {order.replacements.length > 0 && (
        <div className={order.parentOrder ? "mt-3" : ""}>
          <p className="font-medium">Replacement orders</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {order.replacements.map((replacement) => (
              <Link key={replacement.id} href={`/orders/${encodeURIComponent(replacement.id)}`} className="rounded-md border border-orange-200 bg-white px-3 py-2 font-medium hover:border-orange-300">
                {getOrderDisplayNumber(replacement)} · {formatLabel(replacement.internalStatus)}
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ShipmentDetails({ shipment, number }: { shipment: OrderDetail["shipments"][number]; number: number | null }) {
  return (
    <article className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        {number && <h3 className="mr-1 text-sm font-semibold text-slate-900">Shipment {number}</h3>}
        <OrderBadge kind="carrier" value={shipment.carrier} />
        <OrderBadge kind="shipmentStatus" value={shipment.internalStatus} />
      </div>
      {(shipment.lastErrorCode || shipment.lastErrorMessage) && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-medium">Shipment error{shipment.lastErrorCode ? ` · ${shipment.lastErrorCode}` : ""}</p>
          {shipment.lastErrorMessage && <p className="mt-1">{shipment.lastErrorMessage}</p>}
        </div>
      )}
      <dl className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        <Info label="Warehouse">{shipment.warehouseCode || "—"}</Info>
        <Info label="Shipping method">{shipment.shippingMethodCode || "—"}</Info>
        <Info label="Tracking number">{shipment.trackingNumber ?? "—"}</Info>
        <Info label="Carrier order code">{shipment.carrierOrderCode ?? "—"}</Info>
        <Info label="Carrier reference">{shipment.carrierReferenceNo}</Info>
        <Info label="Carrier status">{shipment.carrierStatus ?? "—"}</Info>
        <Info label="Carrier sub-status">{shipment.carrierSubStatus ?? "—"}</Info>
        <Info label="Allocation status">{shipment.allocationStatus ?? "—"}</Info>
        <Info label="Shipping cost">{formatMoney(shipment.shippingCost, shipment.carrierCurrency)}</Info>
        <Info label="Total carrier cost">{formatMoney(shipment.totalCarrierCost, shipment.carrierCurrency)}</Info>
        <Info label="Carrier created">{formatDateTime(shipment.carrierCreatedAt)}</Info>
        <Info label="Shipped">{formatDateTime(shipment.carrierShippedAt)}</Info>
        <Info label="Last carrier sync">{formatDateTime(shipment.lastCarrierSyncAt)}</Info>
        <Info label="Label last fetched">{formatDateTime(shipment.labelLastFetchedAt)}</Info>
        <Info label="Cancel status">{shipment.cancelStatus ?? "—"}</Info>
        <Info label="Cancellation requested">{formatDateTime(shipment.cancellationRequestedAt)}</Info>
        <Info label="Cancellation resolved">{formatDateTime(shipment.cancellationResolvedAt)}</Info>
      </dl>
      {shipment.cancellationReason && <div className="mt-5"><Message label="Cancellation reason" tone="warning">{shipment.cancellationReason}</Message></div>}
    </article>
  );
}

function Tracking({ order }: { order: OrderDetail }) {
  const shipmentsWithEvents = order.shipments.filter((shipment) => shipment.trackingEvents.length > 0);

  if (shipmentsWithEvents.length === 0) {
    return <EmptyState title="No tracking events" description={order.shipments.length === 0 ? "Tracking will be available after a shipment is created and events are received." : "No tracking events have been recorded for this order."} />;
  }

  return (
    <div className="divide-y divide-slate-200">
      {shipmentsWithEvents.map((shipment) => (
        <div key={shipment.id} className="p-5">
          {order.shipments.length > 1 && <p className="mb-4 text-xs font-medium text-slate-500">{shipment.trackingNumber ?? shipment.carrierReferenceNo}</p>}
          <ol className="space-y-5">
            {[...shipment.trackingEvents].sort((first, second) =>
              (first.eventAt ?? first.createdAt).getTime() - (second.eventAt ?? second.createdAt).getTime()
            ).map((event) => {
              const occurredAt = event.eventAt ?? event.createdAt;
              return (
                <li key={event.id} className="relative border-l border-slate-200 pl-5">
                  <span className="absolute -left-1.5 top-1 h-3 w-3 rounded-full border-2 border-white bg-slate-400" aria-hidden="true" />
                  <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-start">
                    <p className="text-sm font-medium text-slate-900">{event.description ?? formatLabel(event.status)}</p>
                    <time className="whitespace-nowrap text-xs text-slate-500" dateTime={occurredAt.toISOString()}>{formatDateTime(occurredAt)}</time>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{[event.status && formatLabel(event.status), event.location, event.carrierEventCode].filter(Boolean).join(" · ") || "No additional details"}</p>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}
