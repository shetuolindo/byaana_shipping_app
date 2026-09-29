import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEmail, safePortalRedirect, validateCredentials } from "./auth-input.ts";

test("normalizes credential email before lookup", () => {
  assert.equal(normalizeEmail("  ADMIN@Shipping-Portal.Example.Test "), "admin@shipping-portal.example.test");
  assert.deepEqual(validateCredentials({ email: " Staff@Example.test ", password: "secret" }), {
    email: "staff@example.test",
    password: "secret",
  });
});

test("rejects invalid credentials with one generic validation outcome", () => {
  assert.equal(validateCredentials({ email: "not-an-email", password: "secret" }), null);
  assert.equal(validateCredentials({ email: "staff@example.test", password: "" }), null);
  assert.equal(validateCredentials({ email: "staff@example.test" }), null);
});

test("allows only local portal callback targets", () => {
  assert.equal(safePortalRedirect("/orders/example?tab=history"), "/orders/example?tab=history");
  assert.equal(safePortalRedirect("/shipments"), "/shipments");
  assert.equal(safePortalRedirect("https://attacker.example/orders"), "/");
  assert.equal(safePortalRedirect("//attacker.example/orders"), "/");
  assert.equal(safePortalRedirect("/api/auth/signin"), "/");
});
