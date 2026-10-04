import assert from "node:assert/strict";
import test from "node:test";
import { getShopifySourceDeletionUpdate } from "./source-deletion.ts";

test("creates a source-deletion tombstone without operational field changes", () => {
  const triggeredAt = new Date("2026-10-04T12:00:00Z");
  const update = getShopifySourceDeletionUpdate({
    shopifySyncState: "IN_SYNC",
    shopifyDeletedAt: null,
    shopifyLastSeenUpdatedAt: new Date("2026-10-04T11:00:00Z"),
  }, triggeredAt);
  assert.deepEqual(update, {
    shopifyDeletedAt: triggeredAt,
    shopifyLastSeenUpdatedAt: triggeredAt,
    shopifySyncState: "SOURCE_DELETED",
  });
  assert.equal("internalStatus" in update, false);
});

test("makes repeated or older source-deletion events idempotent", () => {
  const deletedAt = new Date("2026-10-04T12:00:00Z");
  const state = {
    shopifySyncState: "SOURCE_DELETED",
    shopifyDeletedAt: deletedAt,
    shopifyLastSeenUpdatedAt: deletedAt,
  };
  assert.equal(getShopifySourceDeletionUpdate(state, deletedAt), null);
  assert.equal(getShopifySourceDeletionUpdate(state, new Date("2026-10-04T11:00:00Z")), null);
});
