export function isExpectedShopifyAppOrigin(origin: string | null, appUrl: string) {
  return origin === appUrl;
}
