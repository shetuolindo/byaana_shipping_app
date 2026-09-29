import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateManualOrderTotal,
  generateManualOrderNumber,
  generateReplacementOrderNumber,
  manualOrderSchema,
  minorUnitsToMoney,
  normalizeMoney,
} from "./manual-order.ts";

const validOrder = {
  customerName: "Ada Lovelace",
  customerEmail: "ada@example.com",
  customerPhone: "+44 20 1234 5678",
  recipientName: "Ada Lovelace",
  address1: "1 Example Street",
  address2: "",
  city: "London",
  province: "",
  postalCode: "SW1A 1AA",
  countryCode: "gb",
  currency: "gbp",
  notes: "",
  items: [{ name: "Widget", sku: "SKU-1", quantity: "2", unitPrice: "12.345" }],
};

test("validates and normalizes manual order input", () => {
  const result = manualOrderSchema.safeParse({
    ...validOrder,
    items: [{ name: "Widget", sku: "SKU-1", quantity: "2", unitPrice: "12.3" }],
  });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.countryCode, "GB");
  assert.equal(result.data.currency, "GBP");
  assert.equal(result.data.items[0].quantity, 2);
  assert.equal(result.data.items[0].unitPrice, "12.30");
  assert.equal(result.data.address2, undefined);
});

test("rejects invalid email, quantities, money, and empty item lists", () => {
  assert.equal(manualOrderSchema.safeParse(validOrder).success, false);
  assert.equal(manualOrderSchema.safeParse({ ...validOrder, customerEmail: "not-an-email", items: [] }).success, false);
  assert.equal(manualOrderSchema.safeParse({ ...validOrder, items: [{ name: "Widget", sku: "SKU-1", quantity: "0", unitPrice: "10.00" }] }).success, false);
});

test("calculates money exactly in integer minor units", () => {
  const total = calculateManualOrderTotal([
    { quantity: 3, unitPrice: "19.99" },
    { quantity: 2, unitPrice: "0.10" },
  ]);
  assert.equal(total, 6_017n);
  assert.equal(minorUnitsToMoney(total), "60.17");
  assert.equal(normalizeMoney("5.5"), "5.50");
});

test("generates distinct production manual order numbers in a stable format", () => {
  const now = new Date("2026-09-24T12:00:00.000Z");
  const first = generateManualOrderNumber(now, "12345678-abcd");
  const second = generateManualOrderNumber(now, "abcdef12-3456");
  assert.equal(first, "MAN-20260924-12345678");
  assert.equal(second, "MAN-20260924-ABCDEF12");
  assert.notEqual(first, second);
  assert.match(first, /^MAN-\d{8}-[A-Z0-9]{8}$/);
});

test("generates replacement-specific production order numbers", () => {
  const number = generateReplacementOrderNumber(new Date("2026-09-24T12:00:00.000Z"), "a1b2c3d4-5678");
  assert.equal(number, "REP-20260924-A1B2C3D4");
  assert.match(number, /^REP-\d{8}-[A-Z0-9]{8}$/);
});
