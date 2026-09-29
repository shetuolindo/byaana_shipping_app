import assert from "node:assert/strict";
import test from "node:test";
import {
  assertExpectedOrderStatus,
  OrderTransitionRuleError,
  resolveOrderTransition,
  StaleOrderStatusError,
} from "./order-transitions.ts";

test("puts NEW and READY orders on hold", () => {
  assert.equal(resolveOrderTransition("NEW", "HOLD"), "ON_HOLD");
  assert.equal(resolveOrderTransition("READY", "HOLD"), "ON_HOLD");
});

test("resumes an ON_HOLD order to its recorded NEW or READY status", () => {
  assert.equal(resolveOrderTransition("ON_HOLD", "RESUME", "NEW"), "NEW");
  assert.equal(resolveOrderTransition("ON_HOLD", "RESUME", "READY"), "READY");
});

test("rejects resume when a safe pre-hold status is unavailable", () => {
  assert.throws(() => resolveOrderTransition("ON_HOLD", "RESUME"), OrderTransitionRuleError);
  assert.throws(() => resolveOrderTransition("ON_HOLD", "RESUME", "PROCESSING"), OrderTransitionRuleError);
});

test("cancels NEW, READY, and ON_HOLD orders", () => {
  assert.equal(resolveOrderTransition("NEW", "CANCEL"), "CANCELLED");
  assert.equal(resolveOrderTransition("READY", "CANCEL"), "CANCELLED");
  assert.equal(resolveOrderTransition("ON_HOLD", "CANCEL"), "CANCELLED");
});

test("rejects every internal action from terminal or unsupported states", () => {
  for (const status of ["CANCELLED", "SHIPPED", "PROCESSING", "ERROR"]) {
    for (const action of ["HOLD", "RESUME", "CANCEL"]) {
      assert.throws(() => resolveOrderTransition(status, action), OrderTransitionRuleError);
    }
  }
});

test("rejects a stale rendered status", () => {
  assert.doesNotThrow(() => assertExpectedOrderStatus("READY", "READY"));
  assert.throws(() => assertExpectedOrderStatus("ON_HOLD", "READY"), StaleOrderStatusError);
});
