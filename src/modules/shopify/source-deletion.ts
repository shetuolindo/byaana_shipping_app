export type ShopifySourceDeletionState = {
  shopifySyncState: "IN_SYNC" | "REVIEW_REQUIRED" | "SOURCE_DELETED" | null;
  shopifyDeletedAt: Date | null;
  shopifyLastSeenUpdatedAt: Date | null;
};

export function getShopifySourceDeletionUpdate(
  state: ShopifySourceDeletionState,
  triggeredAt: Date,
) {
  if (state.shopifySyncState === "SOURCE_DELETED"
    && state.shopifyDeletedAt
    && state.shopifyDeletedAt >= triggeredAt) {
    return null;
  }
  return {
    shopifyDeletedAt: triggeredAt,
    shopifyLastSeenUpdatedAt: !state.shopifyLastSeenUpdatedAt
      || triggeredAt > state.shopifyLastSeenUpdatedAt
      ? triggeredAt
      : state.shopifyLastSeenUpdatedAt,
    shopifySyncState: "SOURCE_DELETED" as const,
  };
}
