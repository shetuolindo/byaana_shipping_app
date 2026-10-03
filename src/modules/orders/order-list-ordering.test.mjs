import assert from "node:assert/strict";
import test from "node:test";
import { selectChronologicalOrderPage } from "./order-list-ordering.ts";

const order = (id, source, createdAt, externalCreatedAt = null) => ({
  id,
  source,
  createdAt: new Date(createdAt),
  externalCreatedAt: externalCreatedAt === null ? null : new Date(externalCreatedAt),
});

const groups = [
  [
    order("shopify-newer", "SHOPIFY", "2026-10-04T10:00:00.000Z", "2026-10-03T10:00:00.000Z"),
    order("shopify-older", "SHOPIFY", "2026-10-04T10:02:00.000Z", "2026-10-01T10:00:00.000Z"),
  ],
  [order("shopify-without-source-date", "SHOPIFY", "2026-10-02T12:00:00.000Z")],
  [
    order("replacement-newest", "REPLACEMENT", "2026-10-04T12:00:00.000Z"),
    order("manual-middle", "MANUAL", "2026-10-02T18:00:00.000Z", "2099-01-01T00:00:00.000Z"),
  ],
];

test("orders mixed sources by source creation time rather than insertion or order number", () => {
  assert.deepEqual(
    selectChronologicalOrderPage(groups, "desc", 0, 10).map(({ id }) => id),
    [
      "replacement-newest",
      "shopify-newer",
      "manual-middle",
      "shopify-without-source-date",
      "shopify-older",
    ],
  );

  assert.deepEqual(
    selectChronologicalOrderPage(groups, "asc", 0, 10).map(({ id }) => id),
    [
      "shopify-older",
      "shopify-without-source-date",
      "manual-middle",
      "shopify-newer",
      "replacement-newest",
    ],
  );
});

test("applies pagination after the globally chronological merge", () => {
  assert.deepEqual(
    selectChronologicalOrderPage(groups, "desc", 0, 2).map(({ id }) => id),
    ["replacement-newest", "shopify-newer"],
  );
  assert.deepEqual(
    selectChronologicalOrderPage(groups, "desc", 2, 2).map(({ id }) => id),
    ["manual-middle", "shopify-without-source-date"],
  );
});

test("uses local creation time and id as deterministic tie breakers", () => {
  const tied = [[
    order("a", "SHOPIFY", "2026-10-04T10:00:00.000Z", "2026-10-03T10:00:00.000Z"),
    order("b", "SHOPIFY", "2026-10-04T11:00:00.000Z", "2026-10-03T10:00:00.000Z"),
    order("c", "SHOPIFY", "2026-10-04T11:00:00.000Z", "2026-10-03T10:00:00.000Z"),
  ]];

  assert.deepEqual(
    selectChronologicalOrderPage(tied, "desc", 0, 10).map(({ id }) => id),
    ["c", "b", "a"],
  );
});
