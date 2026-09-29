"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { submitLogin } from "@/app/login/actions";
import { initialLoginActionState } from "@/modules/auth/login-state";

const inputClass = "mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200";

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, action] = useActionState(submitLogin, initialLoginActionState);

  return (
    <form action={action} className="mt-7 space-y-5">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <label className="block text-sm font-medium text-slate-700">
        Email
        <input
          autoComplete="username"
          className={inputClass}
          name="email"
          type="email"
          required
          autoFocus
        />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Password
        <input
          autoComplete="current-password"
          className={inputClass}
          name="password"
          type="password"
          required
        />
      </label>
      {state.message && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.message}
        </p>
      )}
      <LoginButton />
    </form>
  );
}

function LoginButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-wait disabled:bg-slate-400"
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}
