export default function OrdersLoading() {
  return (
    <div className="space-y-7" aria-busy="true" aria-label="Loading orders">
      <div className="border-b border-slate-200 pb-7">
        <div className="h-8 w-32 animate-pulse rounded bg-slate-200" />
        <div className="mt-3 h-5 w-full max-w-lg animate-pulse rounded bg-slate-200" />
      </div>
      <div className="h-28 animate-pulse rounded-lg border border-slate-200 bg-white" />
      <div className="h-96 animate-pulse rounded-lg border border-slate-200 bg-white" />
    </div>
  );
}
