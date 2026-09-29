export function PageHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="border-b border-slate-200 pb-7">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{description}</p>
    </div>
  );
}
