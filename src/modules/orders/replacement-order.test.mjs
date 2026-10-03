import assert from "node:assert/strict";
import test from "node:test";
import { manualOrderSchema } from "./manual-order.ts";
import { replacementOrderCreationContext, replacementOrderFormValues } from "./replacement-order.ts";

test("uses replacement source and links the new order to the original", () => {
  assert.deepEqual(replacementOrderCreationContext("original-123"), {
    source: "REPLACEMENT",
    parentOrderId: "original-123",
    historyReason: "Replacement order created",
  });
});

test("prefills editable replacement values without external or shipment metadata", () => {
  const values = replacementOrderFormValues({
    id: "original-123",
    orderNumber: "SHOP-1001",
    customerName: "Ada Lovelace",
    customerEmail: "ada@example.com",
    customerPhone: "+44 20 1234 5678",
    currency: "GBP",
    notes: "Leave at reception",
    address: {
      name: "Ada Lovelace",
      address1: "1 Example Street",
      address2: null,
      city: "London",
      province: null,
      postalCode: "SW1A 1AA",
      countryCode: "GB",
    },
    items: [{ name: "Widget", sku: "SKU-1", quantity: 2, unitPrice: { toFixed: () => "12.30" } }],
  });

  assert.equal(values.customerEmail, "ada@example.com");
  assert.equal(values.address1, "1 Example Street");
  assert.deepEqual(values.items, [{ name: "Widget", sku: "SKU-1", quantity: "2", unitPrice: "12.30" }]);
  assert.match(values.notes ?? "", /Replacement for SHOP-1001/);
  assert.equal(manualOrderSchema.safeParse(values).success, true);
  assert.equal("shopifyOrderId" in values, false);
  assert.equal("shipments" in values, false);
});

test("shared validation requires at least one valid replacement item", () => {
  const base = {
    customerName: "Ada Lovelace",
    customerEmail: "ada@example.com",
    customerPhone: "+44 20 1234 5678",
    recipientName: "Ada Lovelace",
    address1: "1 Example Street",
    address2: "",
    city: "London",
    province: "",
    postalCode: "SW1A 1AA",
    countryCode: "GB",
    currency: "GBP",
    notes: "Replacement for SHOP-1001",
  };

  assert.equal(manualOrderSchema.safeParse({ ...base, items: [] }).success, false);
  assert.equal(manualOrderSchema.safeParse({
    ...base,
    items: [{ name: "Widget", sku: "SKU-1", quantity: "0", unitPrice: "12.30" }],
  }).success, false);
});

test("prefills nullable Shopify recipient and SKU fields without fabricating values", () => {
  const values = replacementOrderFormValues({
    id: "original-123",
    orderNumber: "SHOP-1002",
    customerName: null,
    customerEmail: null,
    customerPhone: null,
    currency: "GBP",
    notes: null,
    address: {
      name: null,
      address1: null,
      address2: null,
      city: null,
      province: null,
      postalCode: null,
      countryCode: null,
    },
    items: [{ name: "Widget", sku: null, quantity: 1, unitPrice: null }],
  });

  assert.equal(values.customerName, "");
  assert.equal(values.recipientName, "");
  assert.equal(values.address1, "");
  assert.equal(values.countryCode, "");
  assert.equal(values.items[0]?.sku, "");
  assert.equal(manualOrderSchema.safeParse(values).success, false);
});
