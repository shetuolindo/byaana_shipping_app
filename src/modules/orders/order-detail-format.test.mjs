import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDateTime,
  formatLabel,
  formatMoney,
  getOrderDisplayNumber,
} from "./order-detail-format.ts";

const decimal = (value) => ({ toFixed: () => value });

test("uses the portal order number for every order source", () => {
  assert.equal(getOrderDisplayNumber({ orderNumber: "SHOP-1042" }), "SHOP-1042");
  assert.equal(getOrderDisplayNumber({ orderNumber: "DEV-1001" }), "DEV-1001");
});

test("formats Decimal-compatible money without converting it to a Number", () => {
  assert.equal(formatMoney(decimal("1234.50"), "GBP"), "£1,234.50");
  assert.equal(formatMoney(decimal("9999999999.99"), "USD"), "US$9,999,999,999.99");
  assert.equal(formatMoney(decimal("12.30"), null), "12.30");
  assert.equal(formatMoney(null, "GBP"), "—");
});

test("formats operational dates and labels consistently", () => {
  assert.equal(formatDateTime(new Date("2026-01-05T09:07:00.000Z")), "05 Jan 2026, 09:07 UTC");
  assert.equal(formatDateTime(null), "—");
  assert.equal(formatLabel("ON_HOLD"), "On hold");
  assert.equal(formatLabel(null), "—");
});
