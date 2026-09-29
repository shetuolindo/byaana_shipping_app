"use client";

export default function OrdersError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-white p-8">
      <h1 className="text-xl font-semibold text-slate-900">Orders could not be loaded</h1>
      <p className="mt-2 text-sm text-slate-600">The order data is temporarily unavailable. Please try again.</p>
      <button type="button" onClick={reset} className="mt-5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">Try again</button>
    </div>
  );
}
