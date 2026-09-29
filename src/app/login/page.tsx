import { Package } from "lucide-react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LoginForm } from "@/components/auth/login-form";
import { safePortalRedirect } from "@/modules/auth/auth-input";

type LoginPageProps = {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await auth();
  if (session?.user) redirect("/");

  const params = await searchParams;
  const callbackUrl = safePortalRedirect(
    Array.isArray(params.callbackUrl) ? params.callbackUrl[0] : params.callbackUrl,
  );

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10 text-slate-900">
      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-slate-900 p-2 text-white">
            <Package aria-hidden="true" size={22} />
          </span>
          <p className="text-sm font-semibold tracking-tight">Shipping Portal</p>
        </div>
        <h1 className="mt-8 text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Use your internal portal credentials to continue.
        </p>
        <LoginForm callbackUrl={callbackUrl} />
      </section>
    </main>
  );
}
