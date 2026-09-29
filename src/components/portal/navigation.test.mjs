import assert from "node:assert/strict";
import test from "node:test";
import { getCurrentPage } from "./navigation.ts";

test("each portal route selects its own navigation item", () => {
  for (const [path, label] of [["/", "Dashboard"], ["/orders", "Orders"], ["/orders/new", "Manual Order"], ["/shipments", "Shipments"], ["/settings", "Settings"]]) {
    assert.equal(getCurrentPage(path)?.label, label);
  }
});

test("nested routes retain their section without matching unrelated prefixes", () => {
  assert.equal(getCurrentPage("/orders/example")?.label, "Orders");
  assert.equal(getCurrentPage("/shipments/example")?.label, "Shipments");
  assert.equal(getCurrentPage("/orders-other"), undefined);
  assert.equal(getCurrentPage("/unknown"), undefined);
});
