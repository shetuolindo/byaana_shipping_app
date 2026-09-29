import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { UnauthenticatedError, UnauthorizedError } from "@/modules/auth/authorization";
import { requirePortalUser } from "@/modules/auth/session";
import { exchangeShopifyAuthorizationCode, fetchShopifyIdentity } from "@/modules/shopify/client";
import { getShopifyConfig } from "@/modules/shopify/config";
import { persistShopifyConnection } from "@/modules/shopify/connection";
import { SHOPIFY_OAUTH_STATE_COOKIE } from "@/modules/shopify/constants";
import { validateShopifyOAuthCallback } from "@/modules/shopify/oauth";

function settingsRedirect(appUrl: string, status: string) {
  return NextResponse.redirect(new URL(`/settings?shopify=${status}`, appUrl), 303);
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(SHOPIFY_OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(SHOPIFY_OAUTH_STATE_COOKIE);

  let actorUserId: string;
  try {
    actorUserId = (await requirePortalUser("SETTINGS")).id;
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Administrator authorization is required." }, { status: 403 });
    }
    return NextResponse.json({ error: "Shopify connection is unavailable." }, { status: 500 });
  }

  let config;
  try {
    config = getShopifyConfig();
  } catch {
    return NextResponse.json({ error: "Shopify connection is unavailable." }, { status: 503 });
  }

  try {
    const url = new URL(request.url);
    const callback = validateShopifyOAuthCallback({
      params: url.searchParams,
      stateCookie,
      clientSecret: config.clientSecret,
    });
    const accessToken = await exchangeShopifyAuthorizationCode({
      shop: callback.shop,
      code: callback.code,
      config,
    });
    const identity = await fetchShopifyIdentity({
      shop: callback.shop,
      accessToken,
      apiVersion: config.apiVersion,
    });
    await persistShopifyConnection({
      actorUserId,
      accessToken,
      encryptionKey: config.tokenEncryptionKey,
      name: identity.name,
      shopifyShopDomain: identity.shopifyShopDomain,
    });

    return settingsRedirect(config.appUrl, "connected");
  } catch {
    return settingsRedirect(config.appUrl, "connection_error");
  }
}
