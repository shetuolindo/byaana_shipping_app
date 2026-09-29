const SHOPIFY_DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/;

export function normalizeShopifyShopDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const domain = value.trim().toLowerCase();
  return SHOPIFY_DOMAIN_PATTERN.test(domain) ? domain : null;
}

