import assert from "node:assert/strict";
import test from "node:test";
import { orderListSearchParams, parseOrderListParams } from "./order-list-params.ts";

test("parses valid order list parameters", () => {
  assert.deepEqual(parseOrderListParams({
    q: "  DEV-SHOP  ",
    status: "ON_HOLD",
    source: "SHOPIFY",
    shipment: "with",
    sort: "total_desc",
    page: "3",
  }), {
    query: "DEV-SHOP",
    status: "ON_HOLD",
    source: "SHOPIFY",
    shipment: "with",
    sort: "total_desc",
    page: 3,
  });
});

test("normalizes invalid and repeated parameters safely", () => {
  assert.deepEqual(parseOrderListParams({
    q: ["customer", "ignored"],
    status: "UNKNOWN",
    source: "INVALID",
    shipment: "all",
    sort: "random",
    page: "-4",
  }), {
    query: "customer",
    status: undefined,
    source: undefined,
    shipment: undefined,
    sort: "newest",
    page: 1,
  });
});

test("pagination URLs preserve active controls and omit defaults", () => {
  const params = parseOrderListParams({ q: "track", status: "SHIPPED", sort: "oldest" });
  assert.equal(orderListSearchParams(params, 2).toString(), "q=track&status=SHIPPED&sort=oldest&page=2");
  assert.equal(orderListSearchParams(parseOrderListParams({}), 1).toString(), "");
});
