import { PageHeading } from "@/components/portal/page-heading";
import { redirect } from "next/navigation";
import { UnauthenticatedError, UnauthorizedError } from "@/modules/auth/authorization";
import { requirePortalUser } from "@/modules/auth/session";
import { isShopifyConfigured } from "@/modules/shopify/config";
import { getConnectedShopifyShop } from "@/modules/shopify/connection";

const messages: Record<string, { tone: "success" | "error"; text: string }> = {
  connected: { tone: "success", text: "Shopify was connected successfully." },
  invalid_shop: { tone: "error", text: "Enter a valid store domain ending in .myshopify.com." },
  different_shop: { tone: "error", text: "A different Shopify store is already connected." },
  authorization_error: { tone: "error", text: "Administrator authorization was not available. Start the connection again." },
  connection_error: { tone: "error", text: "Shopify could not be connected. No connection changes were saved." },
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ shopify?: string | string[] }>;
}) {
  try {
    await requirePortalUser("SETTINGS");
  } catch (error) {
    if (error instanceof UnauthorizedError) redirect("/");
    if (error instanceof UnauthenticatedError) redirect("/login?callbackUrl=%2Fsettings");
    throw error;
  }

  const [connectedShop, params] = await Promise.all([
    getConnectedShopifyShop(),
    searchParams,
  ]);
  const configured = isShopifyConfigured();
  const statusKey = typeof params.shopify === "string" ? params.shopify : "";
  const message = messages[statusKey];

  return (
    <div className="space-y-7">
      <PageHeading title="Settings" description="Manage administrator-only portal integrations." />

      {message && (
        <div
          role={message.tone === "error" ? "alert" : "status"}
          className={message.tone === "error"
            ? "rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            : "rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"}
        >
          {message.text}
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Shopify</h2>
              <p className="mt-1 text-xs text-slate-500">Offline Admin API connection for this portal.</p>
            </div>
            <span className={connectedShop
              ? "rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800"
              : "rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700"}
            >
              {connectedShop ? "Connected" : "Not connected"}
            </span>
          </div>
        </div>

        <div className="space-y-5 p-5">
          {connectedShop ? (
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Store</dt>
                <dd className="mt-1 font-medium text-slate-900">{connectedShop.name}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Shop domain</dt>
                <dd className="mt-1 text-slate-700">{connectedShop.shopifyShopDomain}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm leading-6 text-slate-600">
              Connect the client&apos;s permanent <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">.myshopify.com</code> domain.
              No orders are imported by this connection flow.
            </p>
          )}

          {!configured && (
            <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Shopify application credentials must be configured on the server before connecting.
            </div>
          )}

          <form action="/api/shopify/connect" method="post" className="flex max-w-2xl flex-col gap-3 sm:flex-row sm:items-end">
            <label className="block flex-1 text-sm font-medium text-slate-700">
              Shopify store domain
              <input
                name="shop"
                type="text"
                required
                readOnly={Boolean(connectedShop)}
                defaultValue={connectedShop?.shopifyShopDomain}
                placeholder="store-name.myshopify.com"
                autoComplete="off"
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200 read-only:bg-slate-50"
              />
            </label>
            <button
              type="submit"
              disabled={!configured}
              className="rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {connectedShop ? "Reconnect Shopify" : "Connect Shopify"}
            </button>
          </form>
          <p className="text-xs leading-5 text-slate-500">
            For development, open Settings through the configured public HTTPS application URL before starting authorization.
          </p>
        </div>
      </section>
    </div>
  );
}
