"use client";

import type { OrderStatus } from "@prisma/client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { submitOrderTransition } from "@/app/orders/[id]/actions";
import { initialOrderActionState } from "@/modules/orders/order-action-state";
import { availableOrderActions, type OrderTransitionAction } from "@/modules/orders/order-transitions";

const inputClass = "mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200";

export function OrderActions({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const [state, formAction] = useActionState(submitOrderTransition, initialOrderActionState);
  const actions = availableOrderActions(status);

  if (actions.length === 0) return null;

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Order actions</h2>
        <p className="mt-1 text-xs text-slate-500">These actions change internal portal status only.</p>
      </div>
      <div className="space-y-5 p-5">
        {state.message && (
          <div role={state.status === "error" ? "alert" : "status"} className={`rounded-md border px-3 py-2 text-sm ${state.status === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
            {state.message}
          </div>
        )}

        {actions.includes("HOLD") && (
          <ActionForm action={formAction} orderId={orderId} status={status} transition="HOLD">
            <label className="block text-sm font-medium text-slate-700">
              Hold reason <span className="font-normal text-slate-400">(optional)</span>
              <textarea name="reason" rows={2} maxLength={300} className={inputClass} />
            </label>
            <ActionButton label="Put on Hold" pendingLabel="Putting on hold…" />
          </ActionForm>
        )}

        {actions.includes("RESUME") && (
          <ActionForm action={formAction} orderId={orderId} status={status} transition="RESUME">
            <p className="text-sm text-slate-600">Return this order to the status it had before being held.</p>
            <ActionButton label="Resume" pendingLabel="Resuming…" />
          </ActionForm>
        )}

        {actions.includes("CANCEL") && (
          <ActionForm action={formAction} orderId={orderId} status={status} transition="CANCEL" confirmCancellation>
            <label className="block text-sm font-medium text-slate-700">
              Cancellation reason <span className="font-normal text-slate-400">(optional)</span>
              <textarea name="reason" rows={2} maxLength={300} className={inputClass} />
            </label>
            <ActionButton label="Cancel Order" pendingLabel="Cancelling…" danger />
          </ActionForm>
        )}
      </div>
    </section>
  );
}

function ActionForm({ action, orderId, status, transition, confirmCancellation = false, children }: {
  action: (payload: FormData) => void;
  orderId: string;
  status: OrderStatus;
  transition: OrderTransitionAction;
  confirmCancellation?: boolean;
  children: React.ReactNode;
}) {
  return (
    <form
      action={action}
      className={transition === "CANCEL" ? "space-y-3 border-t border-slate-200 pt-5" : "space-y-3"}
      onSubmit={confirmCancellation ? (event) => {
        if (!window.confirm("Cancel this order internally? This action cannot be undone in this task.")) event.preventDefault();
      } : undefined}
    >
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="expectedStatus" value={status} />
      <input type="hidden" name="action" value={transition} />
      {children}
    </form>
  );
}

function ActionButton({ label, pendingLabel, danger = false }: { label: string; pendingLabel: string; danger?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`rounded-md border px-3.5 py-2 text-sm font-semibold shadow-sm disabled:cursor-wait disabled:opacity-60 ${danger ? "border-red-300 bg-white text-red-700 hover:bg-red-50" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
      {pending ? pendingLabel : label}
    </button>
  );
}
