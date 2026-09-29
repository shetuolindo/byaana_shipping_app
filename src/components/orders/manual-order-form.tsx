"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Trash2 } from "lucide-react";
import { submitManualOrder } from "@/app/orders/new/actions";
import { submitReplacementOrder } from "@/app/orders/[id]/replacement/actions";
import {
  initialManualOrderActionState,
  minorUnitsToMoney,
  parseMoneyToMinorUnits,
} from "@/modules/orders/manual-order";
import type { InternalOrderFormValues } from "@/modules/orders/replacement-order";

type FormItem = { key: string; name: string; sku: string; quantity: string; unitPrice: string };

const inputClass = "mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200";

type InternalOrderFormProps = {
  mode?: "manual" | "replacement";
  originalOrderId?: string;
  initialValues?: InternalOrderFormValues;
};

export function ManualOrderForm(props: InternalOrderFormProps = {}) {
  const mode = props.mode ?? "manual";
  const [state, formAction] = useActionState(mode === "replacement" ? submitReplacementOrder : submitManualOrder, initialManualOrderActionState);
  const [items, setItems] = useState<FormItem[]>(() => props.initialValues?.items.length
    ? props.initialValues.items.map((item, index) => ({ ...item, key: `initial-${index}` }))
    : [newItem()]);
  const previewTotal = useMemo(() => items.reduce((total, item) => {
    if (!/^\d+$/.test(item.quantity) || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(item.unitPrice)) return total;
    return total + BigInt(item.quantity) * parseMoneyToMinorUnits(item.unitPrice);
  }, BigInt(0)), [items]);

  const error = (name: string) => state.fieldErrors?.[name]?.[0];

  function updateItem(key: string, field: keyof Omit<FormItem, "key">, value: string) {
    setItems((current) => current.map((item) => item.key === key ? { ...item, [field]: value } : item));
  }

  return (
    <form action={formAction} className="space-y-7">
      {props.originalOrderId && <input type="hidden" name="originalOrderId" value={props.originalOrderId} />}
      {state.status === "error" && state.message && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {state.message}
        </div>
      )}

      <FormSection title="Customer" description="Contact information for the person placing the order.">
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Name" name="customerName" defaultValue={props.initialValues?.customerName} required error={error("customerName")} />
          <Field label="Email" name="customerEmail" defaultValue={props.initialValues?.customerEmail} type="email" error={error("customerEmail")} />
          <Field label="Phone" name="customerPhone" defaultValue={props.initialValues?.customerPhone} type="tel" error={error("customerPhone")} />
        </div>
      </FormSection>

      <FormSection title="Shipping address" description="The address snapshot saved with this order.">
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Recipient name" name="recipientName" defaultValue={props.initialValues?.recipientName} required error={error("recipientName")} />
          <Field label="Address line 1" name="address1" defaultValue={props.initialValues?.address1} required error={error("address1")} />
          <Field label="Address line 2" name="address2" defaultValue={props.initialValues?.address2} error={error("address2")} />
          <Field label="City" name="city" defaultValue={props.initialValues?.city} error={error("city")} />
          <Field label="State / province / region" name="province" defaultValue={props.initialValues?.province} error={error("province")} />
          <Field label="Postal / ZIP code" name="postalCode" defaultValue={props.initialValues?.postalCode} error={error("postalCode")} />
          <Field label="Country code" name="countryCode" defaultValue={props.initialValues?.countryCode ?? "GB"} required maxLength={2} hint="Two-letter code, for example GB." error={error("countryCode")} />
        </div>
      </FormSection>

      <FormSection title="Items" description="Add at least one product. Line and order totals shown here are previews; the server recalculates them before saving.">
        <div className="space-y-4">
          {items.map((item, index) => {
            const quantity = /^\d+$/.test(item.quantity) ? BigInt(item.quantity) : BigInt(0);
            const unitPrice = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(item.unitPrice) ? parseMoneyToMinorUnits(item.unitPrice) : BigInt(0);
            return (
              <div key={item.key} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-900">Item {index + 1}</h3>
                  <button type="button" onClick={() => setItems((current) => current.filter((candidate) => candidate.key !== item.key))} disabled={items.length === 1} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400">
                    <Trash2 aria-hidden="true" size={14} /> Remove
                  </button>
                </div>
                <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_8rem_minmax(8rem,1fr)]">
                  <ItemField label="Product title" name="itemName" value={item.name} onChange={(value) => updateItem(item.key, "name", value)} error={error(`items.${index}.name`)} />
                  <ItemField label="SKU" name="itemSku" value={item.sku} onChange={(value) => updateItem(item.key, "sku", value)} error={error(`items.${index}.sku`)} />
                  <ItemField label="Quantity" name="itemQuantity" value={item.quantity} type="number" min="1" step="1" onChange={(value) => updateItem(item.key, "quantity", value)} error={error(`items.${index}.quantity`)} />
                  <ItemField label="Unit price" name="itemUnitPrice" value={item.unitPrice} type="text" inputMode="decimal" placeholder="0.00" onChange={(value) => updateItem(item.key, "unitPrice", value)} error={error(`items.${index}.unitPrice`)} />
                </div>
                <p className="mt-3 text-right text-sm text-slate-600">Line total: <span className="font-semibold tabular-nums text-slate-900">{minorUnitsToMoney(quantity * unitPrice)}</span></p>
              </div>
            );
          })}
          {(error("items") || error("form")) && <p className="text-sm text-red-700">{error("items") ?? error("form")}</p>}
          <button type="button" onClick={() => setItems((current) => [...current, newItem()])} className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
            <Plus aria-hidden="true" size={16} /> Add item
          </button>
        </div>
      </FormSection>

      <FormSection title="Order details / summary" description="Financial values use the order currency.">
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="grid gap-5">
            <Field label="Currency" name="currency" defaultValue={props.initialValues?.currency ?? "GBP"} required maxLength={3} hint="Three-letter code, for example GBP." error={error("currency")} />
            <label className="block text-sm font-medium text-slate-700">Notes<textarea name="notes" rows={4} defaultValue={props.initialValues?.notes} className={inputClass} aria-invalid={Boolean(error("notes"))} />{error("notes") && <FieldError>{error("notes")}</FieldError>}</label>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Order total</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{minorUnitsToMoney(previewTotal)}</p>
            <p className="mt-2 text-xs leading-5 text-slate-500">Sum of item quantity × unit price. Shipping and tax are not added by this form.</p>
          </div>
        </div>
      </FormSection>

      <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-6">
        <Link href={props.originalOrderId ? `/orders/${encodeURIComponent(props.originalOrderId)}` : "/orders"} className="rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">Cancel</Link>
        <SubmitButton replacement={mode === "replacement"} />
      </div>
    </form>
  );
}

function FormSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="rounded-lg border border-slate-200 bg-white"><div className="border-b border-slate-200 px-5 py-4"><h2 className="text-sm font-semibold text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-500">{description}</p></div><div className="p-5">{children}</div></section>;
}

function Field({ label, name, error, hint, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; error?: string; hint?: string }) {
  return <label className="block text-sm font-medium text-slate-700">{label}<input name={name} className={inputClass} aria-invalid={Boolean(error)} {...props} />{error ? <FieldError>{error}</FieldError> : hint ? <p className="mt-1.5 text-xs font-normal text-slate-500">{hint}</p> : null}</label>;
}

function ItemField({ label, error, onChange, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & { label: string; error?: string; onChange(value: string): void }) {
  return <label className="block text-sm font-medium text-slate-700">{label}<input required className={inputClass} aria-invalid={Boolean(error)} onChange={(event) => onChange(event.target.value)} {...props} />{error && <FieldError>{error}</FieldError>}</label>;
}

function FieldError({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-xs font-normal text-red-700">{children}</p>;
}

function SubmitButton({ replacement }: { replacement: boolean }) {
  const { pending } = useFormStatus();
  const label = replacement ? "Create Replacement" : "Create Order";
  return <button type="submit" disabled={pending} className="rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-wait disabled:bg-slate-400">{pending ? "Creating order…" : label}</button>;
}

function newItem(): FormItem {
  return { key: crypto.randomUUID(), name: "", sku: "", quantity: "1", unitPrice: "" };
}
