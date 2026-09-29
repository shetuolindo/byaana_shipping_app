import { NextResponse } from "next/server";
import { UnauthenticatedError, UnauthorizedError } from "@/modules/auth/authorization";
import { requirePortalUser } from "@/modules/auth/session";
import { getShopifyConfig, ShopifyConfigurationError } from "@/modules/shopify/config";
import {
  SHOPIFY_OAUTH_STATE_COOKIE,
  SHOPIFY_OAUTH_STATE_MAX_AGE_SECONDS,
  SHOPIFY_REQUIRED_SCOPES,
} from "@/modules/shopify/constants";
import { getConnectedShopifyShop } from "@/modules/shopify/connection";
import { buildShopifyAuthorizationUrl, createShopifyOAuthState } from "@/modules/shopify/oauth";
import { isExpectedShopifyAppOrigin } from "@/modules/shopify/request-origin";
import { normalizeShopifyShopDomain } from "@/modules/shopify/shop-domain";

export async function POST(request: Request) {
  try {
    await requirePortalUser("SETTINGS");
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
    }
    return NextResponse.json({ error: "Shopify connection is unavailable." }, { status: 500 });
  }

  try {
    const config = getShopifyConfig();
    if (!isExpectedShopifyAppOrigin(request.headers.get("origin"), config.appUrl)) {
      return NextResponse.json(
        { error: "Open Settings from the configured public application URL before connecting Shopify." },
        { status: 400 },
      );
    }

    const formData = await request.formData();
    const shop = normalizeShopifyShopDomain(formData.get("shop"));
    if (!shop) {
      return NextResponse.redirect(new URL("/settings?shopify=invalid_shop", config.appUrl), 303);
    }

    const connectedShop = await getConnectedShopifyShop();
    if (connectedShop && connectedShop.shopifyShopDomain !== shop) {
      return NextResponse.redirect(new URL("/settings?shopify=different_shop", config.appUrl), 303);
    }

    const oauthState = createShopifyOAuthState(shop, config.clientSecret);
    const authorizationUrl = buildShopifyAuthorizationUrl({
      shop,
      clientId: config.clientId,
      redirectUri: config.callbackUrl,
      scopes: SHOPIFY_REQUIRED_SCOPES,
      state: oauthState.state,
    });
    const response = NextResponse.redirect(authorizationUrl, 303);
    response.cookies.set(SHOPIFY_OAUTH_STATE_COOKIE, oauthState.cookieValue, {
      httpOnly: true,
      maxAge: SHOPIFY_OAUTH_STATE_MAX_AGE_SECONDS,
      path: "/api/shopify/callback",
      sameSite: "lax",
      secure: true,
    });
    return response;
  } catch (error) {
    const status = error instanceof ShopifyConfigurationError ? 503 : 500;
    return NextResponse.json({ error: "Shopify connection is unavailable." }, { status });
  }
}
